const pool = require('../config/database');
const { notify } = require('../config/notifications');
const { recomputeInvoice, nextReceiptNo, loadInvoiceFor } = require('./feePayments')._internal;

// Fee structures (what a year owes), the invoices published from them, and the
// admin side: who has paid, cash payments, waivers. Money is integer paise.

const isPaise = (n) => Number.isInteger(n) && n >= 0 && n <= 100_000_000_00;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

function validateStructure(body, partial = false) {
  const errors = [];
  const { title, academic_year, year, semester, due_date, late_fee_paise, items } = body || {};
  if (!partial || title !== undefined) if (!title || String(title).trim().length < 3) errors.push('Title is required');
  if (!partial || academic_year !== undefined) if (!/^\d{4}-\d{2,4}$/.test(academic_year || '')) errors.push('Academic year looks like 2026-27');
  if (!partial || year !== undefined) if (![1, 2, 3, 4].includes(Number(year))) errors.push('Year must be 1 to 4');
  if (semester != null && semester !== '' && !(Number(semester) >= 1 && Number(semester) <= 8)) errors.push('Semester must be 1 to 8');
  if (!partial || due_date !== undefined) if (!isDate(due_date)) errors.push('Due date is required');
  if (late_fee_paise !== undefined && !isPaise(Number(late_fee_paise))) errors.push('Late fee must be a whole amount in paise');
  if (!partial || items !== undefined) {
    if (!Array.isArray(items) || items.length === 0) errors.push('Add at least one fee item');
    else if (items.some(i => !i?.label?.trim() || !isPaise(Number(i.amount_paise)))) errors.push('Each item needs a label and an amount');
    else if (items.reduce((s, i) => s + Number(i.amount_paise), 0) <= 0) errors.push('Total must be more than zero');
  }
  return errors;
}

const STRUCTURE_SUMMARY = `
  SELECT s.*,
    (SELECT COALESCE(SUM(amount_paise),0)::int FROM fee_structure_items WHERE structure_id = s.id) AS total_paise,
    (SELECT COALESCE(json_agg(json_build_object('id', it.id, 'label', it.label, 'amount_paise', it.amount_paise) ORDER BY it.id), '[]')
       FROM fee_structure_items it WHERE it.structure_id = s.id) AS items,
    (SELECT COUNT(*)::int FROM fee_invoices WHERE structure_id = s.id AND status <> 'cancelled') AS invoices,
    (SELECT COUNT(*)::int FROM fee_invoices WHERE structure_id = s.id AND status IN ('paid','waived')) AS settled,
    (SELECT COALESCE(SUM(amount_due_paise),0)::bigint FROM fee_invoices WHERE structure_id = s.id AND status NOT IN ('cancelled','waived')) AS expected_paise,
    (SELECT COALESCE(SUM(amount_paid_paise),0)::bigint FROM fee_invoices WHERE structure_id = s.id) AS collected_paise
  FROM fee_structures s`;

// ── Student ────────────────────────────────────────────────────────────────

const INVOICE_DETAIL = `
  SELECT i.*, s.title, s.academic_year, s.semester, s.due_date, s.late_fee_paise,
    (SELECT COALESCE(json_agg(json_build_object('label', it.label, 'amount_paise', it.amount_paise) ORDER BY it.id), '[]')
       FROM fee_structure_items it WHERE it.structure_id = s.id) AS items,
    (SELECT COALESCE(json_agg(json_build_object(
        'id', p.id, 'amount_paise', p.amount_paise, 'method', p.method, 'status', p.status,
        'receipt_no', p.receipt_no, 'paid_at', p.paid_at, 'created_at', p.created_at,
        'short_url', CASE WHEN p.status IN ('created','pending') AND p.link_expires_at > now() THEN p.short_url END,
        'note', p.note) ORDER BY p.id DESC), '[]')
       FROM fee_payments p WHERE p.invoice_id = i.id AND p.status NOT IN ('expired','cancelled')) AS payments
  FROM fee_invoices i JOIN fee_structures s ON s.id = i.structure_id`;

