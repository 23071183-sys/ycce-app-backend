const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { getPendingUsers, getAllUsers, approveUser, rejectUser, getStats, getAllSGPA, getFaculty, getAllSubjects, getAttendanceBySubjectDate, getAttendanceSummary, getMonthlyAttendance } = require('../controllers/adminController');
const authMiddleware = require('../middleware/auth');

// Read access — professors + admins
const staffOnly = (req, res, next) => {
  if (!['super_admin', 'admin', 'professor'].includes(req.user.role))
    return res.status(403).json({ error: 'Access required' });
  next();
};

// Write access — super_admin only
const superAdminOnly = (req, res, next) => {
  if (req.user.role !== 'super_admin')
    return res.status(403).json({ error: 'Super admin access required' });
  next();
};

router.get('/pending',            authMiddleware, staffOnly, getPendingUsers);
router.get('/users',              authMiddleware, staffOnly, getAllUsers);
router.get('/stats',              authMiddleware, staffOnly, getStats);
router.get('/sgpa',               authMiddleware, staffOnly, getAllSGPA);
router.get('/faculty',            authMiddleware, staffOnly, getFaculty);
router.get('/subjects',           authMiddleware, staffOnly, getAllSubjects);
router.get('/attendance',         authMiddleware, staffOnly, getAttendanceBySubjectDate);
router.get('/attendance/monthly', authMiddleware, staffOnly, getMonthlyAttendance);
router.get('/attendance/summary', authMiddleware, staffOnly, getAttendanceSummary);

// Write — super_admin only
router.put('/users/:id/approve',  authMiddleware, superAdminOnly, approveUser);
router.put('/users/:id/reject',   authMiddleware, superAdminOnly, rejectUser);

// Toggle general announcement permission — admin + super_admin
const adminOnly = (req, res, next) => {
  if (!['super_admin', 'admin'].includes(req.user.role))
    return res.status(403).json({ error: 'Admin access required' });
  next();
};
router.put('/users/:id/toggle-general-post', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE users SET can_post_general = NOT can_post_general WHERE id = $1 RETURNING id, name, can_post_general`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

// Get pending users (for mobile app)
router.get('/pending', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, year, roll_number, created_at
       FROM users WHERE status = 'pending' ORDER BY created_at DESC LIMIT 5`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
