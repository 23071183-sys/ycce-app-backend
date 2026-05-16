const express = require('express');
const router = express.Router();
const { create, getGeneral, getByYear, getBySubject, delete: deleteAnnouncement } = require('../controllers/announcementController');
const authMiddleware = require('../middleware/auth');

const superAdminOnly = (req, res, next) => {
  if (req.user.role !== 'super_admin')
    return res.status(403).json({ error: 'Super admin access required' });
  next();
};

router.get('/general',           getGeneral);
router.get('/year/:year',        getByYear);
router.get('/subject/:subjectId', getBySubject);
router.post('/',                 authMiddleware, superAdminOnly, create);
router.delete('/:id',            authMiddleware, superAdminOnly, deleteAnnouncement);

module.exports = router;