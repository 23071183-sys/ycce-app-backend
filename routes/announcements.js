const express = require('express');
const router = express.Router();
const { create, getGeneral, getByYear, getBySubject, delete: deleteAnnouncement } = require('../controllers/announcementController');
const authMiddleware = require('../middleware/auth');

router.post('/', authMiddleware, create);
router.get('/general', getGeneral);
router.get('/year/:year', getByYear);
router.get('/subject/:subjectId', getBySubject);
router.delete('/:id', authMiddleware, deleteAnnouncement);

module.exports = router;