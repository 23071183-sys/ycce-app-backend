const pool = require('../config/database');

exports.getPendingUsers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, year, roll_number, created_at
       FROM users WHERE status = 'pending' ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, year, roll_number, department, status, created_at
       FROM users WHERE role = 'student' ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getStats = async (req, res) => {
  try {
    const [total, pending, approved, ann] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM users WHERE role='student'`),
      pool.query(`SELECT COUNT(*) FROM users WHERE role='student' AND status='pending'`),
      pool.query(`SELECT COUNT(*) FROM users WHERE role='student' AND status='approved'`),
      pool.query(`SELECT COUNT(*) FROM announcements`),
    ]);
    res.json({
      total: parseInt(total.rows[0].count),
      pending: parseInt(pending.rows[0].count),
      approved: parseInt(approved.rows[0].count),
      announcements: parseInt(ann.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAllSGPA = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT sg.*, u.name as student_name, u.roll_number
       FROM semester_gpa sg
       JOIN users u ON sg.student_id = u.id
       ORDER BY sg.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getFaculty = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, can_post_general FROM users WHERE role IN ('professor','admin') ORDER BY role, name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAllSubjects = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.name as professor_name FROM subjects s
       LEFT JOIN users u ON s.professor_id = u.id ORDER BY s.year, s.name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAttendanceBySubjectDate = async (req, res) => {
  const { subject_id, date, year } = req.query;
  try {
    // Get all approved students for the year
    const students = await pool.query(
      `SELECT id, name, roll_number FROM users
       WHERE role='student' AND status='approved' AND year=$1
       ORDER BY roll_number`,
      [year]
    );
    // Get attendance records for this subject+date
    const records = subject_id && date ? await pool.query(
      `SELECT student_id, status FROM attendance
       WHERE subject_id=$1 AND date=$2`,
      [subject_id, date]
    ) : { rows: [] };

    const attendanceMap = {};
    records.rows.forEach(r => { attendanceMap[r.student_id] = r.status; });

    const result = students.rows.map(s => ({
      ...s,
      status: attendanceMap[s.id] || null,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMonthlyAttendance = async (req, res) => {
  const { subject_id, year, month } = req.query; // month = "2025-05"
  try {
    const result = await pool.query(
      `SELECT date,
        COUNT(*) FILTER (WHERE status='present') as present,
        COUNT(*) FILTER (WHERE status='absent') as absent,
        COUNT(*) as total
       FROM attendance
       WHERE subject_id=$1
         AND TO_CHAR(date,'YYYY-MM')=$2
       GROUP BY date
       ORDER BY date`,
      [subject_id, month]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAttendanceSummary = async (req, res) => {
  const { subject_id } = req.query;
  try {
    const result = await pool.query(
      `SELECT u.id as student_id, u.name as student_name, u.roll_number,
        COUNT(a.*) FILTER (WHERE a.status='present') as present,
        COUNT(a.*) as total,
        ROUND(COUNT(a.*) FILTER (WHERE a.status='present') * 100.0 / NULLIF(COUNT(a.*),0), 1) as percentage
       FROM users u
       LEFT JOIN attendance a ON a.student_id=u.id AND a.subject_id=$1
       WHERE u.role='student' AND u.status='approved'
       AND u.year = (SELECT year FROM subjects WHERE id = $1)
       GROUP BY u.id, u.name, u.roll_number
       ORDER BY u.roll_number`,
      [subject_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.approveUser = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`UPDATE users SET status = 'approved' WHERE id = $1`, [id]);
    res.json({ message: 'User approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.rejectUser = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`UPDATE users SET status = 'rejected' WHERE id = $1`, [id]);
    res.json({ message: 'User rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
