const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

exports.sendOTP = async (toEmail, otp, name) => {
  await transporter.sendMail({
    from: `"YCCE CT App" <${process.env.EMAIL_USER}>`,
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
};
