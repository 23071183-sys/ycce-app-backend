const crypto = require('crypto');
const pool = require('../config/database');
const ai = require('../config/ai');

// Quizzes and flashcards built from a subject's past papers (question_bank)
// and the notes professors posted, plus a personal study planner.
// Generated sets are cached per subject and only rebuilt when the material
// changes or a student asks for a fresh one (rate limited).

// Error reply for the AI endpoints; admins also get the provider's raw detail.
const aiError = (req, res, err) => res.status(err.status || 500).json({
  error: err.message,
  ...(['admin', 'super_admin'].includes(req.user?.role) && err.detail ? { detail: err.detail } : {}),
});

const DAILY_LIMIT = 5;
const usage = new Map(); // `${userId}:${kind}:${YYYY-MM-DD}` -> count
const overLimit = (userId, kind) => {
  const key = `${userId}:${kind}:${new Date().toISOString().slice(0, 10)}`;
  const n = (usage.get(key) || 0) + 1;
  usage.set(key, n);
  return n > DAILY_LIMIT;
};

// A student may only study subjects of their own year; staff can open any.
async function subjectFor(user, subjectId) {
  const { rows: [s] } = await pool.query('SELECT id, name, code, year FROM subjects WHERE id = $1', [subjectId]);
  if (!s) return null;
  if (user.role === 'student') {
    const { rows: [me] } = await pool.query('SELECT year FROM users WHERE id = $1', [user.userId]);
    if (me?.year !== s.year) return null;
  }
  return s;
}

async function material(subjectId) {
  const { rows: questions } = await pool.query(
    `SELECT q.id, q.question, q.marks, q.topic, p.exam_type, p.academic_year
     FROM question_bank q LEFT JOIN question_papers p ON p.id = q.paper_id
     WHERE q.subject_id = $1 ORDER BY q.id DESC LIMIT 200`, [subjectId]
  );
  const { rows: notes } = await pool.query(
    `SELECT id, title, unit, content, created_at FROM notes WHERE subject_id = $1 ORDER BY created_at DESC LIMIT 30`, [subjectId]
  );
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify([questions.map(q => q.id), notes.map(n => [n.id, n.created_at])]))
    .digest('hex');
  const text = [
    questions.length ? '## Past exam questions\n' + questions.map(q =>
      `- [${(q.exam_type || 'paper').replace('_', '-')}${q.academic_year ? ' ' + q.academic_year : ''}${q.topic ? ' · ' + q.topic : ''}${q.marks ? ` · ${q.marks}m` : ''}] ${q.question}`).join('\n') : '',
    notes.length ? '## Professor notes\n' + notes.map(n =>
      `### ${n.title}${n.unit ? ` (Unit ${n.unit})` : ''}\n${(n.content || '').slice(0, 6000)}`).join('\n\n') : '',
  ].filter(Boolean).join('\n\n');
  return { hash, text, hasPapers: questions.length > 0, empty: !questions.length && !notes.some(n => n.content || n.title) };
}

const sourceBlock = (subject, text) => ({
  type: 'text',
  text: `Subject: ${subject.name} (${subject.code || ''}), year ${subject.year}, YCCE Computer Technology.\n\n${text}`,
  cache_control: { type: 'ephemeral' },
});

// ── Quiz ───────────────────────────────────────────────────────────────────

const QUIZ_TOOL = {
  name: 'save_quiz',
  description: 'Save a multiple-choice quiz.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array', minItems: 5, maxItems: 15,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
            answer: { type: 'integer', minimum: 0, maximum: 3, description: 'Index of the correct option' },
            explanation: { type: 'string', description: 'One or two sentences on why' },
            topic: { type: 'string' },
            from_past_paper: { type: 'boolean', description: 'True if based on a past MSE/RE-MSE/ESE question' },
          },
          required: ['question', 'options', 'answer', 'explanation', 'topic'],
        },
      },
    },
    required: ['questions'],
  },
};

