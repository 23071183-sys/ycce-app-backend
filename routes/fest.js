const express = require('express');
const router = express.Router();
const { getEvents, createEvent, getAnnouncements, createAnnouncement } = require('../controllers/festController');
const authMiddleware = require('../middleware/auth');

router.get('/events', getEvents);
router.post('/events', authMiddleware, createEvent);
router.get('/announcements', getAnnouncements);
router.post('/announcements', authMiddleware, createAnnouncement);

module.exports = router;