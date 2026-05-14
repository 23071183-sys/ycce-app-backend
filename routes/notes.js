const express = require('express');
const router = express.Router();
const { getBySubject, create, delete: deleteNote } = require('../controllers/notesController');
const authMiddleware = require('../middleware/auth');
const { upload } = require('../config/cloudinary');

router.get('/subject/:subjectId', authMiddleware, getBySubject);
router.post('/', authMiddleware, upload.single('file'), create);
router.delete('/:id', authMiddleware, deleteNote);

module.exports = router;
