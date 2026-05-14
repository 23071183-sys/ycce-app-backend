const pool = require('../config/database');
// Add timetable entry
exports.create = async (req, res) => {
const { subject_id, custom_subject_name, year, day, start_time, end_time, room } = req.body;
if (!custom_subject_name && !subject_id)
  return res.status(400).json({ error: 'Provide a subject name or select a subject' });
if (!start_time || !end_time)
  return res.status(400).json({ error: 'Start and end time are required (format: HH:MM)' });
try {
const result = await pool.query(
`INSERT INTO timetable (subject_id, custom_subject_name, year, day, start_time, end_time, room)
VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
[subject_id || null, custom_subject_name || null, year, day, start_time, end_time, room]
);
res.status(201).json(result.rows[0]);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get timetable by year
exports.getByYear = async (req, res) => {
const { year } = req.params;
try {
const result = await pool.query(
`SELECT t.*,
  COALESCE(t.custom_subject_name, s.name) as subject_name,
  u.name as professor_name
FROM timetable t
LEFT JOIN subjects s ON t.subject_id = s.id
LEFT JOIN users u ON s.professor_id = u.id
WHERE t.year = $1 AND t.is_active = true
ORDER BY
CASE t.day
WHEN 'Monday' THEN 1
WHEN 'Tuesday' THEN 2
WHEN 'Wednesday' THEN 3
WHEN 'Thursday' THEN 4
WHEN 'Friday' THEN 5
WHEN 'Saturday' THEN 6
END,
t.start_time`,
[year]
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Auto lecture notifications (called by cron job every minute)
exports.checkAndSendLectureNotifications = async () => {
try {
const now = new Date();
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const today = days[now.getDay()];
const currentHour = now.getHours();
const currentMinute = now.getMinutes();
// Time 15 minutes from now
const notifyMinute = (currentMinute + 15) % 60;
const notifyHour = currentMinute + 15 >= 60 ? currentHour + 1 : currentHour;
const notifyTime = `${String(notifyHour).padStart(2, '0')}:${String(notifyMinute).padStart(2, '0')}`;
// Current time
const currentTime = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
// Check for lectures starting in 15 minutes
const upcoming = await pool.query(
`SELECT t.*, s.name as subject_name, u.name as professor_name,
s.year
FROM timetable t
JOIN subjects s ON t.subject_id = s.id
LEFT JOIN users u ON s.professor_id = u.id
WHERE t.day = $1
AND t.is_active = true
AND CAST(t.start_time AS TEXT) LIKE $2`,
[today, notifyTime + '%']
);
for (const lecture of upcoming.rows) {
// Check if lecture was cancelled
const cancelled = await pool.query(
`SELECT id FROM announcements
WHERE subject_id = $1
AND is_cancelled = true
AND DATE(created_at) = CURRENT_DATE`,
[lecture.subject_id]
);
if (cancelled.rows.length === 0) {
const { sendExpoNotifications } = require('../config/notifications');
const students = await pool.query(
'SELECT expo_push_token FROM users WHERE year = $1 AND role = $2 AND expo_push_token IS NOT NULL',
[lecture.year, 'student']
);
const tokens = students.rows.map(s => s.expo_push_token).filter(Boolean);
if (tokens.length > 0) {
await sendExpoNotifications(tokens, 'Class Starting Soon', `${lecture.subject_name} starts in 15 minutes`, { type: 'lecture_reminder' });
}
console.log(`Reminder sent: ${lecture.subject_name} in 15 mins to ${tokens.length} students`);
}
}
// Check for lectures starting RIGHT NOW (commencement notification)
const starting = await pool.query(
`SELECT t.*, s.name as subject_name, s.year
FROM timetable t
JOIN subjects s ON t.subject_id = s.id
WHERE t.day = $1
AND t.is_active = true
AND CAST(t.start_time AS TEXT) LIKE $2`,
[today, currentTime + '%']
);
for (const lecture of starting.rows) {
const cancelled = await pool.query(
`SELECT id FROM announcements
WHERE subject_id = $1
AND is_cancelled = true
AND DATE(created_at) = CURRENT_DATE`,
[lecture.subject_id]
);
if (cancelled.rows.length === 0) {
const { sendExpoNotifications } = require('../config/notifications');
const students = await pool.query(
'SELECT expo_push_token FROM users WHERE year = $1 AND role = $2 AND expo_push_token IS NOT NULL',
[lecture.year, 'student']
);
const tokens = students.rows.map(s => s.expo_push_token).filter(Boolean);
if (tokens.length > 0) {
await sendExpoNotifications(tokens, lecture.subject_name + ' Started', 'Your lecture has begun. Time to attend!', { type: 'lecture_start' });
}
}
}
} catch (err) {
console.error('Notification cron error:', err);
}
};
// Delete timetable entry
exports.delete = async (req, res) => {
const { id } = req.params;
try {
await pool.query('UPDATE timetable SET is_active=false WHERE id=$1', [id]);
res.json({ message: 'Timetable entry removed' });
} catch (err) {
res.status(500).json({ error: err.message });
}
};