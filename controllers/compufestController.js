const pool = require('../config/database');
// Get committee (all, ordered by hierarchy)
exports.getCommittee = async (req, res) => {
try {
const result = await pool.query(
`SELECT * FROM compufest_committee
ORDER BY is_faculty_coordinator DESC, hierarchy_order ASC`
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Add committee member
exports.addMember = async (req, res) => {
const { name, position, hierarchy_order, linkedin_url, photo_url, contact, year, is_faculty_coordinator } = req.body;
try {
const result = await pool.query(
`INSERT INTO compufest_committee
(name, position, hierarchy_order, linkedin_url, photo_url, contact, year, is_faculty_coordinator)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
[name, position, hierarchy_order, linkedin_url, photo_url, contact, year, is_faculty_coordinator || false]
);
res.status(201).json(result.rows[0]);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Update committee member
exports.updateMember = async (req, res) => {
const { id } = req.params;
const { name, position, hierarchy_order, linkedin_url, photo_url, contact } = req.body;
try {
const result = await pool.query(
`UPDATE compufest_committee
SET name=$1, position=$2, hierarchy_order=$3, linkedin_url=$4, photo_url=$5, contact=$6
WHERE id=$7 RETURNING *`,
[name, position, hierarchy_order, linkedin_url, photo_url, contact, id]
);
res.json(result.rows[0]);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get all Compufest events
exports.getEvents = async (req, res) => {
try {
const result = await pool.query(
'SELECT * FROM compufest_events WHERE is_active=true ORDER BY event_date ASC'
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Create Compufest event
exports.createEvent = async (req, res) => {
const { title, description, event_date, venue, registration_link, banner_url } = req.body;
try {
const result = await pool.query(
`INSERT INTO compufest_events (title, description, event_date, venue, registration_link, banner_url)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
[title, description, event_date, venue, registration_link, banner_url]
);
res.status(201).json(result.rows[0]);
} catch (err) {
res.status(500).json({ error: err.message });
}
};
// Get Compufest announcements
exports.getAnnouncements = async (req, res) => {
try {
const result = await pool.query(
`SELECT fa.*, u.name as posted_by_name
FROM fest_announcements fa
LEFT JOIN users u ON fa.posted_by = u.id
WHERE fa.fest_type = 'compufest'
ORDER BY fa.created_at DESC`
);
res.json(result.rows);
} catch (err) {
res.status(500).json({ error: err.message });
}
};