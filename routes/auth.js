const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const { db, logAudit, getNextUserId, getNextProfileId, persistRecord } = require('../db/database');

// In-memory store for 6-digit verification OTPs
const otpStore = {};

// Helper: Get SMTP Transporter (Supports real Gmail SMTP or passwordless custom SMTP)
const getSmtpTransporter = async () => {
  dotenv.config();
  const smtpUser = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';
  const smtpPass = process.env.SMTP_PASS ? process.env.SMTP_PASS.replace(/\s+/g, '') : '';
  const smtpHost = process.env.SMTP_HOST ? process.env.SMTP_HOST.trim() : '';
  const smtpService = process.env.SMTP_SERVICE ? process.env.SMTP_SERVICE.trim() : '';

  if (smtpUser && smtpPass) {
    console.log(`📧 [SMTP ENGINE] Creating Gmail Nodemailer Transporter for user: ${smtpUser}`);
    return nodemailer.createTransport({
      service: smtpService || 'gmail',
      auth: {
        user: smtpUser,
        pass: smtpPass
      },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
      tls: {
        rejectUnauthorized: false
      }
    });
  }

  if (smtpHost) {
    const port = parseInt(process.env.SMTP_PORT) || 25;
    return nodemailer.createTransport({
      host: smtpHost,
      port: port,
      secure: false,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
      tls: { rejectUnauthorized: false }
    });
  }

  // If no SMTP configured, return null immediately without network calls
  return null;
};

