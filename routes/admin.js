const express = require('express');
const router = express.Router();
const { getPendingUsers, getAllUsers, approveUser, rejectUser, getStats, getAllSGPA, getFaculty, getAllSubjects, getAttendanceBySubjectDate, getAttendanceSummary, getMonthlyAttendance } = require('../controllers/adminController');
const authMiddleware = require('../middleware/auth');

const adminOnly = (req, res, next) => {
  if (!['super_admin', 'professor'].includes(req.user.role))
    return res.status(403).json({ error: 'Admin access required' });
  next();
};

router.get('/pending', authMiddleware, adminOnly, getPendingUsers);
router.get('/users', authMiddleware, adminOnly, getAllUsers);
router.get('/stats', authMiddleware, adminOnly, getStats);
router.get('/sgpa', authMiddleware, adminOnly, getAllSGPA);
router.get('/faculty', authMiddleware, adminOnly, getFaculty);
router.get('/subjects', authMiddleware, adminOnly, getAllSubjects);
router.get('/attendance', authMiddleware, adminOnly, getAttendanceBySubjectDate);
router.get('/attendance/monthly', authMiddleware, adminOnly, getMonthlyAttendance);
router.get('/attendance/summary', authMiddleware, adminOnly, getAttendanceSummary);
router.put('/users/:id/approve', authMiddleware, adminOnly, approveUser);
router.put('/users/:id/reject', authMiddleware, adminOnly, rejectUser);

module.exports = router;
