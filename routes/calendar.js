const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const c = require('../controllers/calendarController');

router.get('/link', authMiddleware, c.link);
router.post('/reset', authMiddleware, c.reset);
// Public: calendar apps can't send a login token, so the URL token is the key.
router.get('/:token', c.feed);

module.exports = router;
