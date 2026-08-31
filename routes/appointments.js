const express = require('express');
const router = express.Router();
const { db, logAudit, persistRecord, deleteRecord } = require('../db/database');

// GET /api/appointments - List appointments based on role
router.get('/', (req, res) => {
  const user = req.user;
  let appointments = [...db.appointments];

  if (user.role === 'client') {
    appointments = appointments.filter(a => a.patient_id === user.id);
  } else if (user.role === 'doctor') {
    appointments = appointments.filter(a => a.doctor_id === user.id);
  } else if (user.role === 'skit_admin') {
    // SKIT Admin operational monitoring
  }

  // Enrich appointment records
  const enriched = appointments.map(apt => {
    const doctorObj = db.users.find(u => u.id === apt.doctor_id) || {};
    const doctorProf = db.doctor_profiles.find(d => d.user_id === apt.doctor_id) || {};
    const patientObj = db.users.find(u => u.id === apt.patient_id) || {};
    const patientProf = db.patient_profiles.find(p => p.user_id === apt.patient_id) || {};
    const condition = db.condition_submissions.find(c => c.appointment_id === apt.id);
    const consultation = db.consultations.find(c => c.appointment_id === apt.id);
    const prescription = db.prescriptions.find(p => p.appointment_id === apt.id);

    return {
      ...apt,
      doctor_name: doctorObj.full_name,
      doctor_avatar: doctorObj.avatar_url,
      doctor_specialization: doctorProf.specialization,
      clinic_name: doctorProf.clinic_name,
      clinic_address: doctorProf.clinic_address,
      patient_name: patientObj.full_name,
      patient_avatar: patientObj.avatar_url,
      patient_email: patientObj.email,
      patient_phone: patientObj.phone,
      patient_age: patientProf.dob ? new Date().getFullYear() - new Date(patientProf.dob).getFullYear() : 'N/A',
      patient_allergies: patientProf.allergies,
      condition_submitted: !!condition,
      condition,
      consultation: user.role === 'skit_admin' ? null : consultation,
      prescription
    };
  });

  res.json({ appointments: enriched });
});

// GET /api/appointments/:id - Specific appointment details
router.get('/:id', (req, res) => {
  const apt = db.appointments.find(a => a.id === req.params.id);
  if (!apt) return res.status(404).json({ error: 'Appointment not found' });

  const doctorObj = db.users.find(u => u.id === apt.doctor_id) || {};
  const doctorProf = db.doctor_profiles.find(d => d.user_id === apt.doctor_id) || {};
  const patientObj = db.users.find(u => u.id === apt.patient_id) || {};
  const patientProf = db.patient_profiles.find(p => p.user_id === apt.patient_id) || {};
  const condition = db.condition_submissions.find(c => c.appointment_id === apt.id);
  const consultation = db.consultations.find(c => c.appointment_id === apt.id);
  const prescription = db.prescriptions.find(p => p.appointment_id === apt.id);

  res.json({
    appointment: {
      ...apt,
      doctor_name: doctorObj.full_name,
      doctor_avatar: doctorObj.avatar_url,
      doctor_specialization: doctorProf.specialization,
      clinic_name: doctorProf.clinic_name,
      clinic_address: doctorProf.clinic_address,
      patient_name: patientObj.full_name,
      patient_avatar: patientObj.avatar_url,
      patient_allergies: patientProf.allergies,
      patient_medical_history: patientProf.medical_history,
      condition,
      consultation: req.user.role === 'skit_admin' ? null : consultation,
      prescription
    }
  });
});

