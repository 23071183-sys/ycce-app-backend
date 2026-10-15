const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { generateToken } = require('../config/auth');
const { sendOTP } = require('../config/mailer');

const generateOTP = () => String(Math.floor(100000 + Math.random() * 900000));

const isCollegeEmail = (email) => /^[a-zA-Z0-9]+@ycce\.in$/.test(email);

exports.sendOtp = async (req, res) => {
  const { email, roll_number } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!isCollegeEmail(email))
    return res.status(400).json({ error: 'Only college emails are allowed (e.g. 23071189@ycce.in)' });
  if (roll_number && email.split('@')[0].toLowerCase() !== roll_number.toLowerCase())
    return res.status(400).json({ error: 'Email must match your roll number (e.g. 23071189@ycce.in)' });
  try {
    const existing = await pool.query('SELECT id, status FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0 && existing.rows[0].status === 'approved')
      return res.status(400).json({ error: 'Email already registered' });

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query('DELETE FROM otps WHERE email = $1', [email]);
    await pool.query(
      'INSERT INTO otps (email, otp, expires_at) VALUES ($1, $2, $3)',
      [email, otp, expiresAt]
    );
    await sendOTP(email, otp, req.body.name || '');
    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    console.error('OTP error:', err.message);
    res.status(500).json({ error: 'Could not send the OTP email. Please try again in a minute.' });
  }
};

exports.verifyAndRegister = async (req, res) => {
  const { name, email, password, year, roll_number, otp } = req.body;
  if (!name || !email || !password || !year || !roll_number || !otp)
    return res.status(400).json({ error: 'All fields are required' });
  try {
    const otpRow = await pool.query(
      'SELECT * FROM otps WHERE email = $1 AND used = FALSE ORDER BY created_at DESC LIMIT 1',
      [email]
    );
    if (otpRow.rows.length === 0)
      return res.status(400).json({ error: 'No OTP found. Please request a new one.' });

    const record = otpRow.rows[0];
    if (new Date() > new Date(record.expires_at))
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    if (record.otp !== otp)
      return res.status(400).json({ error: 'Incorrect OTP' });

    await pool.query('UPDATE otps SET used = TRUE WHERE id = $1', [record.id]);

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0)
      return res.status(400).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, email, password, role, year, roll_number, department, status)
       VALUES ($1, $2, $3, 'student', $4, $5, 'Computer Technology', 'approved') RETURNING id, name, email, role, year, roll_number, department, status`,
      [name, email, hashed, year, roll_number]
    );
    const user = result.rows[0];
    const token = generateToken(user.id, user.role);
    res.status(201).json({ user, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.register = async (req, res) => {
  const { name, email, password, year, roll_number } = req.body;
  if (!name || !email || !password || !year || !roll_number)
    return res.status(400).json({ error: 'All fields are required' });
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0)
      return res.status(400).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (name, email, password, role, year, roll_number, department, status)
       VALUES ($1, $2, $3, 'student', $4, $5, 'Computer Technology', 'pending')`,
      [name, email, hashed, year, roll_number]
    );
    res.status(201).json({ message: 'Registration submitted. Awaiting admin approval.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  try {
    const user = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0)
      return res.status(404).json({ error: 'No account found with this email' });
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query('DELETE FROM otps WHERE email = $1', [email]);
    await pool.query('INSERT INTO otps (email, otp, expires_at) VALUES ($1, $2, $3)', [email, otp, expiresAt]);
    await sendOTP(email, otp, 'there');
    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
};

exports.resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword)
    return res.status(400).json({ error: 'All fields are required' });
  try {
    const otpRow = await pool.query(
      'SELECT * FROM otps WHERE email = $1 AND used = FALSE ORDER BY created_at DESC LIMIT 1',
      [email]
    );
    if (otpRow.rows.length === 0)
      return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
    const record = otpRow.rows[0];
    if (new Date() > new Date(record.expires_at))
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    if (record.otp !== otp)
      return res.status(400).json({ error: 'Incorrect OTP' });
    await pool.query('UPDATE otps SET used = TRUE WHERE id = $1', [record.id]);
    const hashed = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password = $1 WHERE email = $2', [hashed, email]);
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ error: 'Invalid credentials' });
    if (user.status === 'pending')
      return res.status(403).json({ error: 'Your account is pending admin approval.' });
    if (user.status === 'rejected')
      return res.status(403).json({ error: 'Your registration was rejected. Contact admin.' });
    const token = generateToken(user.id, user.role);
    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, year, semester, roll_number, department, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateFCMToken = async (req, res) => {
  const { fcm_token } = req.body;
  try {
    await pool.query('UPDATE users SET fcm_token = $1 WHERE id = $2', [fcm_token, req.user.userId]);
    res.json({ message: 'FCM token updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
