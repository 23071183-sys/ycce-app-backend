const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const pool = require('../config/database');
const rzp = require('../config/razorpay');
const { notify } = require('../config/notifications');

// The money side of fees. Rules that matter:
//  - amounts are integer paise, worked out on the server, never taken from the client;
//  - a payment only counts once Razorpay says so (webhook, or us asking it directly),
//    never because the app or the browser redirect claims it;
//  - an invoice's amount_paid is recomputed as the sum of captured payments, so
//    settling the same payment twice can't double-count it.

const ADMIN_ROLES = ['admin', 'super_admin'];
const LINK_MINUTES = 30;

const outstanding = (inv) => Math.max(0, inv.amount_due_paise - inv.amount_paid_paise);

// Recompute an invoice from its captured payments. Must run inside the caller's
// transaction.
async function recomputeInvoice(client, invoiceId) {
  const { rows } = await client.query(
    `UPDATE fee_invoices i SET
       amount_paid_paise = s.paid,
       status = CASE
         WHEN i.status IN ('waived','cancelled') THEN i.status
         WHEN s.paid >= i.amount_due_paise THEN 'paid'
         WHEN s.paid > 0 THEN 'partial'
         ELSE 'unpaid' END,
       updated_at = now()
     FROM (SELECT COALESCE(SUM(amount_paise), 0)::int AS paid FROM fee_payments
           WHERE invoice_id = $1 AND status = 'captured') s
     WHERE i.id = $1
     RETURNING i.*`,
    [invoiceId]
  );
  return rows[0];
}

const nextReceiptNo = async (client) => {
  const { rows } = await client.query(`SELECT nextval('fee_receipt_seq') AS n`);
  return `YCCE-${new Date().getFullYear()}-${String(rows[0].n).padStart(6, '0')}`;
};