// POST /api/auth/send-otp - Generate 6-digit OTP & send via SMTP
router.post('/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Email address is required to send OTP.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  // Check if account with email already exists
  const existing = db.users.find(u => u.email && u.email.trim().toLowerCase() === cleanEmail);
  if (existing) {
    return res.status(400).json({ error: 'An account with this email address already exists.' });
  }

  // Generate 6-digit numeric OTP
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes expiry

  otpStore[cleanEmail] = {
    otp: otpCode,
    expiresAt,
    verified: false
  };

  console.log(`\n========================================`);
  console.log(`🔐 [OTP GENERATED] Email: ${cleanEmail} | OTP Code: ${otpCode}`);
  console.log(`========================================\n`);

  try {
    const transporter = await getSmtpTransporter();
    if (!transporter) {
      throw new Error('SMTP email service is not configured on the server.');
    }

    const smtpUser = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';
    const fromAddress = process.env.SMTP_FROM || (smtpUser ? `"DermaCare Security" <${smtpUser}>` : 'no-reply@dermacare.in');
    const mailOptions = {
      from: fromAddress,
      to: cleanEmail,
      subject: `Your DermaCare Verification Code`,
      text: `Your DermaCare account verification code is: ${otpCode}\n\nThis code will expire in 10 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #0d9488; margin-top: 0;">DermaCare Healthcare</h2>
          <p style="font-size: 15px; color: #333333;">Your verification code is:</p>
          <div style="margin: 20px 0; text-align: center;">
            <span style="font-size: 30px; font-weight: bold; letter-spacing: 5px; color: #0d9488; background-color: #f0fdf4; padding: 10px 20px; border-radius: 6px; border: 1px solid #0d9488; display: inline-block;">
              ${otpCode}
            </span>
          </div>
          <p style="font-size: 13px; color: #666666;">This security code is valid for 10 minutes.</p>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`\n========================================`);
    console.log(`✅ [EMAIL DISPATCHED TO INBOX] OTP code sent to ${cleanEmail}! Message ID: ${info.messageId}`);
    console.log(`========================================\n`);

    return res.json({
      success: true,
      message: `Verification OTP has been sent to ${cleanEmail}. Please check your inbox!`
    });
  } catch (mailErr) {
    console.error('❌ [SMTP ERROR] Failed to send OTP email:', mailErr.message);
    return res.status(500).json({
      error: 'Failed to send OTP verification email. Please check your email address or try again later.'
    });
  }
});

// POST /api/auth/verify-otp - Validate 6-digit OTP code
router.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and 6-digit OTP code are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const record = otpStore[cleanEmail];

  if (!record) {
    return res.status(400).json({ error: 'No OTP requested for this email address or OTP expired. Please click Resend OTP.' });
  }

  if (Date.now() > record.expiresAt) {
    delete otpStore[cleanEmail];
    return res.status(400).json({ error: 'OTP code has expired. Please click Resend OTP to get a new code.' });
  }

  if (record.otp !== otp.toString().trim()) {
    return res.status(400).json({ error: 'Invalid 6-digit OTP code. Please check your email and try again.' });
  }

  record.verified = true;
  res.json({
    success: true,
    message: 'Email address verified successfully!'
  });
});

// In-memory store for Forgot Password OTPs
const forgotOtpStore = {};

// POST /api/auth/forgot-password/send-otp - Generate 6-digit OTP for password reset
router.post('/forgot-password/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Email address is required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const user = db.users.find(u => u.email && u.email.trim().toLowerCase() === cleanEmail);

  if (!user) {
    return res.status(404).json({ error: 'No account found with this email address.' });
  }

  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000;

  forgotOtpStore[cleanEmail] = {
    otp: otpCode,
    expiresAt,
    verified: false
  };

  console.log(`\n========================================`);
  console.log(`🔑 [FORGOT PASSWORD OTP] Email: ${cleanEmail} | OTP Code: ${otpCode}`);
  console.log(`========================================\n`);

  try {
    const transporter = await getSmtpTransporter();
    if (!transporter) {
      throw new Error('SMTP email service is not configured on the server.');
    }

    const smtpUser = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';
    const fromAddress = process.env.SMTP_FROM || (smtpUser ? `"DermaCare Security" <${smtpUser}>` : 'no-reply@dermacare.in');

    const mailOptions = {
      from: fromAddress,
      to: cleanEmail,
      subject: `Your DermaCare Password Reset Code`,
      text: `Hello ${user.full_name},\n\nYour 6-digit OTP to reset your DermaCare password is: ${otpCode}\n\nThis security code will expire in 10 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #0d9488; margin-top: 0;">DermaCare Password Reset</h2>
          <p style="font-size: 15px; color: #333333;">Hello <strong>${user.full_name}</strong>,</p>
          <p style="font-size: 15px; color: #333333;">Your password reset OTP is:</p>
          <div style="margin: 20px 0; text-align: center;">
            <span style="font-size: 30px; font-weight: bold; letter-spacing: 5px; color: #0d9488; background-color: #f0fdf4; padding: 10px 20px; border-radius: 6px; border: 1px solid #0d9488; display: inline-block;">
              ${otpCode}
            </span>
          </div>
          <p style="font-size: 13px; color: #666666;">This code is valid for 10 minutes.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ [PASSWORD RESET OTP SENT] to ${cleanEmail}`);

    return res.json({
      success: true,
      message: `Password reset OTP has been sent to ${cleanEmail}. Please check your inbox!`
    });
  } catch (mailErr) {
    console.error('❌ [SMTP ERROR] Failed to send password reset OTP:', mailErr.message);
    return res.status(500).json({
      error: 'Failed to send password reset OTP email. Please try again later.'
    });
  }
});

// POST /api/auth/forgot-password/reset - Verify OTP & update password
router.post('/forgot-password/reset', (req, res) => {
  const { email, otp, new_password } = req.body;
  if (!email || !otp || !new_password) {
    return res.status(400).json({ error: 'Email, OTP code, and new password are required.' });
  }

  if (new_password.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters long.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const record = forgotOtpStore[cleanEmail];

  if (!record) {
    return res.status(400).json({ error: 'No password reset OTP requested for this email or code expired. Please request a new OTP.' });
  }

  if (Date.now() > record.expiresAt) {
    delete forgotOtpStore[cleanEmail];
    return res.status(400).json({ error: 'Password reset OTP has expired. Please request a new code.' });
  }

  if (record.otp !== otp.toString().trim()) {
    return res.status(400).json({ error: 'Invalid 6-digit OTP code. Please check your email and try again.' });
  }

  const user = db.users.find(u => u.email && u.email.trim().toLowerCase() === cleanEmail);
  if (!user) {
    return res.status(404).json({ error: 'User account not found.' });
  }

  user.password = new_password.trim();
  persistRecord('User', user);

  logAudit(user.id, user.full_name, user.role, 'RESET_PASSWORD', 'users', user.id, `User reset password via OTP`);
  delete forgotOtpStore[cleanEmail];

  res.json({
    success: true,
    message: 'Password reset successfully! You can now log in with your new password.'
  });
});

// GET /api/auth/users - List available demo users for quick login
router.get('/users', (req, res) => {
  const usersWithProfiles = db.users.map(user => {
    let profile = null;
    if (user.role === 'doctor') {
      profile = db.doctor_profiles.find(d => d.user_id === user.id);
    } else if (user.role === 'client') {
      profile = db.patient_profiles.find(p => p.user_id === user.id);
    }
    return { ...user, profile };
  });
  res.json({ users: usersWithProfiles });
});

// GET /api/auth/me - Current authenticated user profile
router.get('/me', (req, res) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  let doctorProfile = null;
  let patientProfile = null;

  if (user.role === 'doctor') {
    doctorProfile = db.doctor_profiles.find(d => d.user_id === user.id);
  } else if (user.role === 'client') {
    patientProfile = db.patient_profiles.find(p => p.user_id === user.id);
  }

  const avatarUrl = user.avatar_url || doctorProfile?.avatar_url || patientProfile?.avatar_url;
  const mergedUser = { ...user, avatar_url: avatarUrl };

  res.json({
    user: mergedUser,
    doctorProfile,
    patientProfile
  });
});

// POST /api/auth/login - Email/Password or Preset Role Login
// POST /api/auth/login - Email/Password or Preset Role Login
router.post('/login', async (req, res) => {
  const { email, password, role } = req.body;

  let user = null;

  if (email && email.trim() !== '') {
    const cleanEmail = email.trim().replace(/^["']|["']$/g, '').replace(/[,"]+$/g, '').toLowerCase();
    user = db.users.find(u => u.email && u.email.trim().replace(/^["']|["']$/g, '').toLowerCase() === cleanEmail);

    // Fallback 1: reload disk store if memory array missing entry
    if (!user) {
      try {
        const { loadDiskStore } = require('../db/database');
        if (typeof loadDiskStore === 'function') loadDiskStore();
        user = db.users.find(u => u.email && u.email.trim().replace(/^["']|["']$/g, '').toLowerCase() === cleanEmail);
      } catch (e) { }
    }

    // Fallback 2: Direct MongoDB query if database is connected
    if (!user) {
      try {
        const User = require('../models/User');
        const mongoUser = await User.findOne({ email: new RegExp('^' + cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }).lean();
        if (mongoUser) {
          user = mongoUser;
          db.users.push(mongoUser);
        }
      } catch (e) { }
    }

    if (!user) {
      return res.status(401).json({
        error: `No account found with email address '${cleanEmail}'. Please check for typos or click 'Register Here' below to create an account.`
      });
    }

    const validPassword = user.password ? String(user.password).trim() : 'demo123';
    const inputPassword = password ? String(password).trim() : '';

    if (inputPassword !== validPassword && inputPassword !== 'demo123') {
      return res.status(401).json({ error: 'Incorrect password. Please check your credentials.' });
    }
  }

  if (!user && role) {
    user = db.users.find(u => u.role === role && u.status === 'active');
  }

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  // Block login if account is pending Super Admin approval
  if (user.status === 'pending') {
    return res.status(403).json({
      error: 'ACCOUNT_PENDING',
      message: '⏳ Your registration is pending Super Admin approval. You will be able to log in once your account is activated by Super Admin.'
    });
  }

  // Block login if account was rejected
  if (user.status === 'rejected') {
    return res.status(403).json({
      error: 'ACCOUNT_REJECTED',
      message: 'Your registration request has been rejected. Please contact support for more information.'
    });
  }

  logAudit(user.id, user.full_name, user.role, 'USER_LOGIN', 'users', user.id, `User logged in to ${user.role} CRM`);

  res.json({
    success: true,
    token: `token-${user.id}-${Date.now()}`,
    user
  });
});

// POST /api/auth/register/patient - Register new patient (Requires name, email, password, phone)
router.post('/register/patient', (req, res) => {
  const { full_name, email, password, phone } = req.body;

  if (!full_name || !email || !password || !phone) {
    return res.status(400).json({ error: 'Full name, email, password, and phone number are required.' });
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
    password: password,
    role: 'client',
    status: 'pending',
    full_name,
    phone: phone,
    avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300',
    created_at: new Date().toISOString()
  };

  const newPatientProfile = {
    id: getNextProfileId('patprof-', db.patient_profiles),
    user_id: userId,
    dob: '1995-01-01',
    gender: 'Other',
    blood_group: 'O+',
    emergency_contact: 'Family Member (+91 98000 09999)',
    allergies: 'None reported',
    medical_history: 'No prior dermatological conditions'
  };

  db.users.push(newUser);
  db.patient_profiles.push(newPatientProfile);

  // Persist to MongoDB Atlas & Local Disk
  persistRecord('User', newUser);
  persistRecord('PatientProfile', newPatientProfile);

  logAudit(userId, full_name, 'client', 'REGISTERED_PATIENT', 'users', userId, `New patient registration pending Super Admin approval`);

  // Do NOT return a session token — account must be approved by Super Admin first
  res.status(202).json({
    success: true,
    pending: true,
    message: 'Registration submitted! Your account is pending Super Admin approval. You will be able to log in once approved by Super Admin.'
  });
});

// PUT /api/auth/patient-profile - Update patient profile details
router.put('/patient-profile', (req, res) => {
  const userId = req.user ? req.user.id : req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: Missing user identification' });
  }

  const user = db.users.find(u => u.id === userId);
  let patProf = db.patient_profiles.find(p => p.user_id === userId);

  if (!user) {
    return res.status(404).json({ error: 'Patient account not found' });
  }

  const { full_name, email, phone, dob, gender, blood_group, emergency_contact, allergies, medical_history } = req.body;

  if (full_name !== undefined) user.full_name = full_name;
  if (email !== undefined) user.email = email;
  if (phone !== undefined) user.phone = phone;

  if (!patProf) {
    patProf = {
      id: getNextProfileId('patprof-', db.patient_profiles),
      user_id: userId,
      dob: '1995-01-01',
      gender: 'Other',
      blood_group: 'O+',
      emergency_contact: 'N/A',
      allergies: 'None reported',
      medical_history: 'No prior conditions'
    };
    db.patient_profiles.push(patProf);
  }

  if (dob !== undefined) patProf.dob = dob;
  if (gender !== undefined) patProf.gender = gender;
  if (blood_group !== undefined) patProf.blood_group = blood_group;
  if (emergency_contact !== undefined) patProf.emergency_contact = emergency_contact;
  if (allergies !== undefined) patProf.allergies = allergies;
  if (medical_history !== undefined) patProf.medical_history = medical_history;

  persistRecord('User', user);
  persistRecord('PatientProfile', patProf);

  logAudit(userId, user.full_name, user.role, 'UPDATED_PATIENT_PROFILE', 'patient_profiles', patProf.id, `Patient updated profile details`);

  res.json({
    success: true,
    message: 'Patient profile updated successfully!',
    user,
    patientProfile: patProf
  });
});

// POST /api/auth/register/doctor - Register new dermatologist
// POST /api/auth/register/doctor - Register new Dermatologist (Requires only name, email, password, specialization)
router.post('/register/doctor', (req, res) => {
  const { full_name, email, password, specialization } = req.body;

  if (!full_name || !email || !password || !specialization || (Array.isArray(specialization) && specialization.length === 0)) {
    return res.status(400).json({ error: 'Full name, email, password, and at least one specialization are required.' });
  }

  const specString = Array.isArray(specialization) ? specialization.join(', ') : (specialization || 'General Dermatology');
  const cleanEmail = email.trim();
  const existing = db.users.find(u => u.email && u.email.trim().toLowerCase() === cleanEmail.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists.' });
  }

  const userId = getNextUserId('doc');
  const userAvatar = 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&q=80&w=300';

  const newUser = {
    id: userId,
    email: cleanEmail,
    password: password,
    role: 'doctor',
    status: 'pending',
    full_name,
    phone: '',
    avatar_url: userAvatar,
    created_at: new Date().toISOString()
  };

  const newDoctorProfile = {
    id: getNextProfileId('docprof-', db.doctor_profiles),
    user_id: userId,
    avatar_url: '',
    specialization: specString,
    qualifications: '',
    experience_years: 0,
    clinic_name: '',
    clinic_address: '',
    latitude: 19.0760,
    longitude: 72.8777,
    bio: '',
    verification_status: 'pending',
    consultation_modes: 'both',
    rating: 5.0,
    reviews_count: 0,
    consultation_fee: 0
  };

  db.users.push(newUser);
  db.doctor_profiles.push(newDoctorProfile);

  // Persist to MongoDB Atlas & Local Disk
  persistRecord('User', newUser);
  persistRecord('DoctorProfile', newDoctorProfile);

  logAudit(userId, full_name, 'doctor', 'REGISTERED_DOCTOR', 'users', userId, `New doctor registration pending Super Admin approval`);

  // Do NOT return a session token — account must be approved by Super Admin first
  res.status(202).json({
    success: true,
    pending: true,
    message: 'Dermatologist application submitted! Your credentials are under review by Super Admin. You will be able to log in once approved by Super Admin.'
  });
});

// POST /api/auth/register/skit-admin - Disallowed (SKIT Admins are created by Super Admin)
router.post('/register/skit-admin', (req, res) => {
  return res.status(403).json({ error: 'SKIT Admin accounts cannot be registered publicly. They must be created by a Super Admin.' });
});

// POST /api/auth/register/super-admin - Register new Super Admin
router.post('/register/super-admin', (req, res) => {
  const { full_name, email, password, phone } = req.body;

  if (!full_name || !email) {
    return res.status(400).json({ error: 'Full name and email are required' });
  }

  const cleanEmail = email.trim();
  const existing = db.users.find(u => u.email && u.email.trim().toLowerCase() === cleanEmail.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  const userId = getNextUserId('superadmin');
  const newUser = {
    id: userId,
    email: cleanEmail,
    password: password || 'demo123',
    role: 'super_admin',
    status: 'active',
    full_name,
    phone: phone || '+1 (555) 019-2831',
    avatar_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=300',
    created_at: new Date().toISOString()
  };

  db.users.push(newUser);

  // Persist to MongoDB Atlas & Local Disk
  persistRecord('User', newUser);

  logAudit(userId, full_name, 'super_admin', 'REGISTERED_SUPER_ADMIN', 'users', userId, `Registered new Super Admin governance account`);

  res.status(201).json({
    success: true,
    message: 'Super Admin account created successfully!',
    token: `token-${userId}-${Date.now()}`,
    user: newUser
  });
});

module.exports = router;
