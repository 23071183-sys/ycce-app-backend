const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { me } = require('../controllers/progressController');

// Only the signed-in student's own progress; there is no way to look up anyone else's.
router.get('/me', authMiddleware, me);

module.exports = router;
