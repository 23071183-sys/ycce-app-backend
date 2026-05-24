const express = require('express');
const router = express.Router();
const { getDirectory, getUserById, searchUsers, updateProfile, getStudentsByYear, getFaculty, updatePushToken } = require('../controllers/userController');
const authMiddleware = require('../middleware/auth');

router.get('/directory', getDirectory);
router.get('/faculty', authMiddleware, getFaculty);
router.get('/search', authMiddleware, searchUsers);
router.get('/students/year/:year', authMiddleware, getStudentsByYear);
router.get('/:id', getUserById);
router.put('/profile', authMiddleware, updateProfile);
router.put('/push-token', authMiddleware, updatePushToken);

module.exports = router;
