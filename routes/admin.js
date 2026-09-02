const express = require('express');
const router = express.Router();
const { db, logAudit, persistRecord, deleteRecord, getNextUserId, saveDiskStore } = require('../db/database');
const { requireRole } = require('../middleware/auth');

// GET /api/admin/live-pulse - Real-time system pulse & live activity ticker
router.get('/live-pulse', (req, res) => {
  const totalUsers = db.users.length;
  const totalDoctors = db.doctor_profiles.length;
  const verifiedDoctors = db.doctor_profiles.filter(d => d.verification_status === 'verified').length;
  const pendingVerification = db.doctor_profiles.filter(d => d.verification_status === 'pending').length;
  const totalAppointments = db.appointments.length;
  const activeRooms = db.appointments.filter(a => a.status === 'confirmed' || a.status === 'in_consultation').length;
  const totalPrescriptions = db.prescriptions.length;

  // Format real-time activity stream from recent audit logs
  const activityStream = db.audit_logs.slice(0, 10).map(log => ({
    id: log.id,
    timestamp: log.timestamp,
    actor_name: log.actor_name,
    actor_role: log.actor_role,
    action: log.action,
    details: log.details
  }));

  res.json({
    status: 'online',
    latency_ms: 14,
    uptime: '99.99%',
    metrics: {
      totalUsers,
      totalDoctors,
      verifiedDoctors,
      pendingVerification,
      totalAppointments,
      activeRooms,
      totalPrescriptions,
      freeBookingValue: 0
    },
    activityStream
  });
});

// GET /api/admin/stats - Overview Platform Metrics
router.get(['/stats', '/analytics'], requireRole('super_admin', 'skit_admin'), (req, res) => {
  const totalUsers = db.users.length;
  const totalDoctors = db.doctor_profiles.length;
  const verifiedDoctors = db.doctor_profiles.filter(d => d.verification_status === 'verified').length;
  const pendingVerification = db.doctor_profiles.filter(d => d.verification_status === 'pending').length;
  const totalPatients = db.patient_profiles.length;
  const totalAppointments = db.appointments.length;
  const confirmedAppointments = db.appointments.filter(a => a.status === 'confirmed').length;
  const completedConsultations = db.consultations.filter(c => c.status === 'completed').length;
  const totalFreeBookingsValue = totalAppointments * 0; // ₹0 Free

  res.json({
    totalUsers,
    totalDoctors,
    verifiedDoctors,
    pendingVerification,
    totalPatients,
    totalAppointments,
    confirmedAppointments,
    completedConsultations,
    totalFreeBookingsValue
  });
});

// GET /api/admin/users - List all users across roles (Super Admin / SKIT Admin)
router.get('/users', requireRole('super_admin', 'skit_admin'), (req, res) => {
  const usersList = db.users.map(u => ({
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    created_at: u.created_at,
    assigned_region: u.assigned_region || null
  }));
  res.json({ users: usersList, count: usersList.length });
});

// GET /api/admin/doctors - List doctors with verification status (Super Admin / SKIT Admin)
router.get('/doctors', requireRole('super_admin', 'skit_admin'), (req, res) => {
  const list = db.doctor_profiles.map(d => {
    const u = db.users.find(user => user.id === d.user_id) || {};
    return {
      ...d,
      doctor_name: u.full_name,
      email: u.email,
      phone: u.phone,
      avatar_url: u.avatar_url,
      created_at: u.created_at
    };
  });
  res.json({ doctors: list });
});

// PATCH /api/admin/verify-doctor/:id - Verify or Reject Doctor
router.patch('/verify-doctor/:id', requireRole('super_admin', 'skit_admin'), (req, res) => {
  const { status } = req.body; // 'verified' or 'rejected'
  const docProf = db.doctor_profiles.find(d => d.id === req.params.id || d.user_id === req.params.id);

  if (!docProf) {
    return res.status(404).json({ error: 'Doctor profile not found' });
  }

  docProf.verification_status = status;
  persistRecord('DoctorProfile', docProf);

  const docUser = db.users.find(u => u.id === docProf.user_id);
  const docName = docUser ? docUser.full_name : 'Doctor';

  if (docUser) {
    if (status === 'verified') {
      docUser.status = 'active';
    } else if (status === 'rejected') {
      docUser.status = 'rejected';
    }
    persistRecord('User', docUser);
  }

  logAudit(
    req.user.id,
    req.user.full_name,
    req.user.role,
    status === 'verified' ? 'VERIFIED_DOCTOR_CREDENTIALS' : 'REJECTED_DOCTOR_CREDENTIALS',
    'doctor_profiles',
    docProf.id,
    `Admin updated doctor verification status to '${status}' for ${docName}`
  );

  res.json({
    success: true,
    message: `Doctor ${docName} verification status updated to ${status}.`,
    doctor: docProf
  });
});

