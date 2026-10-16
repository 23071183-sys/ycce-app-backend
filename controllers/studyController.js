const pool = require('../config/database');
const ai = require('../config/ai');

// Past question papers (MSE 1, MSE 2, RE-MSE, ESE) and the exam schedule.
// Professors upload papers for their own subjects, admins for any. Each paper
// is read once by Claude and its questions go into question_bank, which the
// quizzes, flashcards and planner draw on.

const EXAM_TYPES = ['MSE1', 'MSE2', 'RE_MSE', 'ESE'];
const ADMIN_ROLES = ['admin', 'super_admin'];

const EXTRACT_TOOL = {
  name: 'save_questions',
  description: 'Save every question found in the exam paper.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'Full question text, including any sub-parts and given data' },
            marks: { type: ['number', 'null'] },
            topic: { type: 'string', description: 'Short topic or unit name, 2-5 words' },
          },
          required: ['question', 'topic'],
        },
      },
    },
    required: ['questions'],
  },
};

async function extractPaper(paperId) {
  const { rows: [p] } = await pool.query(
    `UPDATE question_papers SET extract_status = 'processing', extract_error = NULL
     WHERE id = $1 AND extract_status <> 'processing' RETURNING *`, [paperId]
  );
  if (!p) return;
  try {
    const { rows: [subj] } = await pool.query('SELECT name, code FROM subjects WHERE id = $1', [p.subject_id]);
    const doc = await ai.fileBlock(p.file_url, p.file_name);
    const out = await ai.callTool({
      system: 'You read college exam papers and transcribe their questions accurately. Do not invent questions. Skip instructions to candidates.',
      content: [doc, { type: 'text', text: `This is a ${p.exam_type.replace('_', '-')} paper for "${subj?.name}" (${subj?.code || ''}). Save every question.` }],
      tool: EXTRACT_TOOL,
    });
    const qs = (out.questions || []).filter(q => q?.question?.trim()).slice(0, 200);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM question_bank WHERE paper_id = $1', [p.id]);
      for (const q of qs) {
        await client.query(
          `INSERT INTO question_bank (subject_id, paper_id, question, marks, topic, source) VALUES ($1,$2,$3,$4,$5,'paper')`,
          [p.subject_id, p.id, q.question.trim().slice(0, 4000), Number.isFinite(+q.marks) ? +q.marks : null, (q.topic || '').slice(0, 160) || null]
        );
      }
      await client.query(`UPDATE question_papers SET extract_status = 'done' WHERE id = $1`, [p.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn(`Paper ${paperId} extraction failed:`, err.message);
    await pool.query(`UPDATE question_papers SET extract_status = 'failed', extract_error = $2 WHERE id = $1`,
      [paperId, err.message.slice(0, 500)]).catch(() => {});
  }
}

const canManageSubject = async (user, subjectId) => {
  if (ADMIN_ROLES.includes(user.role)) return true;
  if (user.role !== 'professor') return false;
  const { rows } = await pool.query('SELECT 1 FROM subjects WHERE id = $1 AND professor_id = $2', [subjectId, user.userId]);
  return rows.length > 0;
};

exports.uploadPaper = async (req, res) => {
  const subjectId = Number(req.body?.subject_id);
  const examType = req.body?.exam_type;
  if (!subjectId || !EXAM_TYPES.includes(examType)) return res.status(400).json({ error: 'subject_id and exam_type (MSE1, MSE2, RE_MSE, ESE) are required' });
  if (!req.file && !req.body?.file_url) return res.status(400).json({ error: 'Attach the paper (PDF or photo)' });
  try {
    if (!(await canManageSubject(req.user, subjectId))) return res.status(403).json({ error: 'You can only upload papers for your own subjects' });
    const { rows: [p] } = await pool.query(
      `INSERT INTO question_papers (subject_id, exam_type, academic_year, file_url, file_name, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [subjectId, examType, req.body.academic_year || null, req.file ? req.file.path : req.body.file_url,
       req.file ? req.file.originalname : null, req.user.userId]
    );
    if (ai.configured()) extractPaper(p.id); // in the background
    res.status(201).json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.listPapers = async (req, res) => {
  const subjectId = req.query.subject_id ? Number(req.query.subject_id) : null;
  try {
    const { rows } = await pool.query(
      `SELECT p.*, s.name AS subject_name, s.code, s.year, u.name AS uploaded_by_name,
              (SELECT COUNT(*)::int FROM question_bank q WHERE q.paper_id = p.id) AS question_count
       FROM question_papers p JOIN subjects s ON s.id = p.subject_id LEFT JOIN users u ON u.id = p.uploaded_by
       WHERE ($1::int IS NULL OR p.subject_id = $1)
         AND ($2::text <> 'student' OR s.year = (SELECT year FROM users WHERE id = $3))
         AND ($2::text <> 'professor' OR s.professor_id = $3 OR $1::int IS NOT NULL)
       ORDER BY p.created_at DESC`,
      [subjectId, req.user.role, req.user.userId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.paperQuestions = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, question, marks, topic FROM question_bank WHERE paper_id = $1 ORDER BY id', [Number(req.params.id)]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.retryExtract = async (req, res) => {
  try {
    const { rows: [p] } = await pool.query('SELECT * FROM question_papers WHERE id = $1', [Number(req.params.id)]);
    if (!p) return res.status(404).json({ error: 'Paper not found' });
    if (!(await canManageSubject(req.user, p.subject_id))) return res.status(403).json({ error: 'Not your subject' });
    if (!ai.configured()) return res.status(503).json({ error: 'AI is not set up on the server' });
    await pool.query(`UPDATE question_papers SET extract_status = 'pending' WHERE id = $1 AND extract_status <> 'processing'`, [p.id]);
    extractPaper(p.id);
    res.json({ status: 'processing' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deletePaper = async (req, res) => {
  try {
    const { rows: [p] } = await pool.query('SELECT * FROM question_papers WHERE id = $1', [Number(req.params.id)]);
    if (!p) return res.status(404).json({ error: 'Paper not found' });
    if (!(await canManageSubject(req.user, p.subject_id))) return res.status(403).json({ error: 'Not your subject' });
    await pool.query('DELETE FROM question_papers WHERE id = $1', [p.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Exam schedule ──────────────────────────────────────────────────────────

exports.listExams = async (req, res) => {
  try {
    let year = req.query.year ? Number(req.query.year) : null;
    if (req.user.role === 'student') {
      ({ rows: [{ year }] } = await pool.query('SELECT year FROM users WHERE id = $1', [req.user.userId]));
    }
    const { rows } = await pool.query(
      `SELECT e.*, s.name AS subject_name, s.code, s.year FROM exam_schedule e JOIN subjects s ON s.id = e.subject_id
       WHERE ($1::int IS NULL OR s.year = $1) AND ($2::boolean OR e.exam_date >= CURRENT_DATE - 1)
       ORDER BY e.exam_date, e.start_time NULLS LAST`,
      [year, req.query.all === '1']
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.upsertExam = async (req, res) => {
  const { subject_id, exam_type, exam_date, start_time, room, academic_year } = req.body || {};
  if (!Number(subject_id) || !EXAM_TYPES.includes(exam_type) || !/^\d{4}-\d{2}-\d{2}$/.test(exam_date || '')) {
    return res.status(400).json({ error: 'subject_id, exam_type and exam_date (YYYY-MM-DD) are required' });
  }
  if (start_time && !/^\d{2}:\d{2}(:\d{2})?$/.test(start_time)) return res.status(400).json({ error: 'Start time looks like 10:00' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO exam_schedule (subject_id, exam_type, exam_date, start_time, room, academic_year)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (subject_id, exam_type, academic_year)
       DO UPDATE SET exam_date = EXCLUDED.exam_date, start_time = EXCLUDED.start_time, room = EXCLUDED.room
       RETURNING *`,
      [Number(subject_id), exam_type, exam_date, start_time || null, room || null, academic_year || '']
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteExam = async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM exam_schedule WHERE id = $1', [Number(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: 'Exam not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports._internal = { extractPaper, canManageSubject, EXAM_TYPES };
