const express = require('express');
const router = express.Router();
const { getMyResults, upsertResult, getBySubject, getCGPA, upsertSGPA } = require('../controllers/resultsController');
const authMiddleware = require('../middleware/auth');

const superAdminOnly = (req, res, next) => {
  if (req.user.role !== 'super_admin')
    return res.status(403).json({ error: 'Super admin access required' });
  next();
};

router.get('/my',                  authMiddleware, getMyResults);
router.get('/cgpa',                authMiddleware, getCGPA);
router.get('/subject/:subjectId',  authMiddleware, getBySubject);
router.post('/sgpa',               authMiddleware, superAdminOnly, upsertSGPA);
router.post('/',                   authMiddleware, superAdminOnly, upsertResult);

module.exports = router;
