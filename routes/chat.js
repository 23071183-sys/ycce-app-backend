const express = require('express');
const router = express.Router();
const { chat, adminChat, dashboardChat, servePdf } = require('../controllers/chatController');
const authMiddleware = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');

// Student / professor chat — no file or DB tools
router.post('/', authMiddleware, chat);

// Website dashboard chat — data viewing only, no file/write access (professors + admins)
router.post('/dashboard', authMiddleware, dashboardChat);

// Admin developer chat — file + DB tools, CLI use only
router.post('/admin', authMiddleware, adminOnly, adminChat);

// PDF download (students only — admins have no PDF feature)
router.get('/pdf/:filename', authMiddleware, servePdf);

module.exports = router;