// DELETE /api/admin/doctor/:id - Delete a Doctor account and profile
router.delete('/doctor/:id', requireRole('super_admin', 'skit_admin'), (req, res) => {
  const targetId = req.params.id;
  
  const profIndex = db.doctor_profiles.findIndex(d => d.id === targetId || d.user_id === targetId);
  let userId = targetId;
  let docName = 'Doctor';
  
  if (profIndex !== -1) {
    const [deletedProf] = db.doctor_profiles.splice(profIndex, 1);
    userId = deletedProf.user_id || targetId;
    docName = deletedProf.doctor_name || docName;
    deleteRecord('DoctorProfile', deletedProf.id);
  }

  const userIndex = db.users.findIndex(u => u.id === userId || u.id === targetId);
  if (userIndex !== -1) {
    const [deletedUser] = db.users.splice(userIndex, 1);
    docName = deletedUser.full_name || docName;
    deleteRecord('User', deletedUser.id);
  }

  logAudit(
    req.user?.id || 'admin',
    req.user?.full_name || 'Super Admin',
    req.user?.role || 'super_admin',
    'DELETE_DOCTOR_ACCOUNT',
    'doctor_profiles',
    targetId,
    `Deleted Dermatologist account for ${docName}`
  );

  res.json({
    success: true,
    message: `Dermatologist account for ${docName} has been permanently deleted.`
  });
});

// GET /api/admin/skit-monitoring - Regional SKIT Admin Operational Dashboard Data
router.get('/skit-monitoring', requireRole('skit_admin', 'super_admin'), (req, res) => {
  const doctorsInRegion = db.doctor_profiles.map(d => {
    const u = db.users.find(user => user.id === d.user_id) || {};
    const appointmentsCount = db.appointments.filter(a => a.doctor_id === d.user_id).length;
    return {
      doctor_id: d.user_id,
      doctor_name: u.full_name,
      clinic_name: d.clinic_name,
      verification_status: d.verification_status,
      appointments_count: appointmentsCount
    };
  });

  const operationalLogs = db.audit_logs.map(log => ({
    id: log.id,
    timestamp: log.timestamp,
    actor_name: log.actor_name,
    actor_role: log.actor_role,
    action: log.action,
    details: log.details
  }));

  res.json({
    region: req.user?.assigned_region || 'Western Maharashtra Zone (Mumbai)',
    doctors: doctorsInRegion,
    operationalLogs
  });
});

// GET /api/admin/pending-registrations - List all pending user registrations
router.get('/pending-registrations', requireRole('super_admin'), (req, res) => {
  const pendingUsers = db.users
    .filter(u => u.status === 'pending')
    .map(u => {
      let profile = null;
      if (u.role === 'doctor') {
        profile = db.doctor_profiles.find(d => d.user_id === u.id) || null;
      } else if (u.role === 'client') {
        profile = db.patient_profiles.find(p => p.user_id === u.id) || null;
      }
      return { ...u, profile };
    });

  res.json({ pendingUsers, count: pendingUsers.length });
});

