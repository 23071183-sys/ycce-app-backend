const pool = require('../config/database');

// Get all users filtered by role and/or year
exports.getDirectory = async (req, res) => {
  const { role, year, department } = req.query;
  try {
    const conditions = [];
    const values = [];
    if (role) { values.push(role); conditions.push(`role = $${values.length}`); }
    if (year) { values.push(year); conditions.push(`year = $${values.length}`); }
    if (department) { values.push(department); conditions.push(`department = $${values.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT id, name, email, role, year, roll_number, department, created_at
       FROM users ${where} ORDER BY name`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get user by ID
exports.getUserById = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, year, roll_number, department, created_at FROM users WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Search users by name
exports.searchUsers = async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query parameter q is required' });
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, year, roll_number, department
       FROM users WHERE name ILIKE $1 ORDER BY name LIMIT 20`,
      [`%${q}%`]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update own profile
// Fields a user may change about themselves. Year and roll number are not
// among them: fee invoices and who a student may message are derived from
// year, so only an admin may change it (via the admin user tools).
const PROFILE_COLUMNS = 'id, name, email, role, year, semester, roll_number, department, designation, phone, bio, avatar_url, notification_prefs, status';

exports.getMe = async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT ${PROFILE_COLUMNS} FROM users WHERE id = $1`, [req.user.userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateProfile = async (req, res) => {
  const { name, phone, bio } = req.body;
  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100)) {
    return res.status(400).json({ error: 'Name must be 2 to 100 characters' });
  }
  if (phone !== undefined && phone !== null && phone !== '' && !/^\+?[0-9 -]{7,20}$/.test(String(phone))) {
    return res.status(400).json({ error: 'Enter a valid phone number' });
  }
  if (bio !== undefined && bio !== null && String(bio).length > 500) {
    return res.status(400).json({ error: 'Bio must be under 500 characters' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE users SET
         name = COALESCE($1, name),
         phone = CASE WHEN $2::boolean THEN $3 ELSE phone END,
         bio = CASE WHEN $4::boolean THEN $5 ELSE bio END
       WHERE id = $6
       RETURNING ${PROFILE_COLUMNS}`,
      [
        name !== undefined ? name.trim() : null,
        phone !== undefined, phone ? String(phone).trim() : null,
        bio !== undefined, bio ? String(bio).trim() : null,
        req.user.userId,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updatePhoto = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a photo to upload' });
  try {
    const { rows } = await pool.query(
      `UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING ${PROFILE_COLUMNS}`,
      [req.file.path, req.user.userId]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.removePhoto = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE users SET avatar_url = NULL WHERE id = $1 RETURNING ${PROFILE_COLUMNS}`,
      [req.user.userId]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const PREF_KEYS = ['announcements', 'lectures', 'deadlines', 'messages', 'fees', 'placements', 'events'];

exports.updateNotificationPrefs = async (req, res) => {
  const body = req.body || {};
  const unknown = Object.keys(body).filter(k => !PREF_KEYS.includes(k));
  if (unknown.length) return res.status(400).json({ error: `Unknown preference: ${unknown.join(', ')}` });
  const bad = Object.entries(body).filter(([, v]) => typeof v !== 'boolean');
  if (bad.length) return res.status(400).json({ error: 'Preferences must be true or false' });
  try {
    const { rows } = await pool.query(
      `UPDATE users SET notification_prefs = COALESCE(notification_prefs, '{}'::jsonb) || $1::jsonb
       WHERE id = $2 RETURNING notification_prefs`,
      [JSON.stringify(body), req.user.userId]
    );
    res.json(rows[0].notification_prefs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getFaculty = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.department, u.designation, u.qualification, u.joining_date, u.sort_order,
              u.teaching_exp, u.industrial_exp, u.courses_taught, u.research_count,
              COALESCE(
                json_agg(json_build_object('id', s.id, 'name', s.name, 'code', s.code, 'year', s.year))
                FILTER (WHERE s.id IS NOT NULL), '[]'
              ) AS subjects
       FROM users u
       LEFT JOIN subjects s ON s.professor_id = u.id
       WHERE u.role = 'professor' AND u.sort_order IS NOT NULL
       GROUP BY u.id
       ORDER BY u.sort_order ASC LIMIT 30`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get students by year (for professors marking attendance)
exports.getStudentsByYear = async (req, res) => {
  const { year } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, name, roll_number FROM users
       WHERE role = 'student' AND year = $1
       ORDER BY roll_number, name`,
      [year]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Register Expo push token for the authenticated user
exports.updatePushToken = async (req, res) => {
  const { expo_push_token } = req.body;
  try {
    await pool.query(
      'UPDATE users SET expo_push_token=$1 WHERE id=$2',
      [expo_push_token || null, req.user.userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
