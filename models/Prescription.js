const mongoose = require('mongoose');

const medicationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  dosage: { type: String, default: '' },
  frequency: { type: String, default: '' },
  duration_days: { type: Number, default: 7 },
  instructions: { type: String, default: '' }
}, { _id: false });

const prescriptionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  consultation_id: { type: String, default: '' },
  appointment_id: { type: String, required: true, ref: 'Appointment' },
  patient_id: { type: String, required: true, ref: 'User' },
  doctor_id: { type: String, required: true, ref: 'User' },
  medications: [medicationSchema],
  general_care_instructions: { type: String, default: '' },
  issued_at: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Prescription', prescriptionSchema);