// PATCH /api/admin/approve-user/:userId - Approve or Reject a pending user registration
router.patch('/approve-user/:userId', requireRole('super_admin'), (req, res) => {
  const { action } = req.body; // 'approve' or 'reject'
  const user = db.users.find(u => u.id === req.params.userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (action === 'approve') {
    user.status = 'active';

    // For doctors: also mark their profile as verified
    const docProfile = db.doctor_profiles.find(d => d.user_id === user.id);
    if (docProfile) {
      docProfile.verification_status = 'verified';
      docProfile.avatar_url = user.avatar_url || docProfile.avatar_url;
      persistRecord('DoctorProfile', docProfile);
    }

    persistRecord('User', user);
    logAudit(
      req.user.id, req.user.full_name, req.user.role,
      'APPROVED_USER_REGISTRATION', 'users', user.id,
      `Super Admin approved registration for ${user.full_name} (${user.role})`
    );

    return res.json({
      success: true,
      message: `${user.full_name}'s account has been approved and activated.`,
      user
    });
  }

  if (action === 'reject') {
    user.status = 'rejected';
    persistRecord('User', user);
    logAudit(
      req.user.id, req.user.full_name, req.user.role,
      'REJECTED_USER_REGISTRATION', 'users', user.id,
      `Super Admin rejected registration for ${user.full_name} (${user.role})`
    );

    return res.json({
      success: true,
      message: `${user.full_name}'s registration has been rejected.`,
      user
    });
  }

  return res.status(400).json({ error: 'Invalid action. Use "approve" or "reject".' });
});

// GET /api/admin/skit-admins - List all SKIT regional admins
router.get('/skit-admins', requireRole('super_admin'), (req, res) => {
  const skitAdmins = db.users
    .filter(u => u.role === 'skit_admin')
    .map(u => ({
      ...u,
      assigned_region: u.assigned_region || 'Western Maharashtra Zone (Mumbai)'
    }));
  res.json({ skitAdmins, count: skitAdmins.length });
});

// POST /api/admin/create-skit-admin - Super Admin creates a new SKIT Admin directly
router.post('/create-skit-admin', requireRole('super_admin'), (req, res) => {
  const { full_name, email, password, phone, assigned_region, employee_id } = req.body;

  if (!full_name || !email || !password) {
    return res.status(400).json({ error: 'Full name, email, and password are required.' });
  }

  const cleanEmail = email.trim();
  const existing = db.users.find(u => u.email && u.email.trim().toLowerCase() === cleanEmail.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists.' });
  }

  const userId = getNextUserId('skitadmin');
  const newUser = {
    id: userId,
    email: cleanEmail,
    password: password,
    role: 'skit_admin',
    status: 'active',
    full_name,
    phone: phone || '+91 98100 54321',
    employee_id: employee_id || `SKIT-${Math.floor(10000 + Math.random() * 90000)}`,
    avatar_url: '',
    created_at: new Date().toISOString(),
    assigned_region: assigned_region || 'Western Maharashtra Zone (Mumbai)'
  };

  db.users.push(newUser);
  persistRecord('User', newUser);

  logAudit(req.user?.id || 'admin', req.user?.full_name || 'Super Admin', req.user?.role || 'super_admin', 'CREATE_SKIT_ADMIN', 'users', userId, `Created SKIT Admin account for ${full_name}`);

  res.status(201).json({
    success: true,
    message: `SKIT Admin account for ${full_name} created successfully!`,
    user: newUser
  });
});

// PUT /api/admin/skit-admin/:id - Update SKIT Admin details
router.put('/skit-admin/:id', requireRole('super_admin'), (req, res) => {
  const { full_name, email, phone, assigned_region, employee_id, status } = req.body;
  const adminUser = db.users.find(u => u.id === req.params.id && u.role === 'skit_admin');

  if (!adminUser) {
    return res.status(404).json({ error: 'SKIT Admin not found.' });
  }

  if (email && email.trim().toLowerCase() !== adminUser.email.toLowerCase()) {
    const cleanEmail = email.trim();
    const existing = db.users.find(u => u.id !== adminUser.id && u.email && u.email.trim().toLowerCase() === cleanEmail.toLowerCase());
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }
    adminUser.email = cleanEmail;
  }

  if (full_name) adminUser.full_name = full_name;
  if (phone) adminUser.phone = phone;
  if (assigned_region) adminUser.assigned_region = assigned_region;
  if (employee_id) adminUser.employee_id = employee_id;
  if (status) adminUser.status = status;

  persistRecord('User', adminUser);

  logAudit(
    req.user?.id || 'admin',
    req.user?.full_name || 'Super Admin',
    req.user?.role || 'super_admin',
    'UPDATE_SKIT_ADMIN',
    'users',
    adminUser.id,
    `Updated SKIT Admin details for ${adminUser.full_name}`
  );

  res.json({
    success: true,
    message: `SKIT Admin ${adminUser.full_name} updated successfully.`,
    user: adminUser
  });
});

