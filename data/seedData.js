const initialUsers = [
  {
    id: 'user-superadmin-1',
    email: 'sajidabdullah735@gmail.com',
    password: 'Sajid@2001',
    role: 'super_admin',
    status: 'active',
    full_name: 'Sajid Abdullah',
    phone: '+91 9876543210',
    avatar_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=300',
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
