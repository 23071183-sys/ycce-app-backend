const pool = require('../config/database');
// Create subject
exports.create = async (req, res) => {
const { name, code, year, semester, professor_id } = req.body;
try {
const result = await pool.query(
`INSERT INTO subjects (name, code, year, semester, professor_id)
VALUES ($1, $2, $3, $4, $5) RETURNING *`,
[name, code, year, semester, professor_id]
);
res.status(201).json(result.rows[0]);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get subjects by year, optionally filtered by semester
exports.getByYear = async (req, res) => {
const { year } = req.params;
const { semester } = req.query;
try {
const values = [year];
let semFilter = '';
if (semester) { values.push(semester); semFilter = `AND s.semester = $${values.length}`; }
const result = await pool.query(
`SELECT s.*, u.name as professor_name
FROM subjects s
LEFT JOIN users u ON s.professor_id = u.id
WHERE s.year = $1 ${semFilter}
ORDER BY s.name`,
values
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get all subjects for a professor
exports.getProfessorSubjects = async (req, res) => {
try {
const result = await pool.query(
`SELECT s.*, u.name as professor_name
FROM subjects s
LEFT JOIN users u ON s.professor_id = u.id
WHERE s.professor_id = $1
ORDER BY s.year, s.name`,
[req.user.userId]
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Update subject
exports.update = async (req, res) => {
const { id } = req.params;
const { name, code, year, semester, professor_id } = req.body;
try {
const result = await pool.query(
`UPDATE subjects SET name=$1, code=$2, year=$3, semester=$4, professor_id=$5
WHERE id=$6 RETURNING *`,
[name, code, year, semester, professor_id, id]
);
if (result.rows.length === 0) return res.status(404).json({ error: 'Subject not found' });
res.json(result.rows[0]);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Delete subject
exports.delete = async (req, res) => {
const { id } = req.params;
try {
const result = await pool.query('DELETE FROM subjects WHERE id = $1', [id]);
if (result.rowCount === 0) return res.status(404).json({ error: 'Subject not found' });
res.json({ message: 'Subject deleted' });
} catch (err) {
res.status(500).json({ error: err.message });
}
};