// DELETE /api/admin/skit-admin/:id - Delete SKIT Admin account
router.delete('/skit-admin/:id', requireRole('super_admin'), (req, res) => {
  const index = db.users.findIndex(u => u.id === req.params.id && u.role === 'skit_admin');

  if (index === -1) {
    return res.status(404).json({ error: 'SKIT Admin not found.' });
  }

  const [deletedUser] = db.users.splice(index, 1);
  deleteRecord('User', deletedUser.id);

  logAudit(
    req.user?.id || 'admin',
    req.user?.full_name || 'Super Admin',
    req.user?.role || 'super_admin',
    'DELETE_SKIT_ADMIN',
    'users',
    deletedUser.id,
    `Deleted SKIT Admin account ${deletedUser.full_name} (${deletedUser.email})`
  );

  res.json({
    success: true,
    message: `SKIT Admin ${deletedUser.full_name} has been deleted.`
  });
});

// GET /api/admin/patients - List all patients with patient profile details
router.get('/patients', requireRole('super_admin', 'skit_admin'), (req, res) => {
  const patients = db.users
    .filter(u => u.role === 'client')
    .map(u => {
      const profile = db.patient_profiles.find(p => p.user_id === u.id) || {};
      return {
        ...u,
        profile,
        patient_name: u.full_name,
        blood_group: profile.blood_group || 'N/A',
        allergies: profile.allergies || 'None reported',
        medical_history: profile.medical_history || 'None reported',
        emergency_contact: profile.emergency_contact || 'N/A'
      };
    });
  res.json({ patients, count: patients.length });
});

// GET /api/admin/appointments - List all system appointments with full details
router.get('/appointments', requireRole('super_admin', 'skit_admin'), (req, res) => {
  const appointmentsList = db.appointments.map(apt => {
    const patientUser = db.users.find(u => u.id === apt.patient_id) || {};
    const doctorUser = db.users.find(u => u.id === apt.doctor_id) || {};
    const doctorProf = db.doctor_profiles.find(d => d.user_id === apt.doctor_id) || {};
    const slot = db.slots.find(s => s.id === apt.slot_id) || {};
    const realFee = apt.booking_fee ?? apt.consultation_fee ?? slot.consultation_fee ?? doctorProf.consultation_fee ?? 500;

    return {
      ...apt,
      patient_name: patientUser.full_name || apt.patient_id,
      patient_email: patientUser.email || '',
      doctor_name: doctorUser.full_name || apt.doctor_id,
      doctor_email: doctorUser.email || '',
      clinic_name: doctorProf.clinic_name || doctorProf.clinics?.[0]?.clinic_name || apt.clinic_name || '',
      slot_time: slot.start_time ? `${slot.date}, ${slot.start_time}` : (apt.appointment_date || 'Today'),
      booking_fee: realFee,
      consultation_fee: realFee
    };
  });
  res.json({ appointments: appointmentsList, count: appointmentsList.length });
});

// POST /api/admin/reset-database - Reset database (Keep Super Admin only)
router.post('/reset-database', requireRole('super_admin'), async (req, res) => {
  try {
    const seed = require('../data/seedData');
    const mongoose = require('mongoose');

    // Keep Super Admin users
    db.users = db.users.filter(u => u.role === 'super_admin' || u.id === 'user-superadmin-1');
    if (db.users.length === 0) {
      db.users = [...seed.initialUsers];
    }

    db.doctor_profiles = [];
    db.patient_profiles = [];
    db.slots = [];
    db.appointments = [];
    db.condition_submissions = [];
    db.consultations = [];
    db.prescriptions = [];
    db.notifications = [];
    db.audit_logs = db.audit_logs.filter(a => a.actor_role === 'super_admin' || a.actor_id === 'user-superadmin-1');

    saveDiskStore();

    if (mongoose.connection && mongoose.connection.readyState === 1) {
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
    }

    logAudit(
      req.user?.id || 'admin',
      req.user?.full_name || 'Super Admin',
      'super_admin',
      'RESET_DATABASE',
      'system',
      'all',
      'Super Admin reset system data (cleared non-super-admin users, profiles, slots, prescriptions, appointments)'
    );

    res.json({
      success: true,
      message: 'Database reset successfully. All registered users (except Super Admin), slots, prescriptions, and appointments have been removed.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to reset database' });
  }
});

module.exports = router;

