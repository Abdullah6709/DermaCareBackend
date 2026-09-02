const express = require('express');
const router = express.Router();
const { db, logAudit, persistRecord } = require('../db/database');

// GET /api/reviews - Get reviews for a doctor or current logged-in doctor
router.get('/', (req, res) => {
  const { doctorId } = req.query;
  const targetDoctorId = doctorId || (req.user && req.user.role === 'doctor' ? req.user.id : null);

  let reviewsList = [...(db.reviews || [])];

  if (targetDoctorId) {
    reviewsList = reviewsList.filter(r => r.doctor_id === targetDoctorId || r.doctor_id?.includes(targetDoctorId) || targetDoctorId.includes(r.doctor_id));
  }

  // Sort newest first
  reviewsList.sort((a, b) => new Date(b.created_at || Date.now()) - new Date(a.created_at || Date.now()));

  // Calculate average rating
  const totalRating = reviewsList.reduce((sum, r) => sum + (Number(r.rating) || 5), 0);
  const avgRating = reviewsList.length > 0 ? (totalRating / reviewsList.length).toFixed(1) : "5.0";

  res.json({
    count: reviewsList.length,
    average_rating: Number(avgRating),
    reviews: reviewsList
  });
});

// POST /api/reviews - Submit a new review for a doctor after treatment
router.post('/', (req, res) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { doctor_id, appointment_id, rating, comment, clinic_name } = req.body;

  if (!doctor_id) {
    return res.status(400).json({ error: 'Doctor ID is required' });
  }

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5 stars' });
  }

  const apt = db.appointments.find(a => a.id === appointment_id) || {};
  const patientObj = db.users.find(u => u.id === user.id) || {};

  const newReview = {
    id: `rev-${Date.now()}-${Math.floor(Math.random() * 100)}`,
    doctor_id,
    patient_id: user.id,
    patient_name: patientObj.full_name || user.full_name || 'Verified Patient',
    patient_avatar: patientObj.avatar_url || user.avatar_url || '',
    appointment_id: appointment_id || null,
    rating: Number(rating),
    comment: (comment || '').trim() || 'Great treatment & consultation experience.',
    clinic_name: clinic_name || apt.clinic_name || '',
    created_at: new Date().toISOString()
  };

  if (!Array.isArray(db.reviews)) {
    db.reviews = [];
  }

  db.reviews.unshift(newReview);
  persistRecord('Review', newReview);

  // Update doctor profile rating and reviews_count
  const allDocReviews = db.reviews.filter(r => r.doctor_id === doctor_id || r.doctor_id?.includes(doctor_id) || doctor_id.includes(r.doctor_id));
  const newAvg = (allDocReviews.reduce((sum, r) => sum + r.rating, 0) / allDocReviews.length).toFixed(1);

  const docProf = db.doctor_profiles.find(d => d.user_id === doctor_id || doctor_id.includes(d.user_id));
  if (docProf) {
    docProf.rating = Number(newAvg);
    docProf.reviews_count = allDocReviews.length;
    persistRecord('DoctorProfile', docProf);
  }

  // Create real-time notification for the doctor
  const docNotif = {
    id: `notif-${Date.now()}-rev`,
    user_id: doctor_id,
    title: 'New Patient Review Received ⭐',
    message: `${newReview.patient_name} submitted a ${rating}-star review: "${newReview.comment.substring(0, 60)}${newReview.comment.length > 60 ? '...' : ''}"`,
    type: 'review',
    channel: 'in_app',
    is_read: false,
    created_at: new Date().toISOString()
  };

  db.notifications.unshift(docNotif);
  persistRecord('Notification', docNotif);

  try {
    const { broadcastEvent } = require('../config/socket');
    broadcastEvent('review_submitted', { review: newReview, notification: docNotif });
  } catch (e) {}

  logAudit(user.id, user.full_name, user.role, 'SUBMITTED_REVIEW', 'reviews', newReview.id, `Patient reviewed doctor ${doctor_id} with ${rating} stars`);

  res.json({
    success: true,
    message: 'Thank you for your feedback! Your review has been submitted.',
    review: newReview
  });
});

module.exports = router;
