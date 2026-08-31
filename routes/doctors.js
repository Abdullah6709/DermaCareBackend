const express = require('express');
const router = express.Router();
const { db, calculateDistanceKm, logAudit, getNextUserId, getNextProfileId, persistRecord, deleteRecord, saveDiskStore } = require('../db/database');

// GET /api/doctors - Search doctors with distance & filters
router.get('/', (req, res) => {
  const {
    lat,
    lng,
    radius = 50, // in KM
    specialization,
    mode,
    search,
    verification_status
  } = req.query;

  // Default lat/lng to Mumbai center (19.0760, 72.8777) if not provided
  const patientLat = lat ? parseFloat(lat) : 19.0760;
  const patientLng = lng ? parseFloat(lng) : 72.8777;
  const radiusKm = parseFloat(radius);

  let doctors = [];

  db.doctor_profiles.forEach(docProf => {
    const userObj = db.users.find(u => u.id === docProf.user_id) || {};
    const distanceKm = calculateDistanceKm(patientLat, patientLng, docProf.latitude, docProf.longitude);
    const allAvailableSlots = db.slots.filter(s => s.doctor_id === docProf.user_id && s.status === 'available');

    // Collect clinic practices for this doctor
    let clinicsList = Array.isArray(docProf.clinics) && docProf.clinics.length > 0
      ? [...docProf.clinics]
      : [{
          id: `clinic-${docProf.id}`,
          clinic_name: docProf.clinic_name || 'DermaCare Clinic',
          clinic_address: docProf.clinic_address || '',
          consultation_fee: docProf.consultation_fee ?? 0,
          consultation_modes: docProf.consultation_modes || 'both'
        }];

    // Also include any distinct clinic_name found in available slots
    allAvailableSlots.forEach(s => {
      if (s.clinic_name && !clinicsList.some(c => (c.clinic_name || '').toLowerCase() === s.clinic_name.toLowerCase())) {
        clinicsList.push({
          id: `clinic-${s.id}`,
          clinic_name: s.clinic_name,
          clinic_address: s.clinic_address || docProf.clinic_address || '',
          consultation_fee: s.consultation_fee ?? docProf.consultation_fee ?? 0,
          consultation_modes: s.consultation_modes || docProf.consultation_modes || 'both'
        });
      }
    });

    // Expand doctor listing per clinic practice location
    clinicsList.forEach(clinic => {
      // Find slots matching this clinic
      const clinicSlots = allAvailableSlots.filter(s => {
        if (!s.clinic_name || clinicsList.length === 1) return true;
        return (s.clinic_name || '').toLowerCase() === (clinic.clinic_name || '').toLowerCase();
      });

      const slotFee = clinicSlots.find(s => s.consultation_fee !== undefined && s.consultation_fee !== null)?.consultation_fee;
      const effectiveFee = slotFee !== undefined
        ? Number(slotFee)
        : Number(clinic.consultation_fee ?? docProf.consultation_fee ?? 0);

      doctors.push({
        ...docProf,
        id: `${docProf.id}-${(clinic.clinic_name || 'clinic').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`,
        profile_id: docProf.id,
        doctor_id: docProf.user_id,
        user_id: docProf.user_id,
        doctor_name: userObj.full_name,
        avatar_url: userObj.avatar_url,
        phone: userObj.phone,
        email: userObj.email,
        clinic_name: clinic.clinic_name || 'DermaCare Clinic',
        clinic_address: clinic.clinic_address || '',
        consultation_fee: effectiveFee,
        distance_km: distanceKm,
        available_slots_count: clinicSlots.length,
        available_slots: clinicSlots
      });
    });
  });

  // Filter verification status (allow verified or unapproved depending on query)
  if (verification_status) {
    doctors = doctors.filter(d => !d.verification_status || d.verification_status === verification_status);
  }

  // Filter by distance radius (if radius >= 500, ignore distance cap)
  if (radiusKm && !isNaN(radiusKm) && radiusKm < 500) {
    doctors = doctors.filter(d => !d.distance_km || d.distance_km <= radiusKm);
  }

  // Filter by specialization
  if (specialization && specialization !== 'All') {
    const keywords = specialization
      .toLowerCase()
      .split(/[\s&,/-]+/)
      .filter(w => w.length > 2 && w !== 'clinic' && w !== 'specialist' && w !== 'dermatology');

    doctors = doctors.filter(d => {
      const docSpec = (d.specialization || '').toLowerCase();
      const docBio = (d.bio || '').toLowerCase();
      const clinic = (d.clinic_name || '').toLowerCase();
      if (!docSpec) return true; // Keep doctor if specialization not yet filled
      if (docSpec.includes(specialization.toLowerCase())) return true;
      return keywords.some(kw => docSpec.includes(kw) || docBio.includes(kw) || clinic.includes(kw));
    });
  }

  // Filter by consultation mode
  if (mode && mode !== 'all') {
    doctors = doctors.filter(d =>
      !d.consultation_modes ||
      d.consultation_modes === 'both' ||
      d.consultation_modes === mode ||
      (Array.isArray(d.available_slots) && d.available_slots.some(s => s.slot_type === mode))
    );
  }

  // Filter by search query
  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    doctors = doctors.filter(d =>
      (d.doctor_name || '').toLowerCase().includes(term) ||
      (d.specialization || '').toLowerCase().includes(term) ||
      (d.clinic_name || '').toLowerCase().includes(term) ||
      (d.clinic_address || '').toLowerCase().includes(term) ||
      (d.qualifications || '').toLowerCase().includes(term)
    );
  }

  // Sort by distance ascending by default
  doctors.sort((a, b) => (a.distance_km || 0) - (b.distance_km || 0));

  res.json({
    count: doctors.length,
    doctors
  });
});

