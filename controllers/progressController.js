const pool = require('../config/database');

// Private streaks and badges. Only the student themselves can see them: there
// is deliberately no endpoint that takes another user's id, and no leaderboard.

const BADGES = {
  perfect_week: { title: 'Perfect week', description: 'Every lecture in a week attended (at least 3)' },
  club_75: { title: '75% club', description: 'Overall attendance at 75% or more across 20+ lectures' },
  early_submitter: { title: 'Early submitter', description: '3 assignments handed in a day or more early' },
  quiz_master: { title: 'Quiz master', description: 'Full marks on a quiz of 5 or more questions' },
  fest_goer: { title: 'Fest goer', description: 'Checked in at a fest event' },
};

// Each check returns true when the student has earned the badge.
const CHECKS = {
  perfect_week: `SELECT 1 FROM attendance WHERE student_id = $1
                 GROUP BY date_trunc('week', date) HAVING COUNT(*) >= 3 AND BOOL_AND(status = 'present') LIMIT 1`,
  club_75: `SELECT 1 FROM attendance WHERE student_id = $1
            HAVING COUNT(*) >= 20 AND AVG(CASE WHEN status = 'present' THEN 1 ELSE 0 END) >= 0.75`,
  early_submitter: `SELECT 1 FROM assignment_submissions s JOIN assignments a ON a.id = s.assignment_id
                    WHERE s.student_id = $1 AND s.submitted_at::date < a.due_date
                    HAVING COUNT(*) >= 3`,
  quiz_master: `SELECT 1 FROM quiz_attempts WHERE student_id = $1 AND total >= 5 AND score = total LIMIT 1`,
  fest_goer: `SELECT 1 FROM event_registrations WHERE user_id = $1 AND status = 'checked_in' LIMIT 1`,
};

async function awardBadges(studentId) {
  const earned = [];
  for (const [badge, sql] of Object.entries(CHECKS)) {
    const { rows } = await pool.query(sql, [studentId]);
    if (!rows.length) continue;
    const { rowCount } = await pool.query(
      'INSERT INTO user_badges (user_id, badge) VALUES ($1, $2) ON CONFLICT DO NOTHING', [studentId, badge]
    );
    if (rowCount) earned.push(badge);
  }
  return earned;
}

async function streaks(studentId) {
  // Lectures: present marks in a row, newest first, until the first absence.
  const { rows: att } = await pool.query(
    `SELECT status FROM attendance WHERE student_id = $1 ORDER BY date DESC, id DESC LIMIT 400`, [studentId]
  );
  let lectures = 0;
  for (const r of att) { if (r.status !== 'present') break; lectures++; }

  // Study: days in a row with a flashcard review, ending today or yesterday (IST).
  const { rows: days } = await pool.query(
    `SELECT review_date FROM study_reviews_log WHERE student_id = $1 ORDER BY review_date DESC LIMIT 400`, [studentId]
  );
  let study = 0;
  const today = new Date(Date.now() + 5.5 * 3600_000);
  let expect = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let i = 0; i < days.length; i++) {
    const d = new Date(days[i].review_date);
    const day = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    if (i === 0 && day === expect - 86400_000) expect -= 86400_000; // nothing yet today: count from yesterday
    if (day !== expect) break;
    study++;
    expect -= 86400_000;
  }

  // Assignments: handed in on or before the due date, in a row, latest first.
  // Assignments that are past due and never submitted break the streak too.
  const { rows: subs } = await pool.query(
    `SELECT s.submitted_at::date <= a.due_date AS on_time
     FROM assignments a
     JOIN subjects sub ON sub.id = a.subject_id
     JOIN users u ON u.id = $1 AND u.year = sub.year
     LEFT JOIN assignment_submissions s ON s.assignment_id = a.id AND s.student_id = u.id
     WHERE s.id IS NOT NULL OR a.due_date < CURRENT_DATE
     ORDER BY a.due_date DESC, a.id DESC LIMIT 200`,
    [studentId]
  );
  let onTime = 0;
  for (const r of subs) { if (!r.on_time) break; onTime++; }

  return { lectures, study, on_time_submissions: onTime };
}

exports.me = async (req, res) => {
  if (req.user.role !== 'student') return res.json({ streaks: null, badges: [] });
  try {
    const newly = await awardBadges(req.user.userId);
    const { rows } = await pool.query('SELECT badge, earned_at FROM user_badges WHERE user_id = $1 ORDER BY earned_at', [req.user.userId]);
    const have = new Map(rows.map(r => [r.badge, r.earned_at]));
    res.json({
      streaks: await streaks(req.user.userId),
      badges: Object.entries(BADGES).map(([key, b]) => ({
        key, ...b, earned: have.has(key), earned_at: have.get(key) || null, new: newly.includes(key),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Nightly: award badges to everyone, so they're there when the student looks.
exports.nightly = async () => {
  try {
    const { rows } = await pool.query(`SELECT id FROM users WHERE role = 'student' AND status = 'approved'`);
    for (const { id } of rows) await awardBadges(id).catch(err => console.warn(`Badges for ${id}:`, err.message));
  } catch (err) {
    console.error('Nightly badges failed:', err.message);
  }
};

exports._internal = { awardBadges, streaks, BADGES };
