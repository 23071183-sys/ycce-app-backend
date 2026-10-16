const express = require('express');
const router = express.Router();
const { mark, markBulk, getStudentAttendance, getOverallAttendance, getMonthlyStudent, getSubjectDetail, getSectionReport, getStudentDetail } = require('../controllers/attendanceController');
const authMiddleware = require('../middleware/auth');

router.post('/mark', authMiddleware, mark);
router.post('/mark-bulk', authMiddleware, markBulk);
router.get('/subject/:subjectId', authMiddleware, getStudentAttendance);
router.get('/subject/:subjectId/detail', authMiddleware, getSubjectDetail);
router.get('/subject/:subjectId/monthly', authMiddleware, getMonthlyStudent);
router.get('/subject/:subjectId/report', authMiddleware, getSectionReport);
router.get('/subject/:subjectId/student/:studentId', authMiddleware, getStudentDetail);
router.get('/overall', authMiddleware, getOverallAttendance);

// QR attendance sessions
const qr = require('../controllers/qrAttendanceController');
const { staffOnly } = require('../middleware/roles');
router.post('/sessions', authMiddleware, staffOnly, qr.start);
router.post('/sessions/scan', authMiddleware, qr.scan);
router.get('/sessions/:id', authMiddleware, staffOnly, qr.detail);
router.get('/sessions/:id/token', authMiddleware, staffOnly, qr.token);
router.post('/sessions/:id/close', authMiddleware, staffOnly, qr.close);

module.exports = router;
