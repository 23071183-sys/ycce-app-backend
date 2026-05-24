const express = require('express');
const router = express.Router();
const { create, getGeneral, getByYear, getBySubject, getAll, delete: deleteAnnouncement } = require('../controllers/announcementController');
const authMiddleware = require('../middleware/auth');

const superAdminOnly = (req, res, next) => {
  if (req.user.role !== 'super_admin')
    return res.status(403).json({ error: 'Super admin access required' });
  next();
};

// Professors can only post subject_specific; admins/super_admin can post any type
const staffCanPost = async (req, res, next) => {
  const { role, userId } = req.user;
  const allowed = ['super_admin', 'admin', 'professor'];
  if (!allowed.includes(role))
    return res.status(403).json({ error: 'Staff access required' });
  if (role === 'professor') {
    if (req.body.type !== 'subject_specific')
      return res.status(403).json({ error: 'Professors can only post subject-specific announcements' });
    if (!req.body.subject_id)
      return res.status(400).json({ error: 'subject_id is required for subject-specific announcements' });
    // Ensure professor teaches that subject
    const pool = require('../config/database');
    const { rows } = await pool.query('SELECT id FROM subjects WHERE id = $1 AND professor_id = $2', [req.body.subject_id, userId]);
    if (rows.length === 0)
      return res.status(403).json({ error: 'You can only post announcements for your own subjects' });
  }
  if (req.body.type === 'general' && !['super_admin', 'admin'].includes(role)) {
    // Check if this user was explicitly granted permission
    const pool = require('../config/database');
    const { rows } = await pool.query('SELECT can_post_general FROM users WHERE id = $1', [userId]);
    if (!rows[0]?.can_post_general)
      return res.status(403).json({ error: 'You do not have permission to post general announcements' });
  }
  next();
};

router.get('/all',               authMiddleware, getAll);
router.get('/general',           getGeneral);
router.get('/year/:year',        getByYear);
router.get('/subject/:subjectId', getBySubject);
router.post('/',                 authMiddleware, staffCanPost, create);
router.delete('/:id',            authMiddleware, superAdminOnly, deleteAnnouncement);

module.exports = router;
