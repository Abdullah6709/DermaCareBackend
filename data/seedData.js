const initialUsers = [
  {
    id: 'user-superadmin-1',
    email: 'sajidabdullah735@gmail.com',
    password: 'Sajid@2001',
    role: 'super_admin',
    status: 'active',
    full_name: 'Sajid Abdullah',
    phone: '+91 9876543210',
    avatar_url: '',
    created_at: new Date().toISOString()
  }
];
const initialDoctorProfiles = [];
const initialPatientProfiles = [];
const initialSlots = [];
const initialAppointments = [];
const initialConditionSubmissions = [];
const initialConsultations = [];
const initialPrescriptions = [];
const initialNotifications = [];
const initialAuditLogs = [];

module.exports = {
  initialUsers,
  initialDoctorProfiles,
  initialPatientProfiles,
  initialSlots,
  initialAppointments,
  initialConditionSubmissions,
  initialConsultations,
  initialPrescriptions,
  initialNotifications,
  initialAuditLogs
};
