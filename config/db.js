const mongoose = require('mongoose');
const seed = require('../data/seedData');

// Models
const User = require('../models/User');
const DoctorProfile = require('../models/DoctorProfile');
const PatientProfile = require('../models/PatientProfile');
const Slot = require('../models/Slot');
const Appointment = require('../models/Appointment');
const ConditionSubmission = require('../models/ConditionSubmission');
const Consultation = require('../models/Consultation');
const Prescription = require('../models/Prescription');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');

let isConnected = false;

const connectDB = async () => {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dermatology_crm';
  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000
    });
    isConnected = true;
    console.log(`[MongoDB Atlas] Connected successfully to Database.`);

    // Auto-seed data if database is empty, otherwise sync MongoDB records to memory
    await seedDatabaseIfEmpty();
    await syncMongoDBToMemory();
  } catch (err) {
    console.warn(`[MongoDB Atlas Warning] Database connection failed/timed out (${err.message}). Defaulting to high-performance in-memory database engine.`);
    isConnected = false;
  }
};

const syncMongoDBToMemory = async () => {
  try {
    const { db } = require('../db/database');
    const mongoUsers = await User.find({}).lean();
    if (mongoUsers && mongoUsers.length > 0) {
      mongoUsers.forEach(mu => {
        const cleanEmail = mu.email ? mu.email.trim().replace(/^["']|["']$/g, '').toLowerCase() : '';
        const idx = db.users.findIndex(u => (u.id && u.id === mu.id) || (u.email && u.email.trim().replace(/^["']|["']$/g, '').toLowerCase() === cleanEmail));
        if (idx >= 0) {
          db.users[idx] = { ...db.users[idx], ...mu };
        } else {
          db.users.push(mu);
        }
      });
    }

    const mongoDocProfs = await DoctorProfile.find({}).lean();
    if (mongoDocProfs && mongoDocProfs.length > 0) {
      mongoDocProfs.forEach(dp => {
        const idx = db.doctor_profiles.findIndex(p => p.id === dp.id || p.user_id === dp.user_id);
        if (idx >= 0) db.doctor_profiles[idx] = { ...db.doctor_profiles[idx], ...dp };
        else db.doctor_profiles.push(dp);
      });
    }

    const mongoPatProfs = await PatientProfile.find({}).lean();
    if (mongoPatProfs && mongoPatProfs.length > 0) {
      mongoPatProfs.forEach(pp => {
        const idx = db.patient_profiles.findIndex(p => p.id === pp.id || p.user_id === pp.user_id);
        if (idx >= 0) db.patient_profiles[idx] = { ...db.patient_profiles[idx], ...pp };
        else db.patient_profiles.push(pp);
      });
    }

    console.log(`[MongoDB Sync] Synchronized ${mongoUsers.length} users and profiles into memory engine.`);
  } catch (err) {
    console.warn('[MongoDB Sync Warning] Could not sync MongoDB to memory:', err.message);
  }
};

const seedDatabaseIfEmpty = async () => {
  try {
    const existingCount = await User.countDocuments();
    if (existingCount > 0) {
      console.log(`[MongoDB Atlas] Existing database contains ${existingCount} user(s). Preserving records.`);
      return;
    }

    if (seed.initialUsers && seed.initialUsers.length) {
      await User.insertMany(seed.initialUsers);
    }
    if (seed.initialDoctorProfiles && seed.initialDoctorProfiles.length) {
      await DoctorProfile.insertMany(seed.initialDoctorProfiles);
    }
    if (seed.initialPatientProfiles && seed.initialPatientProfiles.length) {
      await PatientProfile.insertMany(seed.initialPatientProfiles);
    }
    console.log('[MongoDB Atlas] Database initialization completed successfully!');
  } catch (err) {
    console.error('[MongoDB Atlas] Database initialization error:', err.message);
  }
};

module.exports = {
  connectDB,
  getIsConnected: () => isConnected,
  models: {
    User,
    DoctorProfile,
    PatientProfile,
    Slot,
    Appointment,
    ConditionSubmission,
    Consultation,
    Prescription,
    Notification,
    AuditLog
  }
};
