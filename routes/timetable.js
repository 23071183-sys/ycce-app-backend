const express = require('express');
const router = express.Router();
const { getByYear, create, delete: deleteTimetable } = require('../controllers/timetableController');
const authMiddleware = require('../middleware/auth');

router.get('/year/:year', getByYear);
router.post('/', authMiddleware, create);
router.delete('/:id', authMiddleware, deleteTimetable);

module.exports = router;