// Role gates used after authMiddleware. Admins in the broad sense are admin and
// super_admin; staff adds professors.
const ADMIN_ROLES = ['super_admin', 'admin'];
const STAFF_ROLES = ['super_admin', 'admin', 'professor'];

const requireRoles = (roles, message = 'You do not have access to this') => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: message });
  next();
};

// The original export was a function called as roleMiddleware('admin', ...);
// it still works that way, with the named helpers attached to it.
const roleMiddleware = (...roles) => requireRoles(roles, 'Access denied');

module.exports = Object.assign(roleMiddleware, {
  ADMIN_ROLES,
  STAFF_ROLES,
  requireRoles,
  adminOnly: requireRoles(ADMIN_ROLES, 'Admin access required'),
  superAdminOnly: requireRoles(['super_admin'], 'Super admin access required'),
  staffOnly: requireRoles(STAFF_ROLES, 'Staff access required'),
  studentOnly: requireRoles(['student'], 'Only students can do this'),
});
