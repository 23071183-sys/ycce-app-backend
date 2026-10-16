const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const e = require('../controllers/eventRegController');

// Registrations for fest and compufest events. :type is 'fest' or 'compufest'.
const checker = requireRoles(e.CHECKERS, 'Only fest admins can do this');

router.use(authMiddleware);

router.get('/registrations/my', e.mine);
router.post('/check-in', checker, e.checkIn);
router.get('/:type/counts', e.counts);
router.post('/:type/:eventId/register', e.register);
router.delete('/:type/:eventId/register', e.cancel);
router.get('/:type/:eventId/registrations', checker, e.registrations);

module.exports = router;
