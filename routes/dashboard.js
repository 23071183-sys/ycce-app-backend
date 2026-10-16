const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getMyDashboard } = require('../controllers/dashboardController');

router.get('/me', authMiddleware, getMyDashboard);

module.exports = router;
