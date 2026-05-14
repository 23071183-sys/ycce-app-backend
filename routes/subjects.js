const express = require('express');
const router = express.Router();
const { create, getByYear, getProfessorSubjects, update, delete: deleteSubject } = require('../controllers/subjectController');
const authMiddleware = require('../middleware/auth');

router.post('/', authMiddleware, create);
router.get('/year/:year', authMiddleware, getByYear);
router.get('/my-subjects', authMiddleware, getProfessorSubjects);
router.put('/:id', authMiddleware, update);
router.delete('/:id', authMiddleware, deleteSubject);

module.exports = router;