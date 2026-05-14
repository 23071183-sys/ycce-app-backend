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

module.exports = router;