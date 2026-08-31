const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const { connectDB } = require('./config/db');
const { authenticateUser } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const doctorRoutes = require('./routes/doctors');
const appointmentRoutes = require('./routes/appointments');
const conditionRoutes = require('./routes/conditionSubmissions');
const consultationRoutes = require('./routes/consultations');
const prescriptionRoutes = require('./routes/prescriptions');
const notificationRoutes = require('./routes/notifications');
const auditLogRoutes = require('./routes/auditLogs');
const adminRoutes = require('./routes/admin');
const reviewRoutes = require('./routes/reviews');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS & JSON Parsing
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Attach authentication middleware
app.use(authenticateUser);

// Mount API Routes
app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/condition-submissions', conditionRoutes);
app.use('/api/consultations', consultationRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reviews', reviewRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    platform: 'Dermatology CRM & Teleconsultation API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Connect to MongoDB Atlas (or local MongoDB)
connectDB();

const http = require('http');
const { initSocket } = require('./config/socket');

const server = http.createServer(app);
initSocket(server);

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🩺 Dermatology CRM Backend + WebSockets running on port ${PORT}`);
  console.log(`🌐 API Endpoint: http://localhost:${PORT}/api`);
  console.log(`⚡ Socket.io Endpoint: ws://localhost:${PORT}`);
  console.log(`====================================================`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} is already in use by another process.`);
    console.error(`👉 To fix this on Windows PowerShell:`);
    console.error(`   1. Find the PID: netstat -ano | findstr :${PORT}`);
    console.error(`   2. Kill the process: Stop-Process -Id <PID> -Force\n`);
    process.exit(1);
  } else {
    throw err;
  }
});