// POST /api/appointments or /api/appointments/book - Book Appointment (Consultation fee paid at booking)
router.post(['/', '/book'], (req, res) => {
  const { doctor_id, slot_id, appointment_type, appointment_date, start_time, end_time, booking_fee, payment_method, payment_id } = req.body;
  const patientId = req.user.id;

  if (!doctor_id || !appointment_date) {
    return res.status(400).json({ error: 'Missing doctor or appointment date' });
  }

  // Determine consultation fee from request, slot, or doctor profile
  const doctorProf = db.doctor_profiles.find(d => d.user_id === doctor_id || d.id === doctor_id) || {};
  let slotObj = null;
  if (slot_id) {
    slotObj = db.slots.find(s => s.id === slot_id);
    if (slotObj) {
      slotObj.status = 'booked';
      persistRecord('Slot', slotObj);
    }
  }

  const determinedFee = booking_fee !== undefined && booking_fee !== null ? Number(booking_fee) : (slotObj?.consultation_fee ?? doctorProf?.consultation_fee ?? 0);
  const payId = payment_id || `pay_${Date.now()}`;
  const payMethod = payment_method || 'UPI';

  const newAppointment = {
    id: `apt-${Date.now()}`,
    patient_id: patientId,
    doctor_id,
    slot_id: slot_id || `slot-custom-${Date.now()}`,
    appointment_type: appointment_type || 'online',
    appointment_date,
    start_time: start_time || '10:00 AM',
    end_time: end_time || '10:30 AM',
    status: 'confirmed',
    booking_fee: determinedFee,
    payment_status: 'paid',
    payment_id: payId,
    payment_method: payMethod,
    created_at: new Date().toISOString()
  };

  db.appointments.push(newAppointment);
  persistRecord('Appointment', newAppointment);

  // Send Notification to Patient
  const doctorUser = db.users.find(u => u.id === doctor_id);
  const doctorName = doctorUser ? doctorUser.full_name : 'your doctor';

  const newNotif = {
    id: `notif-${Date.now()}`,
    user_id: patientId,
    title: 'Appointment Confirmed & Paid!',
    message: `Your ${newAppointment.appointment_type} appointment with ${doctorName} is confirmed for ${appointment_date} at ${newAppointment.start_time}. Consultation fee of ₹${determinedFee} received.`,
    type: 'booking',
    channel: 'in_app',
    is_read: false,
    created_at: new Date().toISOString()
  };

  db.notifications.unshift(newNotif);
  persistRecord('Notification', newNotif);

  // Send Notification to Doctor
  const patientUser = db.users.find(u => u.id === patientId);
  const patientName = patientUser ? patientUser.full_name : 'A patient';
  const docNotif = {
    id: `notif-doc-${Date.now()}`,
    user_id: doctor_id,
    title: 'New Appointment Booked!',
    message: `${patientName} has booked a ${newAppointment.appointment_type} appointment with you for ${appointment_date} at ${newAppointment.start_time}.`,
    type: 'booking',
    channel: 'in_app',
    is_read: false,
    created_at: new Date().toISOString()
  };
  db.notifications.unshift(docNotif);
  persistRecord('Notification', docNotif);

  // Audit Log
  logAudit(
    req.user.id,
    req.user.full_name,
    req.user.role,
    'BOOKED_PAID_APPOINTMENT',
    'appointments',
    newAppointment.id,
    `Confirmed ${appointment_type} appointment with ${doctorName} (Paid ₹${determinedFee})`
  );

  try {
    const { broadcastEvent } = require('../config/socket');
    broadcastEvent('appointment_booked', { appointment: newAppointment, notification: newNotif });
  } catch (e) {}

  res.status(201).json({
    success: true,
    message: 'Appointment successfully confirmed!',
    appointment: newAppointment
  });
});

// PATCH /api/appointments/:id/status - Update appointment status
router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  const apt = db.appointments.find(a => a.id === req.params.id);

  if (!apt) return res.status(404).json({ error: 'Appointment not found' });

  apt.status = status;
  persistRecord('Appointment', apt);

  if (status === 'confirmed') {
    const doctorUser = db.users.find(u => u.id === apt.doctor_id);
    const doctorName = doctorUser ? doctorUser.full_name : 'your doctor';
    const notifMsg = `Your ${apt.appointment_type || 'consultation'} appointment with ${doctorName} is confirmed for ${apt.appointment_date || 'today'} at ${apt.start_time || '10:00 AM'}.`;
    
    const confirmNotif = {
      id: `notif-${Date.now()}`,
      user_id: apt.patient_id,
      title: 'Free Appointment Confirmed!',
      message: notifMsg,
      type: 'booking',
      channel: 'in_app',
      is_read: false,
      created_at: new Date().toISOString()
    };
    db.notifications.unshift(confirmNotif);
    persistRecord('Notification', confirmNotif);

    try {
      const { broadcastEvent } = require('../config/socket');
      broadcastEvent('appointment_booked', { appointment: apt, notification: confirmNotif });
    } catch (e) {}
  }

  logAudit(
    req.user.id,
    req.user.full_name,
    req.user.role,
    'UPDATED_APPOINTMENT_STATUS',
    'appointments',
    apt.id,
    `Changed appointment status to ${status}`
  );

  res.json({ success: true, appointment: apt });
});