// PUT /api/doctors/profile - Update doctor user and profile settings
router.put('/profile', (req, res) => {
  const doctorId = req.user.id;
  const { full_name, email, phone, avatar_url, specialization, qualifications, experience_years, clinic_name, clinic_address, consultation_fee, consultation_modes, bio, clinics } = req.body;

  const user = db.users.find(u => u.id === doctorId);
  if (user) {
    if (full_name) user.full_name = full_name;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (avatar_url) user.avatar_url = avatar_url;
    persistRecord('User', user);
  }

  let docProf = db.doctor_profiles.find(d => d.user_id === doctorId);
  if (!docProf) {
    docProf = {
      id: `doc-${Date.now()}`,
      user_id: doctorId,
      status: 'approved',
      rating: 4.8,
      reviews_count: 12
    };
    db.doctor_profiles.push(docProf);
  }

  if (specialization !== undefined) docProf.specialization = specialization;
  if (qualifications !== undefined) docProf.qualifications = qualifications;
  if (experience_years !== undefined) docProf.experience_years = Number(experience_years);
  if (clinic_name !== undefined) docProf.clinic_name = clinic_name;
  if (clinic_address !== undefined) docProf.clinic_address = clinic_address;
  if (consultation_fee !== undefined) docProf.consultation_fee = Number(consultation_fee);
  if (consultation_modes !== undefined) docProf.consultation_modes = consultation_modes;
  if (bio !== undefined) docProf.bio = bio;
  if (avatar_url !== undefined) docProf.avatar_url = avatar_url;
  if (clinics !== undefined) {
    docProf.clinics = clinics;
    if (clinics.length > 0) {
      docProf.clinic_name = clinics[0].clinic_name || docProf.clinic_name;
      docProf.clinic_address = clinics[0].clinic_address || docProf.clinic_address;
      docProf.consultation_fee = clinics[0].consultation_fee !== undefined ? Number(clinics[0].consultation_fee) : docProf.consultation_fee;
      docProf.consultation_modes = clinics[0].consultation_modes || docProf.consultation_modes;
    }
  }

  persistRecord('DoctorProfile', docProf);

  logAudit(req.user.id, req.user.full_name, req.user.role, 'UPDATED_DOCTOR_PROFILE', 'doctor_profiles', docProf.id, 'Updated doctor profile settings');

  res.json({
    success: true,
    message: 'Profile settings updated successfully!',
    profile: docProf
  });
});

// GET /api/doctors/slots or /api/doctors/slots/my-slots - Get doctor's availability slots
router.get(['/slots', '/slots/my-slots'], (req, res) => {
  const doctorId = req.query.doctor_id || req.user?.id;
  if (!doctorId) {
    return res.status(400).json({ error: 'Doctor ID is required' });
  }
  const slots = db.slots.filter(s => s.doctor_id === doctorId || s.doctor_id === `user-${doctorId}` || doctorId.includes(s.doctor_id));
  res.json({ slots, count: slots.length });
});