exports.myInvoices = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${INVOICE_DETAIL} WHERE i.student_id = $1 AND i.status <> 'cancelled'
       ORDER BY (i.status IN ('paid','waived')), s.due_date`,
      [req.user.userId]
    );
    const due = rows.filter(r => ['unpaid', 'partial'].includes(r.status))
      .reduce((s, r) => s + r.amount_due_paise - r.amount_paid_paise, 0);
    res.json({ invoices: rows, total_due_paise: due });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getInvoice = async (req, res) => {
  try {
    if (!(await loadInvoiceFor(Number(req.params.id), req.user))) return res.status(404).json({ error: 'Invoice not found' });
    const { rows } = await pool.query(`${INVOICE_DETAIL} WHERE i.id = $1`, [Number(req.params.id)]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Admin: structures ──────────────────────────────────────────────────────

exports.listStructures = async (req, res) => {
  try {
    const { rows } = await pool.query(`${STRUCTURE_SUMMARY} ORDER BY s.created_at DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createStructure = async (req, res) => {
  const errors = validateStructure(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const b = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [s] } = await client.query(
      `INSERT INTO fee_structures (title, academic_year, year, semester, due_date, late_fee_paise, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [b.title.trim(), b.academic_year, Number(b.year), b.semester ? Number(b.semester) : null, b.due_date,
       Number(b.late_fee_paise || 0), req.user.userId]
    );
    for (const it of b.items) {
      await client.query('INSERT INTO fee_structure_items (structure_id, label, amount_paise) VALUES ($1,$2,$3)',
        [s.id, it.label.trim(), Number(it.amount_paise)]);
    }
    await client.query('COMMIT');
    const { rows } = await pool.query(`${STRUCTURE_SUMMARY} WHERE s.id = $1`, [s.id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// Before publishing, anything can change. After, invoices exist, so only the
// title, due date, late fee and active flag can; amounts are fixed.
exports.updateStructure = async (req, res) => {
  const id = Number(req.params.id);
  const errors = validateStructure(req.body, true);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const b = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [s] } = await client.query('SELECT * FROM fee_structures WHERE id = $1 FOR UPDATE', [id]);
    if (!s) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Fee structure not found' }); }
    if (s.published_at && (b.items !== undefined || b.year !== undefined || b.academic_year !== undefined || b.semester !== undefined)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Already published: only the title, due date, late fee and active status can change' });
    }
    await client.query(
      `UPDATE fee_structures SET
         title = COALESCE($2, title), academic_year = COALESCE($3, academic_year), year = COALESCE($4, year),
         semester = CASE WHEN $5::boolean THEN $6 ELSE semester END,
         due_date = COALESCE($7, due_date), late_fee_paise = COALESCE($8, late_fee_paise),
         is_active = COALESCE($9, is_active)
       WHERE id = $1`,
      [id, b.title?.trim() || null, b.academic_year || null, b.year ? Number(b.year) : null,
       b.semester !== undefined, b.semester ? Number(b.semester) : null, b.due_date || null,
       b.late_fee_paise !== undefined ? Number(b.late_fee_paise) : null,
       typeof b.is_active === 'boolean' ? b.is_active : null]
    );
    if (b.items !== undefined) {
      await client.query('DELETE FROM fee_structure_items WHERE structure_id = $1', [id]);
      for (const it of b.items) {
        await client.query('INSERT INTO fee_structure_items (structure_id, label, amount_paise) VALUES ($1,$2,$3)',
          [id, it.label.trim(), Number(it.amount_paise)]);
      }
    }
    await client.query('COMMIT');
    const { rows } = await pool.query(`${STRUCTURE_SUMMARY} WHERE s.id = $1`, [id]);
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.deleteStructure = async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM fee_structures WHERE id = $1 AND published_at IS NULL', [Number(req.params.id)]);
    if (rowCount === 0) return res.status(409).json({ error: 'Not found, or already published (deactivate it instead)' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Create an invoice for every approved student in the structure's year.
// Running it again only adds students who joined since.
exports.publishStructure = async (req, res) => {
  const id = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [s] } = await client.query(
      `SELECT s.*, (SELECT COALESCE(SUM(amount_paise),0)::int FROM fee_structure_items WHERE structure_id = s.id) AS total
       FROM fee_structures s WHERE s.id = $1 FOR UPDATE`, [id]
    );
    if (!s) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Fee structure not found' }); }
    if (!s.is_active) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Activate the structure first' }); }
    if (s.total <= 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'The structure has no amount' }); }
    const { rows: created } = await client.query(
      `INSERT INTO fee_invoices (structure_id, student_id, amount_due_paise)
       SELECT $1, u.id, $2 FROM users u WHERE u.role = 'student' AND u.status = 'approved' AND u.year = $3
       ON CONFLICT (structure_id, student_id) DO NOTHING
       RETURNING student_id`,
      [id, s.total, s.year]
    );
    await client.query('UPDATE fee_structures SET published_at = COALESCE(published_at, now()) WHERE id = $1', [id]);
    await client.query('COMMIT');

    if (created.length) {
      const { rows: users } = await pool.query(
        'SELECT expo_push_token, notification_prefs FROM users WHERE id = ANY($1)', [created.map(r => r.student_id)]
      );
      notify(users, 'fees', 'New fee published',
        `${s.title}: ₹${(s.total / 100).toLocaleString('en-IN')} due ${new Date(s.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
        { type: 'fee_invoice' });
    }
    res.json({ created: created.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.structureStatus = async (req, res) => {
  const id = Number(req.params.id);
  try {
    const { rows: [s] } = await pool.query(`${STRUCTURE_SUMMARY} WHERE s.id = $1`, [id]);
    if (!s) return res.status(404).json({ error: 'Fee structure not found' });
    const { rows: invoices } = await pool.query(
      `SELECT i.id, i.status, i.amount_due_paise, i.amount_paid_paise, i.waive_note, i.updated_at,
              u.id AS student_id, u.name, u.roll_number, u.email,
              (SELECT MAX(paid_at) FROM fee_payments p WHERE p.invoice_id = i.id AND p.status = 'captured') AS last_paid_at
       FROM fee_invoices i JOIN users u ON u.id = i.student_id
       WHERE i.structure_id = $1
       ORDER BY u.roll_number NULLS LAST, u.name`,
      [id]
    );
    res.json({ structure: s, invoices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Super admin: cash and waivers ──────────────────────────────────────────

exports.recordOfflinePayment = async (req, res) => {
  const amount = Number(req.body?.amount_paise);
  const method = req.body?.method === 'cheque' ? 'cheque' : 'cash';
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'Enter the amount received' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [inv] } = await client.query('SELECT * FROM fee_invoices WHERE id = $1 FOR UPDATE', [Number(req.params.id)]);
    if (!inv) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Invoice not found' }); }
    if (!['unpaid', 'partial'].includes(inv.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `This fee is already ${inv.status}` });
    }
    if (amount > inv.amount_due_paise - inv.amount_paid_paise) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'That is more than the amount outstanding' });
    }
    const receipt = await nextReceiptNo(client);
    const { rows: [pay] } = await client.query(
      `INSERT INTO fee_payments (invoice_id, student_id, amount_paise, method, status, receipt_no, note, recorded_by, paid_at)
       VALUES ($1,$2,$3,$4,'captured',$5,$6,$7,now()) RETURNING *`,
      [inv.id, inv.student_id, amount, method, receipt, note, req.user.userId]
    );
    const updated = await recomputeInvoice(client, inv.id);
    await client.query('COMMIT');
    res.status(201).json({ payment: pay, invoice: updated });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.waiveInvoice = async (req, res) => {
  const note = String(req.body?.note || '').trim();
  if (note.length < 3) return res.status(400).json({ error: 'Give a reason for the waiver' });
  try {
    const { rows } = await pool.query(
      `UPDATE fee_invoices SET status = 'waived', waive_note = $2, updated_at = now()
       WHERE id = $1 AND status IN ('unpaid','partial') RETURNING *`,
      [Number(req.params.id), note.slice(0, 500)]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Not found, or not open for a waiver' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Daily job (09:00 IST) ──────────────────────────────────────────────────

exports.dailyFeeJobs = async () => {
  try {
    // Late fee goes on once, the day after the due date.
    await pool.query(
      `UPDATE fee_invoices i SET amount_due_paise = i.amount_due_paise + s.late_fee_paise,
         late_fee_applied = true, updated_at = now()
       FROM fee_structures s
       WHERE s.id = i.structure_id AND s.late_fee_paise > 0 AND NOT i.late_fee_applied
         AND i.status IN ('unpaid','partial') AND s.due_date < (now() AT TIME ZONE 'Asia/Kolkata')::date`
    );
    const { rows } = await pool.query(
      `SELECT u.expo_push_token, u.notification_prefs, s.title, s.due_date,
              (i.amount_due_paise - i.amount_paid_paise) AS left_paise
       FROM fee_invoices i
       JOIN fee_structures s ON s.id = i.structure_id
       JOIN users u ON u.id = i.student_id
       WHERE i.status IN ('unpaid','partial') AND s.is_active
         AND s.due_date - (now() AT TIME ZONE 'Asia/Kolkata')::date IN (0, 1, 3, 7)`
    );
    for (const r of rows) {
      const days = Math.round((new Date(r.due_date) - new Date(new Date().toDateString())) / 86400000);
      notify([r], 'fees', 'Fee reminder',
        `${r.title}: ₹${(r.left_paise / 100).toLocaleString('en-IN')} due ${days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
        { type: 'fee_invoice' });
    }
  } catch (err) {
    console.error('Daily fee job failed:', err.message);
  }
};