const publicQuiz = (q) => ({
  id: q.id, subject_id: q.subject_id, created_at: q.created_at,
  questions: q.questions.map(({ answer, explanation, ...rest }) => rest),
});

exports.getQuiz = async (req, res) => {
  const subjectId = Number(req.params.subjectId);
  const fresh = req.query.fresh === '1';
  try {
    const subject = await subjectFor(req.user, subjectId);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });
    const src = await material(subjectId);
    const { rows: [cached] } = await pool.query(
      'SELECT * FROM quizzes WHERE subject_id = $1 ORDER BY id DESC LIMIT 1', [subjectId]
    );
    if (cached && !fresh && cached.source_hash === src.hash) return res.json(publicQuiz(cached));
    if (src.empty) {
      if (cached) return res.json(publicQuiz(cached));
      return res.status(409).json({ error: 'No past papers or notes for this subject yet' });
    }
    if (overLimit(req.user.userId, 'quiz')) {
      if (cached) return res.json({ ...publicQuiz(cached), limited: true });
      return res.status(429).json({ error: 'Daily limit reached. Try again tomorrow.' });
    }
    const out = await ai.callTool({
      system: 'You write exam-style multiple-choice questions for engineering students. Base them on the past exam questions and notes given; prefer topics that recur across past MSE 1, MSE 2 and RE-MSE papers. Each question has exactly one correct option. Keep it accurate.',
      content: [sourceBlock(subject, src.text), { type: 'text', text: 'Write a 10-question quiz.' }],
      tool: QUIZ_TOOL,
    });
    const questions = (out.questions || []).filter(q =>
      q?.question && Array.isArray(q.options) && q.options.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4);
    if (questions.length < 3) throw new Error('The quiz came back incomplete. Try again.');
    // Without any past papers the model can't know what came from one.
    if (!src.hasPapers) questions.forEach(q => { q.from_past_paper = false; });
    const { rows: [quiz] } = await pool.query(
      'INSERT INTO quizzes (subject_id, questions, source_hash) VALUES ($1, $2, $3) RETURNING *',
      [subjectId, JSON.stringify(questions), src.hash]
    );
    res.json(publicQuiz(quiz));
  } catch (err) {
    aiError(req, res, err);
  }
};

