const mongoose = require('mongoose');

const patientProfileSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, ref: 'User' },
  dob: { type: String, default: '1995-01-01' },
  gender: { type: String, default: 'Other' },
  blood_group: { type: String, default: 'O+' },
  emergency_contact: { type: String, default: '' },
  allergies: { type: String, default: 'None reported' },
  medical_history: { type: String, default: 'No prior dermatological conditions' }
}, { timestamps: true });

module.exports = mongoose.model('PatientProfile', patientProfileSchema);
