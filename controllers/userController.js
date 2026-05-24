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
exports.updateProfile = async (req, res) => {
  const { name, phone, year, roll_number } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET
        name = COALESCE($1, name),
        year = COALESCE($2, year),
        roll_number = COALESCE($3, roll_number)
       WHERE id = $4
       RETURNING id, name, email, role, year, roll_number, department`,
      [name, year, roll_number, req.user.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all faculty with their subjects
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
