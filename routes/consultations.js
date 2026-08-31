const express = require('express');
const router = express.Router();
const { db, logAudit, persistRecord } = require('../db/database');

// GET /api/consultations/:appointment_id
router.get('/:appointment_id', (req, res) => {
  const { appointment_id } = req.params;
  const user = req.user;

  if (user.role === 'skit_admin') {
    return res.status(403).json({
      error: 'Privacy Restriction',
      message: 'SKIT Admins are restricted from viewing confidential clinical notes.'
    });
  }

  let consult = db.consultations.find(c => c.appointment_id === appointment_id);

  if (!consult) {
    // Return initial structure if consultation room is newly opened
    const apt = db.appointments.find(a => a.id === appointment_id);
    if (!apt) return res.status(404).json({ error: 'Appointment not found' });

    consult = {
      id: `consult-${Date.now()}`,
      appointment_id,
      doctor_id: apt.doctor_id,
      patient_id: apt.patient_id,
      video_room_id: `room-${appointment_id}`,
      clinical_summary: '',
      diagnosis: '',
      follow_up_recommended: false,
      follow_up_date: '',
      status: 'scheduled',
      created_at: new Date().toISOString()
    };
  }

  res.json({ consultation: consult });
});

// POST /api/consultations/save - Save or update clinical notes & diagnosis
router.post('/save', (req, res) => {
  const {
    appointment_id,
    clinical_summary,
    diagnosis,
    follow_up_recommended,
    follow_up_date,
    status
  } = req.body;

  let consult = db.consultations.find(c => c.appointment_id === appointment_id);

  if (!consult) {
    const apt = db.appointments.find(a => a.id === appointment_id);
    consult = {
      id: `consult-${Date.now()}`,
      appointment_id,
      doctor_id: apt ? apt.doctor_id : req.user.id,
      patient_id: apt ? apt.patient_id : 'user-patient-1',
      video_room_id: `room-${appointment_id}`,
      clinical_summary: clinical_summary || '',
      diagnosis: diagnosis || '',
      follow_up_recommended: !!follow_up_recommended,
      follow_up_date: follow_up_date || '',
      status: status || 'completed',
      created_at: new Date().toISOString()
    };
    db.consultations.push(consult);
  } else {
    consult.clinical_summary = clinical_summary || consult.clinical_summary;
    consult.diagnosis = diagnosis || consult.diagnosis;
    consult.follow_up_recommended = follow_up_recommended !== undefined ? follow_up_recommended : consult.follow_up_recommended;
    consult.follow_up_date = follow_up_date || consult.follow_up_date;
    if (status) consult.status = status;
  }

  persistRecord('Consultation', consult);

  // Update appointment status to completed if room closed
  const apt = db.appointments.find(a => a.id === appointment_id);
  if (apt && status === 'completed') {
    apt.status = 'completed';
    persistRecord('Appointment', apt);
  }

  logAudit(
    req.user.id,
    req.user.full_name,
    req.user.role,
    'SAVED_CLINICAL_CONSULTATION',
    'consultations',
    consult.id,
    `Doctor recorded diagnosis: '${diagnosis || 'N/A'}' for appointment ${appointment_id}`
  );

  res.json({ success: true, consultation: consult });
});

module.exports = router;
