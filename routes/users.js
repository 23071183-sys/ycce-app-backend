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

// Get faculty list for mobile app
router.get('/faculty', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, designation, department FROM users
       WHERE role = 'professor' ORDER BY name ASC LIMIT 30`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
