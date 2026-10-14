const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { getMyResults, upsertResult, getBySubject, getCGPA, upsertSGPA, getMarksSheet, upsertBulk } = require('../controllers/resultsController');
const authMiddleware = require('../middleware/auth');

const superAdminOnly = (req, res, next) => {
  if (req.user.role !== 'super_admin')
    return res.status(403).json({ error: 'Super admin access required' });
  next();
};

// Admins mark any subject; a professor only the ones they actually teach, so
// marks cannot be written for someone else's class.
const canEnterMarks = async (req, res, next) => {
  const { role, userId } = req.user;
  if (['super_admin', 'admin'].includes(role)) return next();
  if (role !== 'professor')
    return res.status(403).json({ error: 'Staff access required' });

  const subjectId = req.body.subject_id || req.params.subjectId;
  if (!subjectId)
    return res.status(400).json({ error: 'subject_id is required' });

  try {
    const { rows } = await pool.query(
      'SELECT id FROM subjects WHERE id = $1 AND professor_id = $2',
      [subjectId, userId]
    );
    if (rows.length === 0)
      return res.status(403).json({ error: 'You can only enter marks for your own subjects' });
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

router.get('/my',                        authMiddleware, getMyResults);
router.get('/cgpa',                      authMiddleware, getCGPA);
router.get('/subject/:subjectId',        authMiddleware, getBySubject);
router.get('/subject/:subjectId/sheet',  authMiddleware, canEnterMarks, getMarksSheet);
router.post('/bulk',                     authMiddleware, canEnterMarks, upsertBulk);
router.post('/sgpa',                     authMiddleware, superAdminOnly, upsertSGPA);
router.post('/',                         authMiddleware, canEnterMarks, upsertResult);

module.exports = router;
