const { Resend } = require('resend');
const nodemailer = require('nodemailer');

// Gmail goes first because it delivers to any address. Resend is only a
// fallback: its onboarding@resend.dev sender delivers to the Resend account
// owner and nobody else, so it cannot reach students on its own.
const senders = [];

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
