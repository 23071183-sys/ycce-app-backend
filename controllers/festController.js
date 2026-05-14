const pool = require('../config/database');
// Get all Yash fest events
exports.getEvents = async (req, res) => {
try {
const result = await pool.query(
'SELECT * FROM fest_events WHERE is_active=true ORDER BY event_date ASC'
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Create Yash fest event
exports.createEvent = async (req, res) => {
const { title, description, event_date, venue, registration_link, banner_url, category } = req.body;
try {
const result = await pool.query(
`INSERT INTO fest_events (title, description, event_date, venue, registration_link, banner_url, category)
VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
[title, description, event_date, venue, registration_link, banner_url, category]
);
res.status(201).json(result.rows[0]);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get Yash fest announcements
exports.getAnnouncements = async (req, res) => {
try {
const result = await pool.query(
`SELECT fa.*, u.name as posted_by_name
FROM fest_announcements fa
LEFT JOIN users u ON fa.posted_by = u.id
WHERE fa.fest_type = 'yash'
ORDER BY fa.created_at DESC`
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Create announcement (for either fest)
exports.createAnnouncement = async (req, res) => {
const { title, content, fest_type } = req.body;
try {
const result = await pool.query(
`INSERT INTO fest_announcements (title, content, fest_type, posted_by)
VALUES ($1, $2, $3, $4) RETURNING *`,
[title, content, fest_type, req.user.userId]
);
res.status(201).json(result.rows[0]);
} catch (err) {
res.status(500).json({ error: err.message });
}
};