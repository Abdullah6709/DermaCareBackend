// Auth & RBAC Middleware
const { db } = require('../db/database');

function authenticateUser(req, res, next) {
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'] || 'client';

  let user = db.users.find(u => u.id === userId);

  // Reject authentication if account status is pending or rejected
  if (user && (user.status === 'pending' || user.status === 'rejected')) {
    user = null;
  }

  // Default fallback user matching requested role if no active user ID passed
  if (!user) {
    user = db.users.find(u => u.role === userRole && u.status === 'active') || db.users.find(u => u.status === 'active');
  }

  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Role '${req.user ? req.user.role : 'unauthenticated'}' is not authorized to access this resource.`
      });
    }
    next();
  };
}

module.exports = {
  authenticateUser,
  requireRole
};
