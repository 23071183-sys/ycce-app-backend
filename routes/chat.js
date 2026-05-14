const express = require('express');
const router = express.Router();
const { chat, adminChat, servePdf } = require('../controllers/chatController');
const authMiddleware = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');

// Student / professor chat — no file or DB tools
router.post('/', authMiddleware, chat);

// Admin developer chat — file + DB tools, double-guarded
router.post('/admin', authMiddleware, adminOnly, adminChat);

// PDF download (students only — admins have no PDF feature)
router.get('/pdf/:filename', authMiddleware, servePdf);

module.exports = router;
