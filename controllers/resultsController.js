const pool = require('../config/database');

const MAX_TOTAL = 100;

// Reject anything that isn't a mark between 0 and the paper total. Returns the
// parsed number, or null for a blank, which means "not entered yet".
const parseMark = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_TOTAL) return undefined;
  return n;
};

// Every student in the subject's year with their marks for this semester, so the
// entry sheet lists the whole class rather than only those already graded.
exports.getMarksSheet = async (req, res) => {
  const { subjectId } = req.params;
  const { semester } = req.query;
  if (!semester) return res.status(400).json({ error: 'semester is required' });
  try {
    const subject = await pool.query('SELECT id, name, code, year FROM subjects WHERE id = $1', [subjectId]);
    if (subject.rows.length === 0) return res.status(404).json({ error: 'Subject not found' });

    const students = await pool.query(
      `SELECT u.id AS student_id, u.name AS student_name, u.roll_number,
              r.internal_marks, r.external_marks, r.total_marks, r.grade, r.result
       FROM users u
       LEFT JOIN results r
         ON r.student_id = u.id AND r.subject_id = $1 AND r.semester = $2
       WHERE u.role = 'student' AND u.year = $3 AND u.status = 'approved'
       ORDER BY u.roll_number`,
      [subjectId, semester, subject.rows[0].year]
    );
    res.json({ subject: subject.rows[0], semester: Number(semester), students: students.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Save a whole class's marks in one transaction, so a bad row cannot leave the
// sheet half-written.
exports.upsertBulk = async (req, res) => {
  const { subject_id, semester, academic_year, records } = req.body;
  if (!subject_id || !semester || !Array.isArray(records)) {
    return res.status(400).json({ error: 'subject_id, semester, and a records array are required' });
  }

  const rows = [];
  for (const rec of records) {
    const internal = parseMark(rec.internal_marks);
    const external = parseMark(rec.external_marks);
    if (internal === undefined || external === undefined) {
      return res.status(400).json({ error: `Marks for ${rec.roll_number || rec.student_id} must be between 0 and ${MAX_TOTAL}` });
    }
    if (internal === null && external === null) continue; // left blank; nothing to record
    const total = (internal || 0) + (external || 0);
    if (total > MAX_TOTAL) {
      return res.status(400).json({ error: `Total for ${rec.roll_number || rec.student_id} exceeds ${MAX_TOTAL}` });
    }
    rows.push({ student_id: rec.student_id, internal, external, total, grade: rec.grade || null, result: rec.result || (total >= 40 ? 'Pass' : 'Fail') });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        `INSERT INTO results (student_id, subject_id, semester, internal_marks, external_marks, total_marks, grade, result, academic_year)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (student_id, subject_id, semester)
         DO UPDATE SET internal_marks=$4, external_marks=$5, total_marks=$6, grade=$7, result=$8, academic_year=$9`,
        [r.student_id, subject_id, semester, r.internal, r.external, r.total, r.grade, r.result, academic_year || null]
      );
    }
    await client.query('COMMIT');
    res.json({ saved: rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

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
