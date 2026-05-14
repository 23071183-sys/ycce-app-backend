const express = require('express');
const router = express.Router();
const { getMyResults, upsertResult, getBySubject, getCGPA, upsertSGPA } = require('../controllers/resultsController');
const authMiddleware = require('../middleware/auth');

router.get('/my', authMiddleware, getMyResults);
router.get('/cgpa', authMiddleware, getCGPA);
router.post('/sgpa', authMiddleware, upsertSGPA);
router.post('/', authMiddleware, upsertResult);
router.get('/subject/:subjectId', authMiddleware, getBySubject);

module.exports = router;
