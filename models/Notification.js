const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, ref: 'User' },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, default: 'general' },
  channel: { type: String, default: 'in_app' },
  is_read: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
