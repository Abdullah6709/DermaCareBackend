// Unified Database Engine (In-Memory + MongoDB Atlas Persistence)
const mongoose = require('mongoose');
const seed = require('../data/seedData');

const fs = require('fs');
const path = require('path');
const storeFilePath = path.join(__dirname, '../data/persistedStore.json');

// In-Memory Database Store (Full feature complete state engine)
const db = {
  users: [...seed.initialUsers],
  doctor_profiles: [...seed.initialDoctorProfiles],
  patient_profiles: [...seed.initialPatientProfiles],
  slots: [...seed.initialSlots],
  appointments: [...seed.initialAppointments],
  condition_submissions: [...seed.initialConditionSubmissions],
  consultations: [...seed.initialConsultations],
  prescriptions: [...seed.initialPrescriptions],
  notifications: [...seed.initialNotifications],
  audit_logs: [...seed.initialAuditLogs]
};

// Helper: Load disk store on startup
function loadDiskStore() {
  try {
    if (fs.existsSync(storeFilePath)) {
      const data = JSON.parse(fs.readFileSync(storeFilePath, 'utf8'));
      if (data && typeof data === 'object') {
        Object.keys(data).forEach(key => {
          if (Array.isArray(data[key])) {
            db[key] = data[key];
          }
        });
      }
    }
  } catch (err) {
    console.warn('[Disk Store Warning] Could not load persistedStore.json:', err.message);
  }
}

// Load persisted disk store immediately
loadDiskStore();
saveDiskStore();

let saveTimeout = null;

// Helper: Save disk store asynchronously with debouncing (non-blocking)
function saveDiskStore() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    fs.promises.writeFile(storeFilePath, JSON.stringify(db), 'utf8')
      .catch(err => {
        console.warn('[Disk Store Warning] Could not save persistedStore.json asynchronously:', err.message);
      });
  }, 500);
}

// Helper: Asynchronous persistence to MongoDB Atlas & Local Disk
async function persistRecord(modelName, documentData) {
  try {
    saveDiskStore();
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const Model = mongoose.model(modelName);
      if (Model && documentData) {
        const queryId = documentData.id ? { id: documentData.id } : { _id: documentData._id };
        await Model.updateOne(queryId, documentData, { upsert: true });
      }
    }
  } catch (err) {
    console.warn(`[MongoDB Persist Warning] ${modelName} sync skipped:`, err.message);
  }
}

// Helper: Asynchronous deletion from MongoDB Atlas & Local Disk
async function deleteRecord(modelName, documentId) {
  try {
    saveDiskStore();
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const Model = mongoose.model(modelName);
      if (Model && documentId) {
        await Model.deleteOne({ $or: [{ id: documentId }, { _id: documentId }] });
      }
    }
  } catch (err) {
    console.warn(`[MongoDB Delete Warning] ${modelName} delete skipped:`, err.message);
  }
}

// Helper: Log audit trail
function logAudit(actorId, actorName, actorRole, action, targetEntity, targetId, details, ipAddress = '127.0.0.1') {
  const newAudit = {
    id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor_id: actorId,
    actor_name: actorName || 'System User',
    actor_role: actorRole || 'system',
    action,
    target_entity: targetEntity,
    target_id: targetId,
    details,
    ip_address: ipAddress,
    timestamp: new Date().toISOString()
  };
  db.audit_logs.unshift(newAudit);
  persistRecord('AuditLog', newAudit);

  try {
    const { broadcastEvent } = require('../config/socket');
    broadcastEvent('admin_live_pulse', newAudit);
  } catch (err) {
    // Socket initialization guard
  }

  return newAudit;
}

// Distance Calculation Helper (Haversine formula in KM)
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

// Helper: Get next sequential User ID for a role (e.g. user-patient-3, user-doc-4, etc.)
function getNextUserId(rolePrefix) {
  const prefix = `user-${rolePrefix}-`;
  let maxId = 0;
  db.users.forEach(u => {
    if (u.id && u.id.startsWith(prefix)) {
      const numPart = parseInt(u.id.substring(prefix.length), 10);
      if (!isNaN(numPart) && numPart > maxId) {
        maxId = numPart;
      }
    }
  });
  return `${prefix}${maxId + 1}`;
}

// Helper: Get next sequential Profile ID (e.g. patprof-3, docprof-4, etc.)
function getNextProfileId(profilePrefix, list) {
  let maxId = 0;
  list.forEach(p => {
    if (p.id && p.id.startsWith(profilePrefix)) {
      const numPart = parseInt(p.id.substring(profilePrefix.length), 10);
      if (!isNaN(numPart) && numPart > maxId) {
        maxId = numPart;
      }
    }
  });
  return `${profilePrefix}${maxId + 1}`;
}

module.exports = {
  db,
  persistRecord,
  deleteRecord,
  saveDiskStore,
  logAudit,
  calculateDistanceKm,
  getNextUserId,
  getNextProfileId
};
