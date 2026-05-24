const pool = require('../config/database');

// Get results for a student by semester
exports.getMyResults = async (req, res) => {
  const { semester } = req.query;
  const studentId = req.user.userId;
  try {
    const result = await pool.query(
      `SELECT r.*, s.name as subject_name, s.code as subject_code
       FROM results r
       JOIN subjects s ON r.subject_id = s.id
       WHERE r.student_id = $1 ${semester ? 'AND r.semester = $2' : ''}
       ORDER BY r.semester ASC, s.name ASC`,
      semester ? [studentId, semester] : [studentId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all SGPAs for a student and compute CGPA
exports.getCGPA = async (req, res) => {
  const studentId = req.user.userId;
  try {
    const result = await pool.query(
      `SELECT semester, sgpa, academic_year FROM semester_gpa
       WHERE student_id = $1 ORDER BY semester ASC`,
      [studentId]
    );
    const sgpaList = result.rows;
    const cgpa = sgpaList.length
      ? parseFloat((sgpaList.reduce((s, r) => s + parseFloat(r.sgpa), 0) / sgpaList.length).toFixed(2))
      : null;
    res.json({ sgpaList, cgpa });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Add or update SGPA for a semester (professor/admin)
exports.upsertSGPA = async (req, res) => {
  const { student_id, semester, sgpa, academic_year } = req.body;
  if (!student_id || !semester || sgpa === null || sgpa === undefined) {
    return res.status(400).json({ error: 'student_id, semester, and sgpa are required' });
  }
  try {
    const r = await pool.query(
      `INSERT INTO semester_gpa (student_id, semester, sgpa, academic_year)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (student_id, semester) DO UPDATE SET sgpa=$3, academic_year=$4
       RETURNING *`,
      [student_id, semester, sgpa, academic_year]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Add or update a result (professor/admin)
exports.upsertResult = async (req, res) => {
  const { student_id, subject_id, semester, internal_marks, external_marks, grade, result, academic_year } = req.body;
  if (!student_id || !subject_id || !semester) {
    return res.status(400).json({ error: 'student_id, subject_id, and semester are required' });
  }
  const total = (parseFloat(internal_marks || 0) + parseFloat(external_marks || 0)).toFixed(2);
  try {
    const r = await pool.query(
      `INSERT INTO results (student_id, subject_id, semester, internal_marks, external_marks, total_marks, grade, result, academic_year)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (student_id, subject_id, semester)
       DO UPDATE SET internal_marks=$4, external_marks=$5, total_marks=$6, grade=$7, result=$8, academic_year=$9
       RETURNING *`,
      [student_id, subject_id, semester, internal_marks, external_marks, total, grade, result || 'Pass', academic_year]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all results for a subject (professor view)
exports.getBySubject = async (req, res) => {
  const { subjectId } = req.params;
  const { semester } = req.query;
  try {
    const r = await pool.query(
      `SELECT r.*, u.name as student_name, u.roll_number
       FROM results r
       JOIN users u ON r.student_id = u.id
       WHERE r.subject_id = $1 ${semester ? 'AND r.semester = $2' : ''}
       ORDER BY u.roll_number`,
      semester ? [subjectId, semester] : [subjectId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
