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
