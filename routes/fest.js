const express = require('express');
const router = express.Router();
const { getEvents, createEvent, getAnnouncements, createAnnouncement } = require('../controllers/festController');
const authMiddleware = require('../middleware/auth');

router.get('/events', getEvents);
router.post('/events', authMiddleware, createEvent);
router.get('/announcements', getAnnouncements);
router.post('/announcements', authMiddleware, createAnnouncement);

module.exports = router;
// Get fest announcements for mobile app
router.get('/announcements', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT fa.id, fa.title, fa.content, fa.created_at, u.name as posted_by_name
       FROM fest_announcements fa
       LEFT JOIN users u ON fa.posted_by = u.id
       WHERE fa.fest_type = 'yash' ORDER BY fa.created_at DESC LIMIT 10`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get fest events for mobile app
router.get('/events', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, description, event_date, venue, category FROM fest_events
       WHERE is_active = true ORDER BY event_date ASC LIMIT 10`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
