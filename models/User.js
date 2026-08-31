const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  role: { 
    type: String, 
    enum: ['super_admin', 'skit_admin', 'doctor', 'client'], 
    required: true 
  },
  full_name: { type: String, required: true },
  password: { type: String, default: 'demo123' },
  status: { type: String, default: 'active' },
  phone: { type: String, default: '' },
  avatar_url: { type: String, default: '' },
  created_at: { type: Date, default: Date.now },
  assigned_region: { type: String, default: '' }
}, { timestamps: true, strict: false });

module.exports = mongoose.model('User', userSchema);