exports.submitQuiz = async (req, res) => {
  const answers = req.body?.answers;
  if (!Array.isArray(answers)) return res.status(400).json({ error: 'answers must be a list' });
  try {
    const { rows: [quiz] } = await pool.query('SELECT * FROM quizzes WHERE id = $1', [Number(req.params.quizId)]);
    if (!quiz || !(await subjectFor(req.user, quiz.subject_id))) return res.status(404).json({ error: 'Quiz not found' });
    const results = quiz.questions.map((q, i) => ({
      correct: answers[i] === q.answer, chosen: Number.isInteger(answers[i]) ? answers[i] : null,
      answer: q.answer, explanation: q.explanation, topic: q.topic,
    }));
    const score = results.filter(r => r.correct).length;
    if (req.user.role === 'student') {
      await pool.query(
        'INSERT INTO quiz_attempts (quiz_id, student_id, answers, score, total) VALUES ($1,$2,$3,$4,$5)',
        [quiz.id, req.user.userId, JSON.stringify(answers), score, quiz.questions.length]
      );
    }
    res.json({ score, total: quiz.questions.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Flashcards (SM-2 spaced repetition) ────────────────────────────────────

const CARDS_TOOL = {
  name: 'save_flashcards',
  description: 'Save revision flashcards.',
  input_schema: {
    type: 'object',
    properties: {
      cards: {
        type: 'array', minItems: 5, maxItems: 30,
        items: {
          type: 'object',
          properties: {
            front: { type: 'string', description: 'A short question or term' },
            back: { type: 'string', description: 'A concise answer, at most 3 sentences' },
            topic: { type: 'string' },
          },
          required: ['front', 'back', 'topic'],
        },
      },
    },
    required: ['cards'],
  },
};

exports.generateCards = async (req, res) => {
  const subjectId = Number(req.params.subjectId);
  try {
    const subject = await subjectFor(req.user, subjectId);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });
    const src = await material(subjectId);
    const { rows: existing } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM flashcards WHERE subject_id = $1 AND source_hash = $2', [subjectId, src.hash]
    );
    if (existing[0].n > 0) return res.json({ created: 0, up_to_date: true });
    if (src.empty) return res.status(409).json({ error: 'No past papers or notes for this subject yet' });
    if (overLimit(req.user.userId, 'cards')) return res.status(429).json({ error: 'Daily limit reached. Try again tomorrow.' });
    const { rows: have } = await pool.query('SELECT front FROM flashcards WHERE subject_id = $1', [subjectId]);
    const out = await ai.callTool({
      system: 'You make revision flashcards for engineering students from past exam questions and notes. Cover the definitions, formulas and concepts that past MSE/RE-MSE papers keep asking about. Be accurate and concise.',
      content: [sourceBlock(subject, src.text), {
        type: 'text',
        text: `Make 20 flashcards.${have.length ? ` These already exist, don't repeat them:\n${have.map(h => '- ' + h.front).join('\n').slice(0, 8000)}` : ''}`,
      }],
      tool: CARDS_TOOL,
    });
    const cards = (out.cards || []).filter(c => c?.front?.trim() && c?.back?.trim()).slice(0, 30);
    for (const c of cards) {
      await pool.query('INSERT INTO flashcards (subject_id, front, back, topic, source_hash) VALUES ($1,$2,$3,$4,$5)',
        [subjectId, c.front.trim().slice(0, 1000), c.back.trim().slice(0, 2000), (c.topic || '').slice(0, 160) || null, src.hash]);
    }
    res.status(201).json({ created: cards.length });
  } catch (err) {
    aiError(req, res, err);
  }
};

// Cards due for review: never seen, or due now. Optionally one subject.
exports.dueCards = async (req, res) => {
  const subjectId = req.query.subject_id ? Number(req.query.subject_id) : null;
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.subject_id, s.name AS subject_name, f.front, f.back, f.topic,
              r.due_at, r.repetitions, (r.card_id IS NULL) AS is_new
       FROM flashcards f
       JOIN subjects s ON s.id = f.subject_id
       JOIN users u ON u.id = $1
       LEFT JOIN flashcard_reviews r ON r.card_id = f.id AND r.student_id = u.id
       WHERE (u.role <> 'student' OR s.year = u.year)
         AND ($2::int IS NULL OR f.subject_id = $2)
         AND (r.card_id IS NULL OR r.due_at <= now())
       ORDER BY (r.card_id IS NULL), r.due_at, f.id
       LIMIT 30`,
      [req.user.userId, subjectId]
    );
    const { rows: [counts] } = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE r.card_id IS NULL OR r.due_at <= now())::int AS due
       FROM flashcards f JOIN subjects s ON s.id = f.subject_id JOIN users u ON u.id = $1
       LEFT JOIN flashcard_reviews r ON r.card_id = f.id AND r.student_id = u.id
       WHERE (u.role <> 'student' OR s.year = u.year) AND ($2::int IS NULL OR f.subject_id = $2)`,
      [req.user.userId, subjectId]
    );
    res.json({ cards: rows, ...counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// SM-2: grade 0-5 (0-2 forgot, 3 hard, 4 good, 5 easy).
function sm2(prev, grade) {
  let { ease = 2.5, interval_days: interval = 0, repetitions: reps = 0 } = prev || {};
  ease = Number(ease);
  if (grade < 3) {
    reps = 0;
    interval = 1;
  } else {
    interval = reps === 0 ? 1 : reps === 1 ? 6 : Math.round(interval * ease);
    reps += 1;
  }
  ease = Math.max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  return { ease: Math.round(ease * 100) / 100, interval_days: interval, repetitions: reps };
}

exports.reviewCard = async (req, res) => {
  const grade = Number(req.body?.grade);
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) return res.status(400).json({ error: 'grade must be 0 to 5' });
  try {
    const { rows: [card] } = await pool.query('SELECT * FROM flashcards WHERE id = $1', [Number(req.params.cardId)]);
    if (!card || !(await subjectFor(req.user, card.subject_id))) return res.status(404).json({ error: 'Card not found' });
    const { rows: [prev] } = await pool.query(
      'SELECT * FROM flashcard_reviews WHERE card_id = $1 AND student_id = $2', [card.id, req.user.userId]
    );
    const next = sm2(prev, grade);
    const { rows: [saved] } = await pool.query(
      `INSERT INTO flashcard_reviews (card_id, student_id, ease, interval_days, repetitions, due_at, last_reviewed_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $4), now())
       ON CONFLICT (card_id, student_id) DO UPDATE SET ease = $3, interval_days = $4, repetitions = $5,
         due_at = now() + make_interval(days => $4), last_reviewed_at = now()
       RETURNING *`,
      [card.id, req.user.userId, next.ease, next.interval_days, next.repetitions]
    );
    await pool.query(
      `INSERT INTO study_reviews_log (student_id, review_date) VALUES ($1, (now() AT TIME ZONE 'Asia/Kolkata')::date)
       ON CONFLICT DO NOTHING`, [req.user.userId]
    );
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Study planner ──────────────────────────────────────────────────────────

const PLAN_TOOL = {
  name: 'save_plan',
  description: 'Save a study plan.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '2-3 sentences on the strategy' },
      weeks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            week_start: { type: 'string', description: 'YYYY-MM-DD (a Monday)' },
            focus: { type: 'string' },
            days: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  date: { type: 'string', description: 'YYYY-MM-DD' },
                  tasks: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        subject_id: { type: 'integer' },
                        minutes: { type: 'integer' },
                        task: { type: 'string' },
                      },
                      required: ['subject_id', 'minutes', 'task'],
                    },
                  },
                },
                required: ['date', 'tasks'],
              },
            },
          },
          required: ['week_start', 'focus', 'days'],
        },
      },
    },
    required: ['summary', 'weeks'],
  },
};

