const pool = require('../config/database');
// Create announcement
exports.create = async (req, res) => {
const { title, content, type, subject_id, year, is_cancelled } = req.body;
try {
const result = await pool.query(
`INSERT INTO announcements (title, content, type, subject_id, year, is_cancelled, posted_by)
VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
[title, content, type, subject_id, year, is_cancelled || false, req.user.userId]
);
res.status(201).json(result.rows[0]);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get general announcements (all CT dept)
exports.getGeneral = async (req, res) => {
try {
const result = await pool.query(
`SELECT a.*, u.name as posted_by_name
FROM announcements a
LEFT JOIN users u ON a.posted_by = u.id
WHERE a.type = 'general'
ORDER BY a.created_at DESC`
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get year-specific announcements
exports.getByYear = async (req, res) => {
const { year } = req.params;
try {
const result = await pool.query(
`SELECT a.*, u.name as posted_by_name
FROM announcements a
LEFT JOIN users u ON a.posted_by = u.id
WHERE a.type = 'year_specific' AND a.year = $1
ORDER BY a.created_at DESC`,
[year]
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get subject-specific announcements
exports.getBySubject = async (req, res) => {
const { subjectId } = req.params;
try {
const result = await pool.query(
`SELECT a.*, u.name as posted_by_name
FROM announcements a
LEFT JOIN users u ON a.posted_by = u.id
WHERE a.type = 'subject_specific' AND a.subject_id = $1
ORDER BY a.created_at DESC`,
[subjectId]
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get all announcements (admin/staff use)
exports.getAll = async (req, res) => {
try {
const result = await pool.query(
`SELECT a.*, u.name as posted_by_name, s.name as subject_name
FROM announcements a
LEFT JOIN users u ON a.posted_by = u.id
LEFT JOIN subjects s ON a.subject_id = s.id
ORDER BY a.created_at DESC`
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Delete announcement
exports.delete = async (req, res) => {
const { id } = req.params;
try {
const result = await pool.query('DELETE FROM announcements WHERE id = $1', [id]);
if (result.rowCount === 0) return res.status(404).json({ error: 'Announcement not found' });
res.json({ message: 'Announcement deleted' });
} catch (err) {
res.status(500).json({ error: err.message });
}
};