// GET /api/doctors/:id - Specific doctor detail profile
router.get('/:id', (req, res) => {
  const requestedId = req.params.id;

  // First try to find matching doctor profile directly or by ID prefix
  let docProf = db.doctor_profiles.find(d => d.id === requestedId || d.user_id === requestedId);
  
  if (!docProf) {
    docProf = db.doctor_profiles.find(d => requestedId.startsWith(d.id) || requestedId.includes(d.user_id));
  }

  if (!docProf) {
    return res.status(404).json({ error: 'Doctor not found' });
  }

  const userObj = db.users.find(u => u.id === docProf.user_id) || {};
  let allSlots = db.slots.filter(s => s.doctor_id === docProf.user_id);

  // Match specific clinic practice if requestedId matches clinic listing ID
  let clinicsList = Array.isArray(docProf.clinics) && docProf.clinics.length > 0
    ? [...docProf.clinics]
    : [{
        id: `clinic-${docProf.id}`,
        clinic_name: docProf.clinic_name || 'DermaCare Clinic',
        clinic_address: docProf.clinic_address || '',
        consultation_fee: docProf.consultation_fee ?? 0
      }];

  let matchedClinic = clinicsList.find(c => {
    const fullClinicId = `${docProf.id}-${(c.clinic_name || 'clinic').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;
    return requestedId.toLowerCase() === fullClinicId.toLowerCase();
  });

  if (!matchedClinic && clinicsList.length > 0) {
    matchedClinic = clinicsList.find(c => {
      const slug = (c.clinic_name || '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      return requestedId.toLowerCase().endsWith(slug);
    });
  }

  const activeClinicName = matchedClinic ? matchedClinic.clinic_name : (docProf.clinic_name || 'DermaCare Clinic');
  const activeClinicAddress = matchedClinic ? matchedClinic.clinic_address : (docProf.clinic_address || '');

  // Filter slots strictly matching this specific practice clinic location
  const matchingSlots = allSlots.filter(s => {
    if (!s.clinic_name || clinicsList.length === 1) return true;
    return (s.clinic_name || '').trim().toLowerCase() === activeClinicName.trim().toLowerCase();
  });

  const slotFee = matchingSlots.find(s => s.consultation_fee !== undefined && s.consultation_fee !== null)?.consultation_fee;
  const activeConsultationFee = slotFee !== undefined
    ? Number(slotFee)
    : (matchedClinic && matchedClinic.consultation_fee !== undefined
      ? Number(matchedClinic.consultation_fee)
      : Number(docProf.consultation_fee || 0));

  res.json({
    doctor: {
      ...docProf,
      id: requestedId,
      doctor_name: userObj.full_name,
      avatar_url: userObj.avatar_url,
      phone: userObj.phone,
      email: userObj.email,
      clinic_name: activeClinicName,
      clinic_address: activeClinicAddress,
      consultation_fee: activeConsultationFee,
      slots: matchingSlots
    }
  });
});

// POST /api/doctors/slots - Generate / Add new slots (Single or Bulk)
router.post('/slots', (req, res) => {
  const doctorId = req.user.id;
  const docProf = db.doctor_profiles.find(d => d.user_id === doctorId);

  let rawSlots = [];
  if (Array.isArray(req.body.slots)) {
    rawSlots = req.body.slots;
  } else if (Array.isArray(req.body)) {
    rawSlots = req.body;
  } else {
    rawSlots = [req.body];
  }

  if (rawSlots.length === 0) {
    return res.status(400).json({ error: 'No slot data provided' });
  }

  const createdSlots = [];
  rawSlots.forEach((s, idx) => {
    const clinicName = s.clinic_name || docProf?.clinics?.[0]?.clinic_name || docProf?.clinic_name || 'DermaCare Clinic';
    const matchedClinic = docProf?.clinics?.find(c => c.clinic_name === clinicName);
    const fee = s.consultation_fee !== undefined && s.consultation_fee !== null
      ? Number(s.consultation_fee)
      : Number(matchedClinic?.consultation_fee ?? docProf?.consultation_fee ?? 0);

    const newSlot = {
      id: `slot-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
      doctor_id: doctorId,
      clinic_name: clinicName,
      consultation_fee: fee,
      date: s.date || new Date().toISOString().split('T')[0],
      start_time: s.start_time || '04:00 PM',
      end_time: s.end_time || '04:30 PM',
      slot_type: s.slot_type || 'online',
      status: s.status || 'available'
    };

    db.slots.push(newSlot);
    persistRecord('Slot', newSlot);
    createdSlots.push(newSlot);
  });

  logAudit(req.user.id, req.user.full_name, req.user.role, 'CREATED_SLOTS', 'slots', createdSlots[0]?.id || '', `Created ${createdSlots.length} availability slot(s)`);

  res.json({
    success: true,
    count: createdSlots.length,
    slots: createdSlots,
    slot: createdSlots[0]
  });
});