// How much extra attention each subject needs: low attendance and low internal
// marks push it up. The model is told to split time roughly by this weight.
function weightFor(s) {
  let w = 1;
  if (s.attendance_pct != null && s.attendance_pct < 75) w += (75 - s.attendance_pct) / 25;
  if (s.marks_pct != null && s.marks_pct < 60) w += (60 - s.marks_pct) / 30;
  if (s.attendance_pct == null && s.marks_pct == null) w += 0.25;
  if (s.days_to_exam != null && s.days_to_exam <= 14) w += 0.5;
  return Math.round(w * 100) / 100;
}

async function plannerInput(studentId) {
  const { rows: [me] } = await pool.query('SELECT id, name, year FROM users WHERE id = $1', [studentId]);
  const { rows: subjects } = await pool.query(
    `SELECT s.id, s.name, s.code,
       (SELECT ROUND(100.0 * AVG(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END))::int FROM attendance a
         WHERE a.subject_id = s.id AND a.student_id = $1) AS attendance_pct,
       (SELECT ROUND(100.0 * (COALESCE(r.mse1_marks, CASE WHEN r.re_mse_for = 'mse1' THEN r.re_mse_marks END, 0)
                            + COALESCE(r.mse2_marks, CASE WHEN r.re_mse_for = 'mse2' THEN r.re_mse_marks END, 0)
                            + COALESCE(r.ta_marks, 0)) / 50)::int
         FROM results r WHERE r.subject_id = s.id AND r.student_id = $1
           AND (r.mse1_marks IS NOT NULL OR r.mse2_marks IS NOT NULL OR r.ta_marks IS NOT NULL OR r.re_mse_marks IS NOT NULL)
         ORDER BY r.id DESC LIMIT 1) AS marks_pct,
       (SELECT MIN(e.exam_date) - CURRENT_DATE FROM exam_schedule e WHERE e.subject_id = s.id AND e.exam_date >= CURRENT_DATE) AS days_to_exam
     FROM subjects s WHERE s.year = $2 ORDER BY s.name`,
    [studentId, me.year]
  );
  const { rows: exams } = await pool.query(
    `SELECT e.exam_type, e.exam_date, s.id AS subject_id, s.name FROM exam_schedule e JOIN subjects s ON s.id = e.subject_id
     WHERE s.year = $1 AND e.exam_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 60 ORDER BY e.exam_date`, [me.year]
  );
  const { rows: deadlines } = await pool.query(
    `SELECT a.title, a.due_date, s.id AS subject_id, s.name FROM assignments a JOIN subjects s ON s.id = a.subject_id
     WHERE s.year = $1 AND a.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
       AND NOT EXISTS (SELECT 1 FROM assignment_submissions x WHERE x.assignment_id = a.id AND x.student_id = $2)
     ORDER BY a.due_date`, [me.year, studentId]
  );
  return { me, subjects: subjects.map(s => ({ ...s, weight: weightFor(s) })), exams, deadlines };
}

