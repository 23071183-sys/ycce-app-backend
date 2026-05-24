const express = require('express');
const router = express.Router();
const { getCommittee, addMember, updateMember, getEvents, createEvent, getAnnouncements } = require('../controllers/compufestController');
const authMiddleware = require('../middleware/auth');

router.get('/committee', getCommittee);
router.post('/committee', authMiddleware, addMember);
router.put('/committee/:id', authMiddleware, updateMember);
router.get('/events', getEvents);
router.post('/events', authMiddleware, createEvent);
router.get('/announcements', getAnnouncements);

module.exports = router;
// Get committee for mobile app
router.get('/committee', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, position, photo_url, contact FROM compufest_committee
       ORDER BY is_faculty_coordinator DESC, hierarchy_order ASC LIMIT 20`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get events for mobile app
router.get('/events', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, description, event_date, venue, banner_url FROM compufest_events
       WHERE is_active = true ORDER BY event_date ASC LIMIT 10`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
