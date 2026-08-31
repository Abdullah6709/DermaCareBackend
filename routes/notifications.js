const express = require('express');
const router = express.Router();
const { db, saveDiskStore } = require('../db/database');

// GET /api/notifications - List notifications for user
router.get('/', (req, res) => {
  const userId = req.user.id;
  const list = db.notifications.filter(n => n.user_id === userId);
  const unreadCount = list.filter(n => !n.is_read).length;

  res.json({
    unreadCount,
    notifications: list
  });
});

// PATCH /api/notifications/read-all - Mark all as read
router.patch('/read-all', (req, res) => {
  const userId = req.user.id;
  db.notifications.forEach(n => {
    if (n.user_id === userId) {
      n.is_read = true;
    }
  });
  saveDiskStore();
  res.json({ success: true });
});

module.exports = router;
