const express = require('express');
const router = express.Router();
const {
  getDirectory, getUserById, searchUsers, updateProfile, getStudentsByYear, getFaculty, updatePushToken,
  getMe, updatePhoto, removePhoto, updateNotificationPrefs,
} = require('../controllers/userController');
const authMiddleware = require('../middleware/auth');
const { imageUpload } = require('../config/cloudinary');

// Every route here needs a signed-in user: the directory and user lookups
// expose emails and roll numbers, and were open to anyone before.
// Fixed paths are registered before '/:id' so they aren't read as an id.
router.get('/me', authMiddleware, getMe);
router.put('/profile', authMiddleware, updateProfile);
router.post('/profile/photo', authMiddleware, imageUpload.single('photo'), updatePhoto);
router.delete('/profile/photo', authMiddleware, removePhoto);
router.put('/notification-prefs', authMiddleware, updateNotificationPrefs);
router.put('/push-token', authMiddleware, updatePushToken);
router.get('/directory', authMiddleware, getDirectory);
router.get('/faculty', authMiddleware, getFaculty);
router.get('/search', authMiddleware, searchUsers);
router.get('/students/year/:year', authMiddleware, getStudentsByYear);
router.get('/:id', authMiddleware, getUserById);

module.exports = router;
