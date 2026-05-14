const express = require('express');
const router = express.Router();
const { register, login, getProfile, updateFCMToken, sendOtp, verifyAndRegister, forgotPassword, resetPassword } = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

router.post('/register', register);
router.post('/send-otp', sendOtp);
router.post('/verify-register', verifyAndRegister);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/profile', authMiddleware, getProfile);
router.put('/fcm-token', authMiddleware, updateFCMToken);

module.exports = router;