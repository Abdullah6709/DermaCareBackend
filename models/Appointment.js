const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  patient_id: { type: String, required: true, ref: 'User' },
  doctor_id: { type: String, required: true, ref: 'User' },
  slot_id: { type: String, required: true, ref: 'Slot' },
  appointment_type: { type: String, enum: ['online', 'clinic'], default: 'online' },
  appointment_date: { type: String, required: true },
  start_time: { type: String, required: true },
  end_time: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['confirmed', 'in_consultation', 'completed', 'cancelled'], 
    default: 'confirmed' 
  },
  booking_fee: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Appointment', appointmentSchema);