// DELETE /api/appointments/:id - Doctor cancels/deletes appointment and notifies patient
router.delete('/:id', (req, res) => {
  const aptIndex = db.appointments.findIndex(a => a.id === req.params.id);
  if (aptIndex === -1) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  const [deletedApt] = db.appointments.splice(aptIndex, 1);
  deleteRecord('Appointment', deletedApt.id);

  if (deletedApt.slot_id) {
    const slot = db.slots.find(s => s.id === deletedApt.slot_id);
    if (slot) {
      slot.status = 'available';
      persistRecord('Slot', slot);
    }
  }

  const targetPatientId = deletedApt.patient_id || deletedApt.user_id;

  const cancellationMsg = "The doctor has cancelled your appointment; please rebook your appointment.";

  const newNotif = {
    id: `notif-${Date.now()}`,
    user_id: targetPatientId,
    title: 'Appointment Cancelled',
    message: cancellationMsg,
    type: 'cancellation',
    channel: 'in_app',
    is_read: false,
    created_at: new Date().toISOString()
  };

  db.notifications.unshift(newNotif);
  persistRecord('Notification', newNotif);

  logAudit(
    req.user?.id || 'system',
    req.user?.full_name || 'Doctor',
    req.user?.role || 'doctor',
    'CANCELLED_APPOINTMENT',
    'appointments',
    deletedApt.id,
    `Cancelled appointment ${deletedApt.id} for patient ${deletedApt.patient_id}`
  );

  try {
    const { broadcastEvent } = require('../config/socket');
    broadcastEvent('appointment_cancelled', { appointmentId: deletedApt.id, notification: newNotif });
  } catch (e) {}

  res.json({
    success: true,
    message: 'Appointment cancelled successfully and patient notified.',
    notificationMessage: cancellationMsg
  });
});

// PUT /api/appointments/:id/reschedule - Reschedule appointment to a new slot
router.put('/:id/reschedule', (req, res) => {
  const aptId = req.params.id;
  const { new_slot_id, new_date, new_start_time, new_end_time } = req.body;

  const apt = db.appointments.find(a => a.id === aptId);
  if (!apt) return res.status(404).json({ error: 'Appointment not found' });

  // Free old slot if exists
  if (apt.slot_id) {
    const oldSlot = db.slots.find(s => s.id === apt.slot_id);
    if (oldSlot) {
      oldSlot.status = 'available';
      persistRecord('Slot', oldSlot);
    }
  }

  // Book new slot if provided
  if (new_slot_id) {
    const newSlot = db.slots.find(s => s.id === new_slot_id);
    if (newSlot) {
      newSlot.status = 'booked';
      persistRecord('Slot', newSlot);
    }
  }

  // Update appointment record
  apt.slot_id = new_slot_id || apt.slot_id;
  apt.appointment_date = new_date || apt.appointment_date;
  apt.start_time = new_start_time || apt.start_time;
  apt.end_time = new_end_time || apt.end_time;
  apt.status = 'confirmed';
  persistRecord('Appointment', apt);

  const patientObj = db.users.find(u => u.id === apt.patient_id);
  const doctorObj = db.users.find(u => u.id === apt.doctor_id);
  const patientName = patientObj ? patientObj.full_name : 'Patient';
  const doctorName = doctorObj ? doctorObj.full_name : 'Doctor';

  // 1. Send Notification to Doctor
  const doctorNotif = {
    id: `notif-${Date.now()}-doc-reschedule`,
    user_id: apt.doctor_id,
    title: 'Appointment Rescheduled by Patient',
    message: `Patient ${patientName} has rescheduled their appointment to ${apt.appointment_date} at ${apt.start_time}.`,
    type: 'booking',
    channel: 'in_app',
    is_read: false,
    created_at: new Date().toISOString()
  };
  db.notifications.unshift(doctorNotif);
  persistRecord('Notification', doctorNotif);

  // 2. Send Notification to Patient
  const patientNotif = {
    id: `notif-${Date.now()}-pat-reschedule`,
    user_id: apt.patient_id,
    title: 'Appointment Rescheduled Confirmed',
    message: `Your appointment with ${doctorName} has been successfully rescheduled to ${apt.appointment_date} at ${apt.start_time}.`,
    type: 'booking',
    channel: 'in_app',
    is_read: false,
    created_at: new Date().toISOString()
  };
  db.notifications.unshift(patientNotif);
  persistRecord('Notification', patientNotif);

  // Audit log
  logAudit(
    req.user.id,
    req.user.full_name,
    req.user.role,
    'RESCHEDULED_APPOINTMENT',
    'appointments',
    apt.id,
    `Rescheduled appointment with ${doctorName} to ${apt.appointment_date} at ${apt.start_time}`
  );

  try {
    const { broadcastEvent } = require('../config/socket');
    broadcastEvent('appointment_rescheduled', { appointment: apt, doctorNotif, patientNotif });
  } catch (e) {}

  res.json({
    success: true,
    message: 'Appointment rescheduled successfully!',
    appointment: apt
  });
});

