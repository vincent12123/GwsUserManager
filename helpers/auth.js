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
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
  ]);
  return google.classroom({ version: 'v1', auth: client });
}

// Impersonate user tertentu (misal: teacher pemilik kelas)
async function getClassroomClientAs(email) {
  if (!fs.existsSync(KEY_FILE)) {
    throw new Error(`File service account tidak ditemukan: ${KEY_FILE}`);
  }
  const auth   = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: [
      'https://www.googleapis.com/auth/classroom.courses',
      'https://www.googleapis.com/auth/classroom.rosters',
      'https://www.googleapis.com/auth/classroom.coursework.students',
      'https://www.googleapis.com/auth/classroom.announcements',
      'https://www.googleapis.com/auth/classroom.profile.emails',
      'https://www.googleapis.com/auth/classroom.profile.photos',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  const client = await auth.getClient();
  client.subject = email;
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

async function getMobileDeviceClient() {
  const client = await getImpersonatedClient([
    'https://www.googleapis.com/auth/admin.directory.device.mobile',
    'https://www.googleapis.com/auth/admin.directory.device.mobile.action',
  ]);
  return google.admin({ version: 'directory_v1', auth: client });
}

async function getReportsClient() {
  const client = await getImpersonatedClient([
    'https://www.googleapis.com/auth/admin.reports.audit.readonly',
  ]);
  return google.admin({ version: 'reports_v1', auth: client });
}

async function getDriveClient() {
  const client = await getImpersonatedClient([
    'https://www.googleapis.com/auth/drive',
  ]);
  return google.drive({ version: 'v3', auth: client });
}

async function getDriveClientAs(email) {
  if (!fs.existsSync(KEY_FILE)) {
    throw new Error(`File service account tidak ditemukan: ${KEY_FILE}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const client = await auth.getClient();
  client.subject = email;
  return google.drive({ version: 'v3', auth: client });
}

async function getDriveReadonlyAs(email) {
  if (!fs.existsSync(KEY_FILE)) {
    throw new Error(`File service account tidak ditemukan: ${KEY_FILE}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: [
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });
  const client = await auth.getClient();
  client.subject = email; // impersonate user target (silent)
  return google.drive({ version: 'v3', auth: client });
}

async function getAdminDirectoryAs(email) {
  if (!fs.existsSync(KEY_FILE)) {
    throw new Error(`File service account tidak ditemukan: ${KEY_FILE}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: [
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
    ],
  });
  const client = await auth.getClient();
  client.subject = ADMIN_EMAIL; // admin, bukan target
  return google.admin({ version: 'directory_v1', auth: client });
}


async function getSheetsClient() {
  const client = await getImpersonatedClient([
    'https://www.googleapis.com/auth/spreadsheets',
  ]);
  return google.sheets({ version: 'v4', auth: client });
}

// Reports API + Directory API dalam satu auth (untuk storage & resource usage)
async function getReportsAndDirectoryClients() {
  // Reports pakai scope audit readonly
  const reportsClient = await getImpersonatedClient([
    'https://www.googleapis.com/auth/admin.reports.audit.readonly',
    'https://www.googleapis.com/auth/admin.reports.usage.readonly',
  ]);
  // Directory pakai scope yang sudah pasti ada di DWD
  const dirClient = await getImpersonatedClient([
    'https://www.googleapis.com/auth/admin.directory.user',
    'https://www.googleapis.com/auth/admin.directory.user.readonly',
  ]);
  return {
    reports:   google.admin({ version: 'reports_v1',   auth: reportsClient }),
    directory: google.admin({ version: 'directory_v1', auth: dirClient }),
  };
}

// Forms API — impersonate sebagai user tertentu (guru pembuat form)
async function getFormsClientAs(email) {
  if (!fs.existsSync(KEY_FILE)) {
    throw new Error(`File service account tidak ditemukan: ${KEY_FILE}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: [
      'https://www.googleapis.com/auth/forms.body',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  const client = await auth.getClient();
  client.subject = email;
  return google.forms({ version: 'v1', auth: client });
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
  getClassroomClientAs,
  getFormsClientAs,
  getMobileDeviceClient,
  getReportsClient,
  getReportsAndDirectoryClients,
  getDirForDashboard,
  getClassroomForDashboard,
  getDataTransferClient,
  getDriveClient,
  getDriveClientAs,
  getDriveReadonlyAs,
  getAdminDirectoryAs,
  getSheetsClient,
  handleError,
};