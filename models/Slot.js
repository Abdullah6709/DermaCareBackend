const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  doctor_id: { type: String, required: true, ref: 'User' },
  date: { type: String, required: true },
  start_time: { type: String, required: true },
  end_time: { type: String, required: true },
  slot_type: { type: String, enum: ['online', 'clinic'], default: 'online' },
  status: { type: String, enum: ['available', 'booked', 'cancelled'], default: 'available' }
}, { timestamps: true });

module.exports = mongoose.model('Slot', slotSchema);
