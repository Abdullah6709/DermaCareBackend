const express = require('express');
const router = express.Router();
const { db, logAudit, persistRecord } = require('../db/database');

// GET /api/prescriptions - List prescriptions for patient or doctor
router.get('/', (req, res) => {
  const user = req.user;
  let list = [...db.prescriptions];

  if (user.role === 'client') {
    list = list.filter(p => p.patient_id === user.id);
  } else if (user.role === 'doctor') {
    list = list.filter(p => p.doctor_id === user.id);
  }

  const enriched = list.map(rx => {
    const doctorObj = db.users.find(u => u.id === rx.doctor_id) || {};
    const doctorProf = db.doctor_profiles.find(d => d.user_id === rx.doctor_id) || {};
    const patientObj = db.users.find(u => u.id === rx.patient_id) || {};

    return {
      ...rx,
      doctor_name: doctorObj.full_name,
      doctor_avatar: doctorObj.avatar_url,
      doctor_specialization: doctorProf.specialization,
      clinic_name: doctorProf.clinic_name,
      clinic_address: doctorProf.clinic_address,
      patient_name: patientObj.full_name
    };
  });

  res.json({ prescriptions: enriched });
});

// GET /api/prescriptions/:id
router.get('/:id', (req, res) => {
  const rx = db.prescriptions.find(p => p.id === req.params.id || p.appointment_id === req.params.id);
  if (!rx) return res.status(404).json({ error: 'Prescription not found' });

  const doctorObj = db.users.find(u => u.id === rx.doctor_id) || {};
  const doctorProf = db.doctor_profiles.find(d => d.user_id === rx.doctor_id) || {};
  const patientObj = db.users.find(u => u.id === rx.patient_id) || {};
  const patientProf = db.patient_profiles.find(p => p.user_id === rx.patient_id) || {};

  res.json({
    prescription: {
      ...rx,
      doctor_name: doctorObj.full_name,
      doctor_avatar: doctorObj.avatar_url,
      doctor_specialization: doctorProf.specialization,
      clinic_name: doctorProf.clinic_name,
      clinic_address: doctorProf.clinic_address,
      patient_name: patientObj.full_name,
      patient_allergies: patientProf.allergies
    }
  });
});

// POST /api/prescriptions - Create e-prescription
router.post('/', (req, res) => {
  const {
    consultation_id,
    appointment_id,
    patient_id,
    medications,
    general_care_instructions
  } = req.body;

  if (!appointment_id || !patient_id || !medications) {
    return res.status(400).json({ error: 'Missing appointment, patient, or medication details' });
  }

  const newRx = {
    id: `rx-${Date.now()}`,
    consultation_id: consultation_id || `consult-${Date.now()}`,
    appointment_id,
    patient_id,
    doctor_id: req.user.id,
    medications: Array.isArray(medications) ? medications : [],
    general_care_instructions: general_care_instructions || 'Follow prescribed routine. Avoid harsh skin friction.',
    issued_at: new Date().toISOString()
  };

  db.prescriptions.push(newRx);
  persistRecord('Prescription', newRx);

  // Send Notification to Patient
  const doctorName = req.user.full_name || 'Your Dermatologist';
  const newNotif = {
    id: `notif-${Date.now()}`,
    user_id: patient_id,
    title: 'Digital E-Prescription Issued',
    message: `${doctorName} has issued your e-prescription and custom skincare care plan.`,
    type: 'prescription',
    channel: 'in_app',
    is_read: false,
    created_at: new Date().toISOString()
  };

  db.notifications.unshift(newNotif);
  persistRecord('Notification', newNotif);

  logAudit(
    req.user.id,
    req.user.full_name,
    req.user.role,
    'ISSUED_PRESCRIPTION',
    'prescriptions',
    newRx.id,
    `Finalized e-prescription with ${medications.length} medication items for patient`
  );

  try {
    const { broadcastEvent } = require('../config/socket');
    broadcastEvent('prescription_issued', { prescription: newRx, notification: newNotif }, `room-${appointment_id}`);
    broadcastEvent('prescription_issued', { prescription: newRx, notification: newNotif });
  } catch (e) {}

  res.status(201).json({
    success: true,
    message: 'Prescription & care instructions delivered to patient dashboard.',
    prescription: newRx
  });
});

// PUT /api/prescriptions/:id - Edit / update e-prescription
router.put('/:id', (req, res) => {
  const { medications, general_care_instructions } = req.body;
  const rx = db.prescriptions.find(p => p.id === req.params.id);

  if (!rx) return res.status(404).json({ error: 'Prescription not found' });

  if (medications) rx.medications = Array.isArray(medications) ? medications : [];
  if (general_care_instructions) rx.general_care_instructions = general_care_instructions;
  rx.updated_at = new Date().toISOString();

  persistRecord('Prescription', rx);

  logAudit(
    req.user.id,
    req.user.full_name,
    req.user.role,
    'UPDATED_PRESCRIPTION',
    'prescriptions',
    rx.id,
    `Updated e-prescription for patient`
  );

  res.json({
    success: true,
    message: 'Prescription updated successfully.',
    prescription: rx
  });
});

module.exports = router;
