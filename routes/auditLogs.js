const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { requireRole } = require('../middleware/auth');

// GET /api/audit-logs - Security & Clinical Access Audit Logs (Super Admin / SKIT Admin)
router.get('/', requireRole('super_admin', 'skit_admin'), (req, res) => {
  const { action, actor_role, search } = req.query;

  let logs = [...db.audit_logs];

  if (actor_role && actor_role !== 'all') {
    logs = logs.filter(l => l.actor_role === actor_role);
  }

  if (action && action !== 'all') {
    logs = logs.filter(l => l.action === action);
  }

  if (search) {
    const term = search.toLowerCase();
    logs = logs.filter(l =>
      l.actor_name.toLowerCase().includes(term) ||
      l.action.toLowerCase().includes(term) ||
      l.details.toLowerCase().includes(term) ||
      l.target_entity.toLowerCase().includes(term)
    );
  }

  res.json({
    total: logs.length,
    logs
  });
});

module.exports = router;