// Bring one fee_payments row in line with what Razorpay reports for its link.
// link is a Razorpay payment_link entity; safe to call any number of times.
async function settle(paymentId, link, rawEvent = null) {
  const client = await pool.connect();
  let captured = null;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM fee_payments WHERE id = $1 FOR UPDATE', [paymentId]);
    const pay = rows[0];
    if (!pay || pay.status === 'captured' || pay.method !== 'razorpay') {
      await client.query('COMMIT');
      return pay;
    }

    let status = pay.status;
    let rzpPaymentId = pay.razorpay_payment_id;
    if (link.status === 'paid') {
      const paid = Number(link.amount_paid);
      if (paid !== pay.amount_paise) {
        // Should never happen with accept_partial off; keep it for a human to look at.
        console.error(`Fee payment ${pay.id}: Razorpay paid ${paid}, expected ${pay.amount_paise}`);
        status = 'pending';
      } else {
        status = 'captured';
        const ok = (link.payments || []).find(p => p.status === 'captured') || (link.payments || [])[0];
        rzpPaymentId = ok?.payment_id || rzpPaymentId;
      }
    } else if (link.status === 'expired') {
      status = 'expired';
    } else if (link.status === 'cancelled') {
      status = 'cancelled';
    }

    const receipt = status === 'captured' ? await nextReceiptNo(client) : pay.receipt_no;
    const { rows: upd } = await client.query(
      `UPDATE fee_payments SET status = $2::varchar, razorpay_payment_id = $3, receipt_no = $4,
         paid_at = CASE WHEN $2::varchar = 'captured' THEN now() ELSE paid_at END,
         raw_event = COALESCE($5, raw_event)
       WHERE id = $1 RETURNING *`,
      [pay.id, status, rzpPaymentId, receipt, rawEvent]
    );
    if (status === 'captured') {
      await recomputeInvoice(client, pay.invoice_id);
      captured = upd[0];
    }
    await client.query('COMMIT');
    if (captured) {
      const { rows: u } = await pool.query(
        'SELECT expo_push_token, notification_prefs FROM users WHERE id = $1', [captured.student_id]
      );
      notify(u, 'fees', 'Payment received', `₹${(captured.amount_paise / 100).toLocaleString('en-IN')} — receipt ${captured.receipt_no}`,
        { type: 'fee_payment', paymentId: captured.id });
    }
    return upd[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Ask Razorpay for the link's real state and settle from it.
async function refreshFromRazorpay(pay) {
  if (!pay?.razorpay_payment_link_id || pay.status === 'captured' || !rzp.configured()) return pay;
  const link = await rzp.fetchPaymentLink(pay.razorpay_payment_link_id);
  return settle(pay.id, link);
}

const loadInvoiceFor = async (invoiceId, user) => {
  const { rows } = await pool.query(
    `SELECT i.*, s.title, s.due_date FROM fee_invoices i JOIN fee_structures s ON s.id = i.structure_id
     WHERE i.id = $1`,
    [invoiceId]
  );
  const inv = rows[0];
  if (!inv) return null;
  if (inv.student_id !== user.userId && !ADMIN_ROLES.includes(user.role)) return null;
  return inv;
};

exports.pay = async (req, res) => {
  if (!rzp.configured()) return res.status(503).json({ error: 'Online payments are not set up yet' });
  try {
    const inv = await loadInvoiceFor(Number(req.params.id), req.user);
    if (!inv || inv.student_id !== req.user.userId) return res.status(404).json({ error: 'Invoice not found' });
    if (['paid', 'waived', 'cancelled'].includes(inv.status)) {
      return res.status(409).json({ error: `This fee is already ${inv.status}` });
    }
    const amount = outstanding(inv);
    if (amount < 100) return res.status(409).json({ error: 'Nothing left to pay' });

    // Reuse a live link for the same amount instead of piling up new ones.
    const { rows: live } = await pool.query(
      `SELECT * FROM fee_payments
       WHERE invoice_id = $1 AND method = 'razorpay' AND status IN ('created','pending')
         AND amount_paise = $2 AND link_expires_at > now() + interval '2 minutes'
       ORDER BY id DESC LIMIT 1`,
      [inv.id, amount]
    );
    if (live[0]) {
      return res.json({ payment_id: live[0].id, short_url: live[0].short_url, amount_paise: amount, expires_at: live[0].link_expires_at });
    }

    const { rows: [student] } = await pool.query('SELECT name, email, phone FROM users WHERE id = $1', [inv.student_id]);
    const { rows: [pay] } = await pool.query(
      `INSERT INTO fee_payments (invoice_id, student_id, amount_paise, method, status)
       VALUES ($1, $2, $3, 'razorpay', 'created') RETURNING *`,
      [inv.id, inv.student_id, amount]
    );

    const base = (process.env.PUBLIC_BACKEND_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const expireBy = Math.floor(Date.now() / 1000) + LINK_MINUTES * 60;
    let link;
    try {
      link = await rzp.createPaymentLink({
        amount,
        currency: 'INR',
        accept_partial: false,
        expire_by: expireBy,
        reference_id: `fee_${pay.id}`,
        description: inv.title.slice(0, 2048),
        customer: {
          name: student.name,
          email: student.email,
          ...(/^\+?\d{10,13}$/.test(student.phone || '') ? { contact: student.phone } : {}),
        },
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: { fee_payment_id: String(pay.id), invoice_id: String(inv.id) },
        callback_url: `${base}/api/fees/return`,
        callback_method: 'get',
      });
    } catch (err) {
      await pool.query(`UPDATE fee_payments SET status = 'failed', note = $2 WHERE id = $1`, [pay.id, err.message]);
      throw err;
    }
    await pool.query(
      `UPDATE fee_payments SET status = 'pending', razorpay_payment_link_id = $2, short_url = $3,
         link_expires_at = to_timestamp($4) WHERE id = $1`,
      [pay.id, link.id, link.short_url, expireBy]
    );
    res.status(201).json({ payment_id: pay.id, short_url: link.short_url, amount_paise: amount, expires_at: new Date(expireBy * 1000) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

// Mounted in server.js before express.json(): the signature covers the raw body.
exports.webhook = async (req, res) => {
  if (!rzp.webhookConfigured()) return res.status(503).json({ error: 'Webhook not configured' });
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!rzp.verifyWebhook(raw, req.get('x-razorpay-signature'))) {
    return res.status(400).json({ error: 'Bad signature' });
  }
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Bad JSON' }); }

  const eventId = req.get('x-razorpay-event-id') || crypto.createHash('sha256').update(raw).digest('hex').slice(0, 64);
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO razorpay_webhook_events (event_id, event, payload) VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, event.event || 'unknown', event]
    );
    if (rowCount === 0) return res.json({ ok: true, duplicate: true });

    const link = event.payload?.payment_link?.entity;
    const payment = event.payload?.payment?.entity;
    if (link?.id && ['payment_link.paid', 'payment_link.expired', 'payment_link.cancelled'].includes(event.event)) {
      const { rows } = await pool.query('SELECT id FROM fee_payments WHERE razorpay_payment_link_id = $1', [link.id]);
      if (rows[0]) {
        if (payment && !link.payments) link.payments = [{ payment_id: payment.id, status: payment.status }];
        await settle(rows[0].id, link, event);
      }
    } else if (payment?.notes?.fee_payment_id) {
      const id = Number(payment.notes.fee_payment_id);
      if (event.event === 'payment.failed') {
        // The link stays open, so the student can try again on it.
        await pool.query(
          `UPDATE fee_payments SET note = $2 WHERE id = $1 AND status IN ('created','pending')`,
          [id, `Last attempt failed: ${payment.error_description || 'unknown reason'}`]
        );
      } else if (event.event === 'payment.captured') {
        const { rows } = await pool.query('SELECT * FROM fee_payments WHERE id = $1', [id]);
        await refreshFromRazorpay(rows[0]);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    // Forget the event so Razorpay's retry gets processed.
    await pool.query('DELETE FROM razorpay_webhook_events WHERE event_id = $1', [eventId]).catch(() => {});
    console.error('Razorpay webhook failed:', err.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

const page = (title, message) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#F5F5F7;color:#0A0A0A;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
.c{background:#fff;border:1px solid #E3E3E6;border-radius:12px;padding:32px;max-width:360px;text-align:center}
h1{font-size:22px;font-weight:600;margin:0 0 8px}p{color:#3C3C43;font-size:15px;line-height:20px;margin:0}
@media (prefers-color-scheme:dark){body{background:#000;color:#FAFAFA}.c{background:#0F0F10;border-color:#262628}p{color:#A1A1A6}}</style>
</head><body><div class="c"><h1>${title}</h1><p>${message}</p></div></body></html>`;

// Where the browser lands after paying. The query string is only a hint: the
// state is confirmed with Razorpay before anything is recorded.
exports.paymentReturn = async (req, res) => {
  const q = req.query;
  try {
    if (!rzp.verifyCallback(q)) {
      return res.status(400).send(page('Could not verify payment', 'If money was taken it will show in the app within a few minutes.'));
    }
    const { rows } = await pool.query('SELECT * FROM fee_payments WHERE razorpay_payment_link_id = $1', [String(q.razorpay_payment_link_id)]);
    const pay = await refreshFromRazorpay(rows[0]);
    if (pay?.status === 'captured') {
      return res.send(page('Payment received', `Receipt ${pay.receipt_no}. You can go back to the YCCE CT app now.`));
    }
    res.send(page('Payment not completed', 'Nothing was recorded. Go back to the app to try again.'));
  } catch (err) {
    console.error('Fee return page:', err.message);
    res.status(500).send(page('Something went wrong', 'If money was taken it will show in the app within a few minutes.'));
  }
};

exports.refreshPayment = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM fee_payments WHERE id = $1', [Number(req.params.id)]);
    const pay = rows[0];
    if (!pay || (pay.student_id !== req.user.userId && !ADMIN_ROLES.includes(req.user.role))) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    const updated = await refreshFromRazorpay(pay);
    res.json({ id: updated.id, status: updated.status, receipt_no: updated.receipt_no });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

// Cron: settle anything the webhook missed in the last day.
exports.reconcilePending = async () => {
  if (!rzp.configured()) return;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM fee_payments
       WHERE method = 'razorpay' AND status IN ('created','pending')
         AND razorpay_payment_link_id IS NOT NULL AND created_at > now() - interval '24 hours'`
    );
    for (const pay of rows) {
      await refreshFromRazorpay(pay).catch(err => console.warn(`Reconcile payment ${pay.id}:`, err.message));
    }
  } catch (err) {
    console.error('Fee reconcile failed:', err.message);
  }
};

exports.receipt = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.name, u.roll_number, u.year, s.title, s.academic_year
       FROM fee_payments p
       JOIN users u ON u.id = p.student_id
       JOIN fee_invoices i ON i.id = p.invoice_id
       JOIN fee_structures s ON s.id = i.structure_id
       WHERE p.id = $1`,
      [Number(req.params.id)]
    );
    const p = rows[0];
    if (!p || p.status !== 'captured' || (p.student_id !== req.user.userId && !ADMIN_ROLES.includes(req.user.role))) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${p.receipt_no}.pdf"`);
    const doc = new PDFDocument({ size: 'A5', margin: 40 });
    doc.pipe(res);
    doc.fontSize(16).text('YCCE — Computer Technology', { align: 'left' });
    doc.fontSize(10).fillColor('#8E8E93').text('FEE RECEIPT', { characterSpacing: 1 }).moveDown(1.5);
    const row = (label, value) => {
      doc.fillColor('#8E8E93').fontSize(9).text(label.toUpperCase(), { characterSpacing: 0.8 });
      doc.fillColor('#0A0A0A').fontSize(12).text(value || '—').moveDown(0.6);
    };
    row('Receipt no', p.receipt_no);
    row('Student', `${p.name}${p.roll_number ? ` (${p.roll_number})` : ''}`);
    row('Fee', `${p.title} · ${p.academic_year}`);
    row('Amount', `Rs. ${(p.amount_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
    row('Method', p.method === 'razorpay' ? `Online (Razorpay ${p.razorpay_payment_id || ''})` : p.method);
    row('Paid on', new Date(p.paid_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    doc.moveDown(1).fillColor('#8E8E93').fontSize(8).text('This is a computer-generated receipt.');
    doc.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};

exports._internal = { settle, recomputeInvoice, nextReceiptNo, outstanding, loadInvoiceFor };
