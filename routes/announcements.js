const express = require('express');
const router = express.Router();
const { create, getGeneral, getByYear, getBySubject, delete: deleteAnnouncement } = require('../controllers/announcementController');
const authMiddleware = require('../middleware/auth');

const superAdminOnly = (req, res, next) => {
  if (req.user.role !== 'super_admin')
    return res.status(403).json({ error: 'Super admin access required' });
  next();
};

// Staff can post, but only super_admin can post 'general' type
const staffCanPost = (req, res, next) => {
  const allowed = ['super_admin', 'admin', 'professor'];
  if (!allowed.includes(req.user.role))
    return res.status(403).json({ error: 'Staff access required' });
  if (req.body.type === 'general' && req.user.role !== 'super_admin')
    return res.status(403).json({ error: 'Only super admin can post general announcements' });
  next();
};

router.get('/general',           getGeneral);
router.get('/year/:year',        getByYear);
router.get('/subject/:subjectId', getBySubject);
router.post('/',                 authMiddleware, staffCanPost, create);
router.delete('/:id',            authMiddleware, superAdminOnly, deleteAnnouncement);

module.exports = router;