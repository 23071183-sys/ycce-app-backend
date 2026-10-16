const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const m = require('../controllers/messageController');

// Direct messages. /api/chat is the AI assistant; this is people-to-people.
router.use(authMiddleware);

router.get('/contacts', m.getContacts);
router.get('/unread-count', m.unreadCount);
router.get('/conversations', m.listConversations);
router.post('/conversations', m.startConversation);
router.get('/conversations/:id/messages', m.getMessages);
router.post('/conversations/:id/messages', m.sendMessage);
router.post('/conversations/:id/read', m.markRead);
router.put('/conversations/:id/mute', m.setMuted);

module.exports = router;
