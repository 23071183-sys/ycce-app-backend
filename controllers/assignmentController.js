const pool = require('../config/database');
// Create assignment
exports.create = async (req, res) => {
const { title, description, subject_id, due_date } = req.body;
const file_url = req.file ? req.file.path : null;
const file_name = req.file ? req.file.originalname : null;
try {
const result = await pool.query(
`INSERT INTO assignments (title, description, subject_id, due_date, file_url, file_name, posted_by)
VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
[title, description, subject_id, due_date, file_url, file_name, req.user.userId]
);
res.status(201).json(result.rows[0]);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get assignments by subject, each carrying the caller's own submission so a
// student can see what they sent and what it was graded. The join is on the
// requesting user, so a professor simply gets nulls here.
exports.getBySubject = async (req, res) => {
const { subjectId } = req.params;
try {
const result = await pool.query(
`SELECT a.*, u.name as posted_by_name,
        s.id         AS submission_id,
        s.file_url   AS submission_file_url,
        s.file_name  AS submission_file_name,
        s.content    AS submission_content,
        s.submitted_at,
        s.grade,
        s.feedback
FROM assignments a
JOIN users u ON a.posted_by = u.id
LEFT JOIN assignment_submissions s
  ON s.assignment_id = a.id AND s.student_id = $2
WHERE a.subject_id = $1
ORDER BY a.due_date ASC`,
[subjectId, req.user.userId]
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Submit assignment
exports.submit = async (req, res) => {
const { assignment_id, content } = req.body;
const file_url = req.file ? req.file.path : (req.body.file_url || null);
const file_name = req.file ? req.file.originalname : null;
try {
const result = await pool.query(
`INSERT INTO assignment_submissions (assignment_id, student_id, content, file_url, file_name)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (assignment_id, student_id)
DO UPDATE SET content=$3, file_url=$4, file_name=$5, submitted_at=CURRENT_TIMESTAMP
RETURNING *`,
[assignment_id, req.user.userId, content, file_url, file_name]
);
res.status(201).json(result.rows[0]);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get submissions for an assignment (professor view)
exports.getSubmissions = async (req, res) => {
const { assignmentId } = req.params;
try {
const result = await pool.query(
`SELECT s.*, u.name as student_name, u.roll_number
FROM assignment_submissions s
JOIN users u ON s.student_id = u.id
WHERE s.assignment_id = $1
ORDER BY s.submitted_at DESC`,
[assignmentId]
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Grade a submission
exports.grade = async (req, res) => {
const { id } = req.params;
const { grade, feedback } = req.body;
try {
const result = await pool.query(
`UPDATE assignment_submissions SET grade=$1, feedback=$2
WHERE id=$3 RETURNING *`,
[grade, feedback, id]
);
res.json(result.rows[0]);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Cron: send push notification to students whose assignment is due in ~24 hours
exports.checkAndSendDeadlineNotifications = async () => {
  try {
    const { sendExpoNotifications } = require('../config/notifications');
    // Find assignments due between 23 and 25 hours from now (1-hour window around 24h mark)
    const result = await pool.query(
      `SELECT a.id, a.title, a.subject_id, s.name as subject_name, s.year
       FROM assignments a
       JOIN subjects s ON a.subject_id = s.id
       WHERE a.due_date BETWEEN NOW() + INTERVAL '23 hours' AND NOW() + INTERVAL '25 hours'`
    );
    for (const assignment of result.rows) {
      // Get tokens for students of this year who haven't submitted yet
      const students = await pool.query(
        `SELECT u.expo_push_token FROM users u
         WHERE u.role = 'student' AND u.year = $1 AND u.expo_push_token IS NOT NULL
         AND u.id NOT IN (
           SELECT student_id FROM assignment_submissions WHERE assignment_id = $2
         )`,
        [assignment.year, assignment.id]
      );
      const tokens = students.rows.map(s => s.expo_push_token).filter(Boolean);
      if (tokens.length > 0) {
        await sendExpoNotifications(
          tokens,
          'Assignment Due Tomorrow',
          `"${assignment.title}" (${assignment.subject_name}) is due in 24 hours!`,
          { type: 'assignment_deadline', assignment_id: assignment.id }
        );
        console.log(`Deadline reminder sent for "${assignment.title}" to ${tokens.length} students`);
      }
    }
  } catch (err) {
    console.error('Deadline notification cron error:', err);
  }
};
