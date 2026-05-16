const express = require('express');
const router = express.Router();
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

module.exports = router;
