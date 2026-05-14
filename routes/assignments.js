const express = require('express');
const router = express.Router();
const { create, getBySubject, submit, getSubmissions, grade } = require('../controllers/assignmentController');
const authMiddleware = require('../middleware/auth');
const { upload } = require('../config/cloudinary');

router.post('/', authMiddleware, upload.single('file'), create);
router.get('/subject/:subjectId', authMiddleware, getBySubject);
router.post('/submit', authMiddleware, upload.single('file'), submit);
router.get('/:assignmentId/submissions', authMiddleware, getSubmissions);
router.put('/submissions/:id/grade', authMiddleware, grade);

module.exports = router;