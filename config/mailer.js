const { Resend } = require('resend');
const nodemailer = require('nodemailer');

// Senders are tried in order until one delivers.
//
// Brevo goes first: it sends over HTTPS, which hosts that block outbound SMTP
// (Railway did, Render's free tier appears to) cannot stop, and it delivers to
// any address from a verified sender without owning a domain.
// Gmail SMTP is next — it works wherever SMTP is allowed, e.g. locally.
// Resend is last: its onboarding@resend.dev sender delivers only to the Resend
// account owner, so it cannot reach students on its own.
const senders = [];

if (process.env.BREVO_API_KEY) {
  const senderEmail = process.env.BREVO_SENDER || process.env.EMAIL_USER;
  senders.push({
    name: 'brevo',
    send: async (msg) => {
      if (!senderEmail) throw new Error('BREVO_SENDER (or EMAIL_USER) is not set');
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'YCCE CT App', email: senderEmail },
          to: [{ email: msg.to }],
          subject: msg.subject,
          htmlContent: msg.html,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
      }
    },
  });
}

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  const gmail = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    // A host that blocks SMTP leaves the socket hanging; fail fast so the
    // fallback gets a chance and the app does not wait for minutes.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  senders.push({
    name: 'gmail',
    send: (msg) => gmail.sendMail({ ...msg, from: `YCCE CT App <${process.env.EMAIL_USER}>` }),
  });
}

if (process.env.RESEND_API_KEY) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  senders.push({
    name: 'resend',
    // The SDK reports a rejected send by returning { error } rather than
    // throwing, so an unchecked call reads as success when nothing went out.
    send: async (msg) => {
      const { error } = await resend.emails.send({ ...msg, from: 'YCCE CT App <onboarding@resend.dev>' });
      if (error) throw new Error(error.message || 'Resend rejected the email');
    },
  });
}

// Throws when no sender delivered, so the caller can tell the user the OTP did
// not go out instead of reporting a send that never happened.
const deliver = async (msg) => {
  if (senders.length === 0) {
    throw new Error('No email sender configured (set EMAIL_USER/EMAIL_PASS or RESEND_API_KEY)');
  }
  const failures = [];
  for (const sender of senders) {
    try {
      await sender.send(msg);
      return sender.name;
    } catch (err) {
      failures.push(`${sender.name}: ${err.message}`);
    }
  }
  throw new Error(`Email not delivered — ${failures.join('; ')}`);
};

exports.sendOTP = async (toEmail, otp, name) => {
  const via = await deliver({
    to: toEmail,
    subject: 'Your YCCE CT App OTP',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto; padding: 32px; background: #000; color: #fff; border-radius: 12px;">
        <div style="display:flex; gap:12px; margin-bottom:24px;">
          <div style="background:#000; border:2px solid #fff; border-radius:6px; padding:6px 12px; font-weight:700; font-size:14px; letter-spacing:2px;">YCCE</div>
          <div style="background:#000; border:2px solid #fff; border-radius:6px; padding:6px 12px; font-weight:700; font-size:14px; letter-spacing:2px;">CT</div>
        </div>
        <p style="font-size:13px; color:#aaa; letter-spacing:2px; text-transform:uppercase; margin-bottom:8px;">Email Verification</p>
        <p style="font-size:16px; font-weight:300; margin-bottom:24px;">Hi ${name || 'there'},</p>
        <p style="font-size:14px; color:#aaa; margin-bottom:16px;">Your OTP for YCCE CT App registration:</p>
        <div style="background:#111; border:1px solid #333; border-radius:10px; padding:20px; text-align:center; margin-bottom:24px;">
          <span style="font-size:36px; font-weight:200; letter-spacing:12px; color:#fff;">${otp}</span>
        </div>
        <p style="font-size:12px; color:#555;">This OTP expires in 10 minutes. Do not share it with anyone.</p>
        <p style="font-size:12px; color:#555; margin-top:16px;">Yashwantrao Chavan College of Engineering · Computer Technology Department</p>
      </div>
    `,
  });
  console.log(`[mailer] OTP sent to ${toEmail} via ${via}`);
};
