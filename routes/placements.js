const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { adminOnly } = require('../middleware/roles');
const p = require('../controllers/placementController');

router.use(authMiddleware);

router.get('/', p.list);
router.get('/:id', p.get);
router.post('/', adminOnly, p.create);
router.put('/:id', adminOnly, p.update);
router.delete('/:id', adminOnly, p.remove);

module.exports = router;
