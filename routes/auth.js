// ═══════════════════════════════════════════════════════════════════════════════
// AUTH HELPERS — GWS Manager
// Google API client factories + error handler
// ═══════════════════════════════════════════════════════════════════════════════

const { google } = require('googleapis');
const fs         = require('fs');
const { KEY_FILE, ADMIN_EMAIL } = require('../config');

// Auth untuk Admin SDK (User, Group, OrgUnit)
function getAdminClient() {
  if (!fs.existsSync(KEY_FILE)) {
    throw new Error(`File service account tidak ditemukan: ${KEY_FILE}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: [
      'https://www.googleapis.com/auth/admin.directory.user',
      'https://www.googleapis.com/auth/admin.directory.orgunit',
      'https://www.googleapis.com/auth/admin.directory.group',
    ],
    clientOptions: { subject: ADMIN_EMAIL },
  });
  return google.admin({ version: 'directory_v1', auth });
}

// Auth impersonated — untuk Classroom, Dashboard, DataTransfer
async function getImpersonatedClient(scopes) {
  if (!fs.existsSync(KEY_FILE)) {
    throw new Error(`File service account tidak ditemukan: ${KEY_FILE}`);
  }
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes });
  const client = await auth.getClient();
  client.subject = ADMIN_EMAIL;
  return client;
}

async function getClassroomClient() {
  const client = await getImpersonatedClient([
    'https://www.googleapis.com/auth/classroom.courses',
    'https://www.googleapis.com/auth/classroom.rosters',
    'https://www.googleapis.com/auth/classroom.coursework.students',
    'https://www.googleapis.com/auth/classroom.announcements',
    'https://www.googleapis.com/auth/classroom.profile.emails',
    'https://www.googleapis.com/auth/classroom.profile.photos',
    'https://www.googleapis.com/auth/admin.directory.user',
  ]);
  return google.classroom({ version: 'v1', auth: client });
}

async function getDirForDashboard() {
  const client = await getImpersonatedClient([
    'https://www.googleapis.com/auth/admin.directory.user',
    'https://www.googleapis.com/auth/admin.directory.orgunit',
  ]);
  return google.admin({ version: 'directory_v1', auth: client });
}

async function getClassroomForDashboard() {
  const client = await getImpersonatedClient([
    'https://www.googleapis.com/auth/classroom.courses',
  ]);
  return google.classroom({ version: 'v1', auth: client });
}

async function getDataTransferClient() {
  const client = await getImpersonatedClient([
    'https://www.googleapis.com/auth/admin.datatransfer',
  ]);
  return google.admin({ version: 'datatransfer_v1', auth: client });
}

function handleError(res, err) {
  console.error('[ERROR]', err.message || err);
  const status  = err.code || 500;
  const message = err.errors?.[0]?.message || err.message || 'Terjadi kesalahan pada server';
  res.status(typeof status === 'number' ? status : 500).json({ error: message });
}

module.exports = {
  getAdminClient,
  getImpersonatedClient,
  getClassroomClient,
  getDirForDashboard,
  getClassroomForDashboard,
  getDataTransferClient,
  handleError,
};