// POST /api/doctors/slots/bulk - Bulk add slots endpoint
router.post('/slots/bulk', (req, res) => {
  const doctorId = req.user.id;
  const docProf = db.doctor_profiles.find(d => d.user_id === doctorId);

  const rawSlots = Array.isArray(req.body.slots) ? req.body.slots : (Array.isArray(req.body) ? req.body : []);
  if (rawSlots.length === 0) {
    return res.status(400).json({ error: 'No bulk slots provided' });
  }

  const createdSlots = [];
  rawSlots.forEach((s, idx) => {
    const clinicName = s.clinic_name || docProf?.clinics?.[0]?.clinic_name || docProf?.clinic_name || 'DermaCare Clinic';
    const matchedClinic = docProf?.clinics?.find(c => c.clinic_name === clinicName);
    const fee = s.consultation_fee !== undefined && s.consultation_fee !== null
      ? Number(s.consultation_fee)
      : Number(matchedClinic?.consultation_fee ?? docProf?.consultation_fee ?? 0);

    const newSlot = {
      id: `slot-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
      doctor_id: doctorId,
      clinic_name: clinicName,
      consultation_fee: fee,
      date: s.date || new Date().toISOString().split('T')[0],
      start_time: s.start_time || '04:00 PM',
      end_time: s.end_time || '04:30 PM',
      slot_type: s.slot_type || 'online',
      status: 'available'
    };

    db.slots.push(newSlot);
    persistRecord('Slot', newSlot);
    createdSlots.push(newSlot);
  });

  logAudit(req.user.id, req.user.full_name, req.user.role, 'CREATED_BULK_SLOTS', 'slots', createdSlots[0]?.id || '', `Created ${createdSlots.length} bulk availability slots`);

  res.json({
    success: true,
    count: createdSlots.length,
    slots: createdSlots
  });
});


// PUT /api/doctors/slots/:id - Update an availability slot and notify patient if booked
router.put('/slots/:id', (req, res) => {
  const { date, start_time, end_time, slot_type, status, clinic_name, consultation_fee } = req.body;
  const slot = db.slots.find(s => s.id === req.params.id);

  if (!slot) {
    return res.status(404).json({ error: 'Slot not found' });
  }

  if (date) slot.date = date;
  if (start_time) slot.start_time = start_time;
  if (end_time) slot.end_time = end_time;
  if (slot_type) slot.slot_type = slot_type;
  if (status) slot.status = status;
  if (clinic_name) slot.clinic_name = clinic_name;
  if (consultation_fee !== undefined && consultation_fee !== null) {
    slot.consultation_fee = Number(consultation_fee);
  }

  persistRecord('Slot', slot);

  const affectedApts = db.appointments.filter(a => a.slot_id === slot.id);
  affectedApts.forEach(apt => {
    apt.appointment_date = slot.date;
    apt.start_time = slot.start_time;
    apt.end_time = slot.end_time;
    apt.appointment_type = slot.slot_type;
    persistRecord('Appointment', apt);

    const patientId = apt.patient_id || apt.user_id;
    const notifMsg = `The doctor has updated your appointment slot for ${slot.date} at ${slot.start_time}; please check your updated schedule or rebook if necessary.`;

    const notif = {
      id: `notif-${Date.now()}-${Math.floor(Math.random() * 100)}`,
      user_id: patientId,
      title: 'Appointment Slot Updated',
      message: notifMsg,
      type: 'cancellation',
      channel: 'in_app',
      is_read: false,
      created_at: new Date().toISOString()
    };

    db.notifications.unshift(notif);
    persistRecord('Notification', notif);

    try {
      const { broadcastEvent } = require('../config/socket');
      broadcastEvent('appointment_cancelled', { appointmentId: apt.id, notification: notif });
    } catch (e) {}
  });

  logAudit(req.user.id, req.user.full_name, req.user.role, 'UPDATED_AVAILABILITY_SLOT', 'slots', slot.id, `Updated ${slot.slot_type} slot on ${slot.date}`);

  res.json({ success: true, slot });
});

// DELETE /api/doctors/slots/:id - Delete an availability slot and notify patient if booked
router.delete('/slots/:id', (req, res) => {
  const index = db.slots.findIndex(s => s.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Slot not found' });
  }

  const [deletedSlot] = db.slots.splice(index, 1);
  deleteRecord('Slot', deletedSlot.id);

  const affectedApts = db.appointments.filter(a => a.slot_id === deletedSlot.id);
  affectedApts.forEach(apt => {
    const aptIndex = db.appointments.findIndex(a => a.id === apt.id);
    if (aptIndex !== -1) {
      const [delApt] = db.appointments.splice(aptIndex, 1);
      deleteRecord('Appointment', delApt.id);
    }

    const patientId = apt.patient_id || apt.user_id;
    const fee = apt.booking_fee ?? 0;
    const cancellationMsg = `The doctor has cancelled your appointment slot on ${deletedSlot.date}. A full consultation fee refund of ₹${fee} has been credited to your payment account (Est. 2-3 business days).`;

    const notif = {
      id: `notif-${Date.now()}-${Math.floor(Math.random() * 100)}`,
      user_id: patientId,
      title: 'Appointment Cancelled & Fee Refunded',
      message: cancellationMsg,
      type: 'cancellation',
      refund_amount: fee,
      channel: 'in_app',
      is_read: false,
      created_at: new Date().toISOString()
    };

    db.notifications.unshift(notif);
    persistRecord('Notification', notif);

    try {
      const { broadcastEvent } = require('../config/socket');
      broadcastEvent('appointment_cancelled', { appointmentId: apt.id, notification: notif });
    } catch (e) {}
  });

  logAudit(req.user.id, req.user.full_name, req.user.role, 'DELETED_AVAILABILITY_SLOT', 'slots', deletedSlot.id, `Deleted slot on ${deletedSlot.date}`);

  res.json({ success: true, message: 'Slot deleted successfully and affected patient notified.' });
});

// POST /api/doctors/holidays - Mark holiday / leave, remove slots & cancel booked appointments with patient notifications
router.post('/holidays', (req, res) => {
  const { start_date, end_date, reason } = req.body;
  const doctorId = req.user.id;

  if (!start_date) {
    return res.status(400).json({ error: 'Start date is required' });
  }

  const startDateStr = start_date;
  const endDateStr = end_date || start_date;

  // 1. Find all slots of this doctor in the leave date range [startDateStr, endDateStr]
  const slotsToRemove = db.slots.filter(s => s.doctor_id === doctorId && s.date >= startDateStr && s.date <= endDateStr);
  const slotIds = new Set(slotsToRemove.map(s => s.id));
  const backedUpSlots = slotsToRemove.map(s => ({ ...s, status: 'available' }));

  // 2. Find all appointments of this doctor or tied to these slots in the leave date range
  const affectedAppointments = db.appointments.filter(a =>
    (a.doctor_id === doctorId || slotIds.has(a.slot_id)) &&
    a.appointment_date >= startDateStr && a.appointment_date <= endDateStr
  );

  // 3. Cancel affected appointments and send patient notifications to rebook
  affectedAppointments.forEach(apt => {
    const patientId = apt.patient_id || apt.user_id;
    const fee = apt.booking_fee ?? 0;
    const notifMsg = `The doctor has taken leave from ${startDateStr} to ${endDateStr} (${reason || 'Holiday'}). Your appointment on ${apt.appointment_date} has been cancelled. A full consultation fee refund of ₹${fee} has been credited to your payment account (Est. 2-3 business days).`;

    const notif = {
      id: `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      user_id: patientId,
      title: 'Appointment Cancelled & Fee Refunded',
      message: notifMsg,
      type: 'cancellation',
      refund_amount: fee,
      channel: 'in_app',
      is_read: false,
      created_at: new Date().toISOString()
    };

    db.notifications.unshift(notif);
    persistRecord('Notification', notif);

    try {
      const { broadcastEvent } = require('../config/socket');
      broadcastEvent('appointment_cancelled', { appointmentId: apt.id, notification: notif });
    } catch (e) {}

    // Remove appointment from db.appointments
    const aptIdx = db.appointments.findIndex(a => a.id === apt.id);
    if (aptIdx !== -1) {
      const [delApt] = db.appointments.splice(aptIdx, 1);
      deleteRecord('Appointment', delApt.id);
    }
  });

  // 4. Remove slots from db.slots
  slotsToRemove.forEach(s => {
    const slotIdx = db.slots.findIndex(slot => slot.id === s.id);
    if (slotIdx !== -1) {
      const [delSlot] = db.slots.splice(slotIdx, 1);
      deleteRecord('Slot', delSlot.id);
    }
  });

  // 5. Store holiday record
  if (!db.doctor_holidays) {
    db.doctor_holidays = [];
  }

  const newHoliday = {
    id: `holiday-${Date.now()}`,
    doctor_id: doctorId,
    start_date: startDateStr,
    end_date: endDateStr,
    reason: reason || 'Personal Holiday / Leave',
    removed_slots_count: slotsToRemove.length,
    cancelled_appointments_count: affectedAppointments.length,
    backed_up_slots: backedUpSlots,
    created_at: new Date().toISOString()
  };

  db.doctor_holidays.unshift(newHoliday);
  persistRecord('DoctorHoliday', newHoliday);

  logAudit(req.user.id, req.user.full_name, req.user.role, 'MARKED_HOLIDAY_LEAVE', 'doctor_holidays', newHoliday.id, `Marked holiday from ${startDateStr} to ${endDateStr}. Removed ${slotsToRemove.length} slots and cancelled ${affectedAppointments.length} appointments.`);

  res.json({
    success: true,
    holiday: newHoliday,
    message: `Holiday recorded successfully. ${slotsToRemove.length} slots removed and ${affectedAppointments.length} patient appointments cancelled with rebooking notifications sent.`
  });
});

