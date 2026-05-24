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
// Get overall attendance for student (for mobile app)
router.get('/overall', authMiddleware, async (req, res) => {
  try {
    const studentId = req.user.userId;
    const result = await pool.query(
      `SELECT
        s.name as subject_name,
        s.id as subject_id,
        COUNT(a.*) FILTER (WHERE a.status = 'present') as present_count,
        COUNT(a.*) as total_count,
        ROUND(COUNT(a.*) FILTER (WHERE a.status = 'present') * 100.0 / NULLIF(COUNT(a.*), 0), 2) as percentage
      FROM subjects s
      LEFT JOIN attendance a ON s.id = a.subject_id AND a.student_id = $1
      WHERE s.year = (SELECT year FROM users WHERE id = $1)
      GROUP BY s.id, s.name
      ORDER BY s.name`,
      [studentId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
