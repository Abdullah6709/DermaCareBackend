const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

const compression = require('compression');

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

// Enable HTTP Response Compression (Gzip / Brotli)
app.use(compression());

// Enable CORS with Preflight Cache (24 hours = 86400 seconds)
app.use(cors({
  origin: true,
  credentials: true,
  maxAge: 86400
}));

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

// Root landing page
app.get('/', (req, res) => {
  res.send(`
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
      <h2 style="color: #0d9488; margin-top: 0;">🩺 DermaCare Backend API Server</h2>
      <p style="color: #475569; font-size: 16px;">The Express + Socket.io backend server is running successfully on port ${PORT}.</p>
      <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; border-left: 4px solid #0d9488; margin: 20px 0;">
        <p style="margin: 5px 0;"><strong>Frontend UI App:</strong> <a href="http://localhost:3000" target="_blank" style="color: #2563eb;">http://localhost:3000</a></p>
        <p style="margin: 5px 0;"><strong>API Health Endpoint:</strong> <a href="/api/health" style="color: #2563eb;">/api/health</a></p>
      </div>
      <p style="font-size: 13px; color: #94a3b8;">DermaCare Healthcare Platform v1.0.0</p>
    </div>
  `);
});

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

server.listen(PORT, '0.0.0.0', () => {
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

