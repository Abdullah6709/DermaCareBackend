const mongoose = require('mongoose');

const consultationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  appointment_id: { type: String, required: true, ref: 'Appointment' },
  doctor_id: { type: String, required: true, ref: 'User' },
  patient_id: { type: String, required: true, ref: 'User' },
  video_room_id: { type: String, required: true },
  clinical_summary: { type: String, default: '' },
  diagnosis: { type: String, default: '' },
  follow_up_recommended: { type: Boolean, default: false },
  follow_up_date: { type: String, default: null },
  status: { 
    type: String, 
    enum: ['in_progress', 'completed', 'cancelled'], 
    default: 'in_progress' 
  },
  created_at: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Consultation', consultationSchema);