// GET /api/doctors/holidays/my-holidays - Get list of doctor's marked holidays
router.get('/holidays/my-holidays', (req, res) => {
  const doctorId = req.user.id;
  const holidays = (db.doctor_holidays || []).filter(h => h.doctor_id === doctorId);
  res.json({ holidays });
});

// DELETE /api/doctors/holidays/:id - Cancel a recorded holiday & restore all backed up slots
router.delete('/holidays/:id', (req, res) => {
  const doctorId = req.user.id;
  const idx = (db.doctor_holidays || []).findIndex(h => h.id === req.params.id && h.doctor_id === doctorId);
  if (idx === -1) {
    return res.status(404).json({ error: 'Holiday record not found' });
  }
  const [delHol] = db.doctor_holidays.splice(idx, 1);
  deleteRecord('DoctorHoliday', delHol.id);

  // Restore all backed up slots for this deleted holiday
  const oldSlots = Array.isArray(delHol.backed_up_slots) ? delHol.backed_up_slots : [];
  let restoredCount = 0;
  oldSlots.forEach(s => {
    const exists = db.slots.find(slot => slot.id === s.id || (slot.doctor_id === doctorId && slot.date === s.date && slot.start_time === s.start_time));
    if (!exists) {
      const restored = { ...s, status: 'available' };
      db.slots.push(restored);
      persistRecord('Slot', restored);
      restoredCount++;
    } else {
      exists.status = 'available';
      persistRecord('Slot', exists);
      restoredCount++;
    }
  });

  res.json({ success: true, message: `Holiday leave record removed. Restored ${restoredCount} availability slots.` });
});

