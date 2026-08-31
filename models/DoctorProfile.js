const mongoose = require('mongoose');

const doctorProfileSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, ref: 'User' },
  specialization: { type: String, required: true },
  qualifications: { type: String, default: '' },
  experience_years: { type: Number, default: 0 },
  clinic_name: { type: String, required: true },
  clinic_address: { type: String, default: '' },
  latitude: { type: Number, default: 37.7749 },
  longitude: { type: Number, default: -122.4194 },
  bio: { type: String, default: '' },
  verification_status: { 
    type: String, 
    enum: ['verified', 'pending', 'rejected'], 
    default: 'pending' 
  },
  consultation_modes: { 
    type: String, 
    enum: ['both', 'online', 'clinic'], 
    default: 'both' 
  },
  rating: { type: Number, default: 5.0 },
  reviews_count: { type: Number, default: 0 },
  consultation_fee: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('DoctorProfile', doctorProfileSchema);
