const express = require('express');
const router = express.Router();
const { chat, adminChat, dashboardChat, servePdf, getHistory, clearHistory, getMemories, deleteMemory } = require('../controllers/chatController');
const authMiddleware = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');

// Student / professor chat — no file or DB tools
router.post('/', authMiddleware, chat);

// The signed-in user's saved conversation and the facts they asked it to remember
router.get('/history', authMiddleware, getHistory);
router.delete('/history', authMiddleware, clearHistory);
router.get('/memories', authMiddleware, getMemories);
router.delete('/memories/:id', authMiddleware, deleteMemory);

// Website dashboard chat — data viewing only, no file/write access (professors + admins)
router.post('/dashboard', authMiddleware, dashboardChat);

// Admin developer chat — file + DB tools, CLI use only
router.post('/admin', authMiddleware, adminOnly, adminChat);

// PDF download (students only — admins have no PDF feature)
router.get('/pdf/:filename', authMiddleware, servePdf);

module.exports = router;
