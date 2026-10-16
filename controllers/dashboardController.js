const pool = require('../config/database');

// Everything the Home screen needs in one request. Render's free tier is slow
// to wake, so one round trip beats five. The shape depends on the role.

// Timetable "now" is college time, not the server's time zone.
const TODAY_IST = `to_char(now() AT TIME ZONE 'Asia/Kolkata', 'FMDay')`;
const NOW_IST_TIME = `(now() AT TIME ZONE 'Asia/Kolkata')::time`;

// Today's classes, with which one is on now and which is next.
async function todaysClasses(whereSql, params) {
  const { rows } = await pool.query(
    `SELECT t.id, t.start_time, t.end_time, t.room, t.year,
            COALESCE(t.custom_subject_name, s.name) AS subject_name, s.id AS subject_id, s.code AS subject_code,
            u.name AS professor_name,
            (${NOW_IST_TIME} >= t.start_time AND ${NOW_IST_TIME} < t.end_time) AS is_current,
            (t.start_time > ${NOW_IST_TIME}) AS is_upcoming
     FROM timetable t
     LEFT JOIN subjects s ON s.id = t.subject_id
     LEFT JOIN users u ON u.id = s.professor_id
     WHERE t.day = ${TODAY_IST} AND COALESCE(t.is_active, true) AND ${whereSql}
     ORDER BY t.start_time`,
    params
  );
  return {
    classes: rows,
    current: rows.find(r => r.is_current) || null,
    next: rows.find(r => r.is_upcoming) || null,
  };
}

async function unreadMessages(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM conversation_participants p
     JOIN messages m ON m.conversation_id = p.conversation_id
     WHERE p.user_id = $1 AND m.id > p.last_read_message_id
       AND m.sender_id <> $1 AND m.deleted_at IS NULL`,
    [userId]
  );
  return rows[0].n;
}

async function latestNotices(year, limit = 3) {
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.content, a.type, a.created_at, a.is_cancelled, u.name AS posted_by_name
     FROM announcements a
     LEFT JOIN users u ON u.id = a.posted_by
     WHERE a.type = 'general' OR (a.type = 'year_specific' AND a.year = $1)
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [year, limit]
  );
  return rows;
}

async function studentDashboard(user) {
  const today = await todaysClasses('t.year = $1', [user.year]);

  const attendance = await pool.query(
    `SELECT s.id AS subject_id, s.name AS subject_name,
            COUNT(a.*) FILTER (WHERE a.status = 'present')::int AS present,
            COUNT(a.*)::int AS total,
            ROUND(COUNT(a.*) FILTER (WHERE a.status = 'present') * 100.0 / NULLIF(COUNT(a.*), 0), 1) AS percentage
     FROM subjects s
     LEFT JOIN attendance a ON a.subject_id = s.id AND a.student_id = $1
     WHERE s.year = $2
     GROUP BY s.id, s.name`,
    [user.id, user.year]
  );
  const present = attendance.rows.reduce((n, r) => n + r.present, 0);
  const total = attendance.rows.reduce((n, r) => n + r.total, 0);
  const lowest = attendance.rows
    .filter(r => r.total > 0)
    .sort((a, b) => Number(a.percentage) - Number(b.percentage))
    .slice(0, 3);

  const deadlines = await pool.query(
    `SELECT a.id, a.title, a.due_date, s.id AS subject_id, s.name AS subject_name
     FROM assignments a
     JOIN subjects s ON s.id = a.subject_id
     WHERE s.year = $1 AND a.due_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND NOT EXISTS (SELECT 1 FROM assignment_submissions sub
                       WHERE sub.assignment_id = a.id AND sub.student_id = $2)
     ORDER BY a.due_date
     LIMIT 5`,
    [user.year, user.id]
  );

  const fees = await pool.query(
    `SELECT COALESCE(SUM(amount_due_paise - amount_paid_paise), 0)::bigint AS due,
            MIN(fs.due_date) AS next_due_date
     FROM fee_invoices fi
     JOIN fee_structures fs ON fs.id = fi.structure_id
     WHERE fi.student_id = $1 AND fi.status IN ('unpaid','partial')`,
    [user.id]
  );

  return {
    role: 'student',
    today,
    attendance: {
      percentage: total ? Math.round((present * 1000) / total) / 10 : null,
      present,
      total,
      lowest,
    },
    deadlines: deadlines.rows,
    notices: await latestNotices(user.year),
    unreadMessages: await unreadMessages(user.id),
    feesDue: { paise: Number(fees.rows[0].due), nextDueDate: fees.rows[0].next_due_date },
  };
}

async function professorDashboard(user) {
  const today = await todaysClasses('s.professor_id = $1', [user.id]);
  const grading = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM assignment_submissions sub
     JOIN assignments a ON a.id = sub.assignment_id
     JOIN subjects s ON s.id = a.subject_id
     WHERE s.professor_id = $1 AND sub.grade IS NULL`,
    [user.id]
  );
  const subjects = await pool.query(
    'SELECT id, name, code, year FROM subjects WHERE professor_id = $1 ORDER BY year, name',
    [user.id]
  );
  return {
    role: 'professor',
    today,
    pendingGrading: grading.rows[0].n,
    subjects: subjects.rows,
    notices: await latestNotices(null),
    unreadMessages: await unreadMessages(user.id),
  };
}

async function adminDashboard(user) {
  const counts = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE role = 'student' AND status = 'approved')::int AS students,
       COUNT(*) FILTER (WHERE role = 'professor')::int AS professors,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_approvals
     FROM users`
  );
  const fees = await pool.query(
    `SELECT COALESCE(SUM(amount_due_paise), 0)::bigint AS expected,
            COALESCE(SUM(amount_paid_paise), 0)::bigint AS collected
     FROM fee_invoices WHERE status <> 'cancelled'`
  );
  return {
    role: user.role,
    stats: counts.rows[0],
    fees: { expectedPaise: Number(fees.rows[0].expected), collectedPaise: Number(fees.rows[0].collected) },
    notices: await latestNotices(null),
    unreadMessages: await unreadMessages(user.id),
  };
}

exports.getMyDashboard = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, role, year, status FROM users WHERE id = $1',
      [req.user.userId]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    let data;
    if (user.role === 'student') data = await studentDashboard(user);
    else if (user.role === 'professor') data = await professorDashboard(user);
    else if (['admin', 'super_admin'].includes(user.role)) data = await adminDashboard(user);
    else data = { role: user.role, notices: await latestNotices(null), unreadMessages: await unreadMessages(user.id) };

    res.json({ user: { id: user.id, name: user.name, role: user.role, year: user.year }, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
