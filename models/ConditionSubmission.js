const mongoose = require('mongoose');

const conditionSubmissionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  appointment_id: { type: String, required: true, ref: 'Appointment' },
  patient_id: { type: String, required: true, ref: 'User' },
  symptoms_description: { type: String, required: true },
  onset_date: { type: String, default: '' },
  severity_level: { 
    type: String, 
    enum: ['mild', 'moderate', 'severe'], 
    default: 'moderate' 
  },
  photo_urls: [{ type: String }],
  pre_consult_video_url: { type: String, default: null },
  privacy_consent: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('ConditionSubmission', conditionSubmissionSchema);