// PUT /api/appointments/:id/cancel - Cancel appointment & initiate refund
router.put('/:id/cancel', (req, res) => {
  const aptId = req.params.id;
  const { reason } = req.body;

  const apt = db.appointments.find(a => a.id === aptId);
  if (!apt) return res.status(404).json({ error: 'Appointment not found' });

  // Free associated slot
  if (apt.slot_id) {
    const slot = db.slots.find(s => s.id === apt.slot_id);
    if (slot) {
      slot.status = 'available';
      slot.is_booked = false;
      persistRecord('Slot', slot);
    }
  }

  // Update appointment status and refund fields
  apt.status = 'cancelled';
  const refundAmount = apt.booking_fee ?? 0;
  const paymentMethod = apt.payment_method || 'original payment account';
  apt.refund_status = 'processed';
  apt.refund_amount = refundAmount;
  apt.refund_method = paymentMethod;
  apt.refund_timeline = '2 to 3 business days';
  apt.cancellation_reason = reason || 'Cancelled by patient';
  persistRecord('Appointment', apt);

  const patientObj = db.users.find(u => u.id === apt.patient_id);
  const doctorObj = db.users.find(u => u.id === apt.doctor_id);
  const patientName = patientObj ? patientObj.full_name : 'Patient';
  const doctorName = doctorObj ? doctorObj.full_name : 'Doctor';

  const aptDateStr = apt.appointment_date || apt.date || 'Scheduled Date';
  const aptTimeStr = apt.start_time || apt.slot_time || 'Scheduled Time';

  // 1. Send Notification to Doctor
  const doctorNotif = {
    id: `notif-${Date.now()}-doc-cancel`,
    user_id: apt.doctor_id,
    title: 'Appointment Cancelled by Patient',
    message: `Patient ${patientName} has cancelled their appointment scheduled for ${aptDateStr} at ${aptTimeStr}. The slot is now restored and available for new bookings.`,
    type: 'cancellation',
    channel: 'in_app',
    is_read: false,
    created_at: new Date().toISOString()
  };
  db.notifications.unshift(doctorNotif);
  persistRecord('Notification', doctorNotif);

  // 2. Send Notification to Patient
  const patientNotif = {
    id: `notif-${Date.now()}-pat-cancel`,
    user_id: apt.patient_id,
    title: 'Appointment Cancelled & Refund Initiated',
    message: `Your appointment with ${doctorName} for ${apt.appointment_date} has been cancelled. A refund of ₹${refundAmount} has been credited back to your ${paymentMethod} and will reflect in 2 to 3 business days.`,
    type: 'cancellation',
    channel: 'in_app',
    is_read: false,
    created_at: new Date().toISOString()
  };
  db.notifications.unshift(patientNotif);
  persistRecord('Notification', patientNotif);

  // Audit log
  logAudit(
    req.user.id,
    req.user.full_name,
    req.user.role,
    'CANCELLED_APPOINTMENT',
    'appointments',
    apt.id,
    `Cancelled appointment ${apt.id}. Refund of ₹${refundAmount} initiated to ${paymentMethod} (Est. 2-3 business days).`
  );

  try {
    const { broadcastEvent } = require('../config/socket');
    broadcastEvent('appointment_cancelled', { appointmentId: apt.id, notification: doctorNotif, patientNotif });
  } catch (e) {}

  res.json({
    success: true,
    message: `Appointment cancelled successfully. Refund of ₹${refundAmount} will be credited back to your ${paymentMethod} within 2 to 3 business days.`,
    appointment: apt,
    refund: {
      amount: refundAmount,
      method: paymentMethod,
      timeline: '2 to 3 business days'
    }
  });
});

module.exports = router;
