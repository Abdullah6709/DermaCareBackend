const express = require('express');
const router = express.Router();
const { db, logAudit, persistRecord } = require('../db/database');

// GET /api/condition-submissions/:appointment_id
router.get('/:appointment_id', (req, res) => {
  const { appointment_id } = req.params;
  const user = req.user;

  // SKIT Admin privacy guard: Exclude raw condition submissions unless authorized
  if (user.role === 'skit_admin') {
    return res.status(403).json({
      error: 'Privacy Restriction',
      message: 'SKIT Admins are excluded from viewing confidential patient clinical condition media by default.'
    });
  }

  const submission = db.condition_submissions.find(c => c.appointment_id === appointment_id);
  if (!submission) {
    return res.status(404).json({ error: 'No condition submission found for this appointment' });
  }

  // Audit log for doctor viewing patient health media
  if (user.role === 'doctor') {
    logAudit(
      user.id,
      user.full_name,
      user.role,
      'ACCESSED_PATIENT_MEDIA',
      'condition_submissions',
      submission.id,
      `Dermatologist accessed patient condition photos & symptom description for appointment ${appointment_id}`
    );
  }

  res.json({ submission });
});

// POST /api/condition-submissions - Submit condition details & photos
router.post('/', (req, res) => {
  const {
    appointment_id,
    symptoms_description,
    onset_date,
    severity_level,
    photo_urls,
    pre_consult_video_url,
    privacy_consent
  } = req.body;

  if (!appointment_id || !symptoms_description) {
    return res.status(400).json({ error: 'Appointment ID and symptoms description are required' });
  }

  const newSubmission = {
    id: `cond-${Date.now()}`,
    appointment_id,
    patient_id: req.user.id,
    symptoms_description,
    onset_date: onset_date || new Date().toISOString().split('T')[0],
    severity_level: severity_level || 'moderate',
    photo_urls: Array.isArray(photo_urls) ? photo_urls : [],
    pre_consult_video_url: pre_consult_video_url || null,
    privacy_consent: privacy_consent !== false,
    created_at: new Date().toISOString()
  };

  db.condition_submissions.push(newSubmission);
  persistRecord('ConditionSubmission', newSubmission);

  logAudit(
    req.user.id,
    req.user.full_name,
    req.user.role,
    'SUBMITTED_CONDITION_MEDIA',
    'condition_submissions',
    newSubmission.id,
    `Submitted skin condition media and description for appointment ${appointment_id}`
  );

  res.status(201).json({
    success: true,
    message: 'Condition details and media uploaded securely.',
    submission: newSubmission
  });
});

module.exports = router;
