const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  actor_id: { type: String, required: true },
  actor_name: { type: String, default: 'System User' },
  actor_role: { type: String, default: 'system' },
  action: { type: String, required: true },
  target_entity: { type: String, default: '' },
  target_id: { type: String, default: '' },
  details: { type: String, default: '' },
  ip_address: { type: String, default: '127.0.0.1' },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('AuditLog', auditLogSchema);
