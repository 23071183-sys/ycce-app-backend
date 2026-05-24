const pool = require('../config/database');
// Mark attendance for a student
exports.mark = async (req, res) => {
const { student_id, subject_id, date, status } = req.body;
if (!student_id || !subject_id || !date || !status) {
return res.status(400).json({ error: 'student_id, subject_id, date, and status are required' });
}
try {
const result = await pool.query(
`INSERT INTO attendance (student_id, subject_id, date, status, marked_by)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (student_id, subject_id, date)
DO UPDATE SET status=$4
RETURNING *`,
[student_id, subject_id, date, status, req.user.userId]
);
res.status(201).json(result.rows[0]);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Mark attendance for multiple students (full class)
exports.markBulk = async (req, res) => {
const { subject_id, date, records } = req.body;
// records: [{ student_id, status }]
if (!subject_id || !date || !records || !Array.isArray(records) || records.length === 0) {
return res.status(400).json({ error: 'subject_id, date, and records array are required' });
}
try {
const queries = records.map(r =>
pool.query(
`INSERT INTO attendance (student_id, subject_id, date, status, marked_by)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (student_id, subject_id, date)
DO UPDATE SET status=$4`,
[r.student_id, subject_id, date, r.status, req.user.userId]
)
);
await Promise.all(queries);
res.json({ message: 'Attendance marked for all students' });
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get attendance for a student per subject
exports.getStudentAttendance = async (req, res) => {
const { subjectId } = req.params;
const studentId = req.user.userId;
try {
const result = await pool.query(
`SELECT
COUNT(*) FILTER (WHERE status = 'present') as present_count,
COUNT(*) as total_count,
ROUND(COUNT(*) FILTER (WHERE status = 'present') * 100.0 / NULLIF(COUNT(*), 0), 2) as percentage
FROM attendance
WHERE student_id = $1 AND subject_id = $2`,
[studentId, subjectId]
);
res.json(result.rows[0]);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get all attendance records for a student per subject (detail view)
exports.getSubjectDetail = async (req, res) => {
const { subjectId } = req.params;
const studentId = req.user.userId;
try {
const result = await pool.query(
`SELECT date, status FROM attendance
WHERE student_id=$1 AND subject_id=$2
ORDER BY date ASC`,
[studentId, subjectId]
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get monthly attendance dates for a student per subject
exports.getMonthlyStudent = async (req, res) => {
const { subjectId } = req.params;
const { month } = req.query; // YYYY-MM
const studentId = req.user.userId;
try {
const result = await pool.query(
`SELECT date, status FROM attendance
WHERE student_id=$1 AND subject_id=$2
AND TO_CHAR(date,'YYYY-MM')=$3
ORDER BY date`,
[studentId, subjectId, month]
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get a specific student's attendance detail for a subject (professor view)
exports.getStudentDetail = async (req, res) => {
  const { subjectId, studentId } = req.params;
  try {
    const summary = await pool.query(
      `SELECT
        u.name, u.roll_number,
        COUNT(a.*) FILTER (WHERE a.status = 'present') as present_count,
        COUNT(a.*) as total_count,
        ROUND(COUNT(a.*) FILTER (WHERE a.status = 'present') * 100.0 / NULLIF(COUNT(a.*), 0), 2) as percentage
      FROM users u
      LEFT JOIN attendance a ON a.student_id = u.id AND a.subject_id = $2
      WHERE u.id = $1
      GROUP BY u.name, u.roll_number`,
      [studentId, subjectId]
    );
    const records = await pool.query(
      `SELECT date, status FROM attendance
       WHERE student_id = $1 AND subject_id = $2
       ORDER BY date DESC`,
      [studentId, subjectId]
    );
    res.json({ summary: summary.rows[0], records: records.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get attendance report for all students in a subject (professor view)
exports.getSectionReport = async (req, res) => {
  const { subjectId } = req.params;
  try {
    const result = await pool.query(
      `SELECT
        u.id,
        u.name,
        u.roll_number,
        COUNT(a.*) FILTER (WHERE a.status = 'present') as present_count,
        COUNT(a.*) as total_count,
        ROUND(COUNT(a.*) FILTER (WHERE a.status = 'present') * 100.0 / NULLIF(COUNT(a.*), 0), 2) as percentage
      FROM users u
      LEFT JOIN attendance a ON a.student_id = u.id AND a.subject_id = $1
      WHERE u.role = 'student'
        AND u.year = (SELECT year FROM subjects WHERE id = $1)
      GROUP BY u.id, u.name, u.roll_number
      ORDER BY u.roll_number`,
      [subjectId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get overall attendance for a student (all subjects)
exports.getOverallAttendance = async (req, res) => {
const studentId = req.user.userId;
try {
const result = await pool.query(
`SELECT
s.name as subject_name,
s.id as subject_id,
COUNT(a.*) FILTER (WHERE a.status = 'present') as present_count,
COUNT(a.*) as total_count,
ROUND(COUNT(a.*) FILTER (WHERE a.status = 'present') * 100.0 / NULLIF(COUNT(a.*), 0), 2) as percentage
FROM subjects s
LEFT JOIN attendance a ON s.id = a.subject_id AND a.student_id = $1
WHERE s.year = (SELECT year FROM users WHERE id = $1)
GROUP BY s.id, s.name
ORDER BY s.name`,
[studentId]
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};