// PUT /api/doctors/holidays/:id - Update a recorded holiday leave period & restore previous slots
router.put('/holidays/:id', (req, res) => {
  const doctorId = req.user.id;
  const { start_date, end_date, reason } = req.body;

  const holiday = (db.doctor_holidays || []).find(h => h.id === req.params.id && h.doctor_id === doctorId);
  if (!holiday) {
    return res.status(404).json({ error: 'Holiday record not found' });
  }

  const startDateStr = start_date || holiday.start_date;
  const endDateStr = end_date || holiday.end_date;

  // 1. RESTORE all previously backed up slots for this holiday
  const previousBackedUp = Array.isArray(holiday.backed_up_slots) ? holiday.backed_up_slots : [];
  let restoredCount = 0;
  previousBackedUp.forEach(slotData => {
    const existing = db.slots.find(s => s.id === slotData.id || (s.doctor_id === doctorId && s.date === slotData.date && s.start_time === slotData.start_time));
    if (!existing) {
      const restoredSlot = {
        ...slotData,
        status: 'available'
      };
      db.slots.push(restoredSlot);
      persistRecord('Slot', restoredSlot);
      restoredCount++;
    } else {
      existing.status = 'available';
      persistRecord('Slot', existing);
      restoredCount++;
    }
  });

  // 2. PURGE slots in the NEW updated date range [startDateStr, endDateStr]
  const newSlotsToRemove = db.slots.filter(s => s.doctor_id === doctorId && s.date >= startDateStr && s.date <= endDateStr);
  const newSlotIds = new Set(newSlotsToRemove.map(s => s.id));
  const newBackedUpSlots = newSlotsToRemove.map(s => ({ ...s, status: 'available' }));

  const affectedAppointments = db.appointments.filter(a =>
    (a.doctor_id === doctorId || newSlotIds.has(a.slot_id)) &&
    a.appointment_date >= startDateStr && a.appointment_date <= endDateStr
  );

  affectedAppointments.forEach(apt => {
    const patientId = apt.patient_id || apt.user_id;
    const fee = apt.booking_fee ?? 0;
    const notifMsg = `The doctor has updated leave dates to ${startDateStr} - ${endDateStr}. Your appointment on ${apt.appointment_date} has been cancelled. A full refund of ₹${fee} has been processed.`;

    const notif = {
      id: `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      user_id: patientId,
      title: 'Appointment Cancelled & Fee Refunded',
      message: notifMsg,
      type: 'cancellation',
      refund_amount: fee,
      channel: 'in_app',
      is_read: false,
      created_at: new Date().toISOString()
    };

    db.notifications.unshift(notif);
    persistRecord('Notification', notif);

    try {
      const { broadcastEvent } = require('../config/socket');
      broadcastEvent('appointment_cancelled', { appointmentId: apt.id, notification: notif });
    } catch (e) {}

    const aptIdx = db.appointments.findIndex(a => a.id === apt.id);
    if (aptIdx !== -1) {
      const [delApt] = db.appointments.splice(aptIdx, 1);
      deleteRecord('Appointment', delApt.id);
    }
  });

  newSlotsToRemove.forEach(s => {
    const slotIdx = db.slots.findIndex(slot => slot.id === s.id);
    if (slotIdx !== -1) {
      const [delSlot] = db.slots.splice(slotIdx, 1);
      deleteRecord('Slot', delSlot.id);
    }
  });

  holiday.start_date = startDateStr;
  holiday.end_date = endDateStr;
  if (reason !== undefined) holiday.reason = reason;
  holiday.backed_up_slots = newBackedUpSlots;
  holiday.removed_slots_count = newBackedUpSlots.length;
  holiday.cancelled_appointments_count = (holiday.cancelled_appointments_count || 0) + affectedAppointments.length;

  persistRecord('DoctorHoliday', holiday);

  res.json({
    success: true,
    holiday,
    message: `Holiday leave period updated! Restored ${restoredCount} previous slot(s) and applied updated leave schedule.`
  });
});

// POST /api/doctors/create-patient - Dermatologist creates patient account
router.post('/create-patient', (req, res) => {
  const { full_name, email, phone, dob, gender, blood_group, allergies, medical_history } = req.body;

  if (!full_name || !email) {
    return res.status(400).json({ error: 'Full name and email are required' });
  }

  const cleanEmail = email.trim();
  const existing = db.users.find(u => u.email && u.email.trim().toLowerCase() === cleanEmail.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  const userId = getNextUserId('patient');
  const newUser = {
    id: userId,
    email: cleanEmail,
    role: 'client',
    status: 'pending',
    full_name,
    phone: phone || '+91 98000 00000',
    avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300',
    created_at: new Date().toISOString()
  };

  const newPatientProfile = {
    id: getNextProfileId('patprof-', db.patient_profiles),
    user_id: userId,
    dob: dob || '1995-01-01',
    gender: gender || 'Other',
    blood_group: blood_group || 'O+',
    emergency_contact: 'Family Member (+1 555 010-0000)',
    allergies: allergies || 'None reported',
    medical_history: medical_history || 'No prior dermatological conditions'
  };

  db.users.push(newUser);
  db.patient_profiles.push(newPatientProfile);

  // Persist to MongoDB Atlas
  persistRecord('User', newUser);
  persistRecord('PatientProfile', newPatientProfile);

  const actorId = req.user ? req.user.id : 'user-doc-1';
  const actorName = req.user ? req.user.full_name : 'Dermatologist';
  const actorRole = req.user ? req.user.role : 'doctor';

  logAudit(actorId, actorName, actorRole, 'CREATED_PATIENT_ACCOUNT', 'users', userId, `Dermatologist created new patient ${full_name} (${userId})`);

  res.status(201).json({
    success: true,
    message: `Patient account ${userId} created successfully!`,
    user: newUser,
    patientProfile: newPatientProfile
  });
});

// PUT /api/doctors/profile - Update doctor profile settings
router.put('/profile', (req, res) => {
  const doctorUserId = req.user ? req.user.id : req.headers['x-user-id'];
  if (!doctorUserId) {
    return res.status(401).json({ error: 'Unauthorized: Missing user identification' });
  }

  const user = db.users.find(u => u.id === doctorUserId);
  let docProf = db.doctor_profiles.find(d => d.user_id === doctorUserId);

  if (!user) {
    return res.status(404).json({ error: 'Doctor account not found' });
  }

  const {
    full_name,
    email,
    phone,
    avatar_url,
    specialization,
    qualifications,
    experience_years,
    clinic_name,
    clinic_address,
    consultation_fee,
    consultation_modes,
    bio,
    clinics
  } = req.body;

  if (full_name !== undefined) user.full_name = full_name;
  if (email !== undefined) user.email = email;
  if (phone !== undefined) user.phone = phone;
  if (avatar_url !== undefined) {
    user.avatar_url = avatar_url;
    if (docProf) docProf.avatar_url = avatar_url;
  }

  if (!docProf) {
    docProf = {
      id: getNextProfileId('docprof-', db.doctor_profiles),
      user_id: doctorUserId,
      avatar_url: user.avatar_url || '',
      specialization: 'General Dermatology',
      qualifications: '',
      experience_years: 0,
      clinic_name: '',
      clinic_address: '',
      latitude: 19.0760,
      longitude: 72.8777,
      bio: '',
      verification_status: 'verified',
      consultation_modes: 'both',
      rating: 5.0,
      reviews_count: 0,
      consultation_fee: 0
    };
    db.doctor_profiles.push(docProf);
  }

  if (specialization !== undefined) docProf.specialization = Array.isArray(specialization) ? specialization.join(', ') : specialization;
  if (qualifications !== undefined) docProf.qualifications = qualifications;
  if (experience_years !== undefined) docProf.experience_years = parseInt(experience_years) || 0;
  if (clinic_name !== undefined) docProf.clinic_name = clinic_name;
  if (clinic_address !== undefined) docProf.clinic_address = clinic_address;
  if (consultation_fee !== undefined) docProf.consultation_fee = parseFloat(consultation_fee) || 0;
  if (consultation_modes !== undefined) docProf.consultation_modes = consultation_modes;
  if (bio !== undefined) docProf.bio = bio;
  if (clinics !== undefined) docProf.clinics = clinics;

  persistRecord('User', user);
  persistRecord('DoctorProfile', docProf);

  logAudit(doctorUserId, user.full_name, user.role, 'UPDATED_DOCTOR_PROFILE', 'doctor_profiles', docProf.id, `Doctor updated profile settings`);

  res.json({
    success: true,
    message: 'Profile settings updated successfully!',
    user,
    doctorProfile: docProf
  });
});

module.exports = router;
