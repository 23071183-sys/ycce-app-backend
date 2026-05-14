const pool = require('../config/database');

exports.getBySubject = async (req, res) => {
  const { subjectId } = req.params;
  try {
    const result = await pool.query(
      `SELECT n.*, u.name as posted_by_name, u.role as posted_by_role
       FROM notes n
       LEFT JOIN users u ON n.posted_by = u.id
       WHERE n.subject_id = $1
       ORDER BY n.unit ASC NULLS LAST, n.created_at DESC`,
      [subjectId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  const { title, content, subject_id, unit } = req.body;
  if (!title || !subject_id) return res.status(400).json({ error: 'title and subject_id are required' });

  const file_url = req.file ? req.file.path : (req.body.file_url || null);
  const file_name = req.file ? req.file.originalname : null;

  try {
    const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.userId]);
    const role = userResult.rows[0]?.role;

    const result = await pool.query(
      `INSERT INTO notes (title, content, file_url, file_name, subject_id, posted_by, unit, uploaded_by_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [title, content || null, file_url, file_name, subject_id, req.user.userId, unit || null, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.delete = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM notes WHERE id = $1 AND posted_by = $2', [id, req.user.userId]);
    res.json({ message: 'Note deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
