const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const seed = require('../data/seedData');

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

async function clean() {
  const storeFilePath = path.join(__dirname, '../data/persistedStore.json');

  // Read existing persistedStore to keep super admin user details if present
  let existingStore = {};
  if (fs.existsSync(storeFilePath)) {
    try {
      existingStore = JSON.parse(fs.readFileSync(storeFilePath, 'utf8'));
    } catch (e) {
      console.warn('Could not parse persistedStore.json:', e.message);
    }
  }

  const existingUsers = Array.isArray(existingStore.users) ? existingStore.users : [];
  const keepUsers = existingUsers.filter(u => u.role === 'super_admin' || u.id === 'user-superadmin-1');

  const cleanStore = {
    users: keepUsers.length > 0 ? keepUsers : [...seed.initialUsers],
    doctor_profiles: [],
    patient_profiles: [],
    slots: [],
    appointments: [],
    condition_submissions: [],
    consultations: [],
    prescriptions: [],
    notifications: [],
    audit_logs: Array.isArray(existingStore.audit_logs)
      ? existingStore.audit_logs.filter(a => a.actor_role === 'super_admin' || a.actor_id === 'user-superadmin-1')
      : []
  };

  fs.writeFileSync(storeFilePath, JSON.stringify(cleanStore, null, 2), 'utf8');
  console.log('✅ Local JSON store (persistedStore.json) cleaned successfully! Kept Super Admin user.');

  // Clean MongoDB Atlas if connected
  const mongoURI = process.env.MONGODB_URI;
  if (mongoURI) {
    try {
      console.log('Connecting to MongoDB Atlas to clean database collections...');
      await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000 });
      
      await User.deleteMany({ role: { $ne: 'super_admin' }, id: { $ne: 'user-superadmin-1' } });
      await DoctorProfile.deleteMany({});
      await PatientProfile.deleteMany({});
      await Slot.deleteMany({});
      await Appointment.deleteMany({});
      await ConditionSubmission.deleteMany({});
      await Consultation.deleteMany({});
      await Prescription.deleteMany({});
      await Notification.deleteMany({});
      await AuditLog.deleteMany({ actor_role: { $ne: 'super_admin' } });

      console.log('✅ MongoDB Atlas collections cleaned successfully!');
      await mongoose.disconnect();
    } catch (err) {
      console.warn('⚠️ MongoDB Atlas cleanup skipped/warned:', err.message);
    }
  }
}

clean().then(() => {
  console.log('🎉 Cleanup process finished.');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error during database cleanup:', err);
  process.exit(1);
});