exports.generatePlan = async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Plans are for students' });
  const hoursPerDay = Math.min(Math.max(Number(req.body?.hours_per_day) || 2, 0.5), 8);
  const weeks = Math.min(Math.max(Number(req.body?.weeks) || 2, 1), 4);
  try {
    const input = await plannerInput(req.user.userId);
    if (!input.subjects.length) return res.status(409).json({ error: 'No subjects found for your year' });
    if (overLimit(req.user.userId, 'plan')) return res.status(429).json({ error: 'Daily limit reached. Try again tomorrow.' });
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const out = await ai.callTool({
      system: 'You plan study time for an engineering student. Split time across subjects roughly in proportion to each subject\'s weight (a higher weight means weaker or more urgent, so it gets more minutes). Put revision for an exam in the days before it, and assignment work before its deadline. Tasks are concrete (e.g. "Solve 5 past MSE 2 questions on normalisation"). Use only the subject_ids given.',
      content: [{
        type: 'text',
        text: JSON.stringify({
          today, weeks, minutes_per_day: Math.round(hoursPerDay * 60),
          subjects: input.subjects.map(({ id, name, attendance_pct, marks_pct, days_to_exam, weight }) =>
            ({ subject_id: id, name, attendance_pct, internal_marks_pct: marks_pct, days_to_exam, weight })),
          upcoming_exams: input.exams, pending_deadlines: input.deadlines,
        }),
      }],
      tool: PLAN_TOOL,
      maxTokens: 12000,
    });
    const valid = new Set(input.subjects.map(s => s.id));
    const names = new Map(input.subjects.map(s => [s.id, s.name]));
    for (const w of out.weeks || []) for (const d of w.days || []) {
      d.tasks = (d.tasks || []).filter(t => valid.has(t.subject_id)).map(t => ({ ...t, subject: names.get(t.subject_id) }));
    }
    const plan = { ...out, generated_for: today, hours_per_day: hoursPerDay, weights: input.subjects.map(s => ({ subject_id: s.id, subject: s.name, weight: s.weight })) };
    const { rows: [saved] } = await pool.query(
      'INSERT INTO study_plans (student_id, plan) VALUES ($1, $2) RETURNING id, plan, created_at', [req.user.userId, JSON.stringify(plan)]
    );
    res.status(201).json(saved);
  } catch (err) {
    aiError(req, res, err);
  }
};

exports.getPlan = async (req, res) => {
  try {
    const { rows: [p] } = await pool.query(
      'SELECT id, plan, created_at FROM study_plans WHERE student_id = $1 ORDER BY id DESC LIMIT 1', [req.user.userId]
    );
    res.json(p || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports._internal = { sm2, weightFor, material, plannerInput, QUIZ_TOOL, CARDS_TOOL, PLAN_TOOL };
