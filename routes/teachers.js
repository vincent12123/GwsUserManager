// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: TEACHERS — /api/teachers/*
// Nonaktifkan Guru: Suspend + Transfer Drive + Archive
// ═══════════════════════════════════════════════════════════════════════════════

const { getAdminClient, getDataTransferClient, handleError } = require('../helpers/auth');
const { auditLog } = require('../db/audit');

const DRIVE_APP_ID    = '55656082996'; // Drive and Docs
const CALENDAR_APP_ID = '435070579839'; // Calendar

module.exports = function(app) {

  // POST /api/teachers/deactivate
  app.post('/api/teachers/deactivate', async (req, res) => {
    const { teacherEmail, driveTargetEmail, transferCalendar } = req.body;
    if (!teacherEmail || !driveTargetEmail) {
      return res.status(400).json({ error: 'teacherEmail dan driveTargetEmail wajib diisi' });
    }

    const log = [];

    try {
      const admin = getAdminClient();
      const dt    = await getDataTransferClient();

      // ── Step 1: Suspend akun ──────────────────────────────────────────────
      try {
        await admin.users.update({
          userKey: teacherEmail,
          requestBody: { suspended: true }
        });
        log.push({ step: 'Suspend akun', status: 'ok', msg: `${teacherEmail} berhasil di-suspend` });
      } catch(e) {
        log.push({ step: 'Suspend akun', status: 'error', msg: e.message });
      }

      // ── Step 2: Transfer Drive ────────────────────────────────────────────
      try {
        const [teacherInfo, targetInfo] = await Promise.all([
          admin.users.get({ userKey: teacherEmail }),
          admin.users.get({ userKey: driveTargetEmail }),
        ]);
        const oldOwnerUserId = teacherInfo.data.id;
        const newOwnerUserId = targetInfo.data.id;

        const applicationDataTransfers = [
          {
            applicationId: DRIVE_APP_ID,
            applicationTransferParams: [
              { key: 'PRIVACY_LEVEL', value: ['PRIVATE', 'SHARED'] }
            ]
          }
        ];

        if (transferCalendar) {
          applicationDataTransfers.push({
            applicationId: CALENDAR_APP_ID,
            applicationTransferParams: [
              { key: 'RELEASE_RESOURCES', value: ['TRUE'] }
            ]
          });
        }

        const transfer = await dt.transfers.insert({
          requestBody: { oldOwnerUserId, newOwnerUserId, applicationDataTransfers }
        });

        const transferId = transfer.data.id;
        log.push({
          step: 'Transfer Drive',
          status: 'ok',
          msg: `Transfer dimulai (ID: ${transferId}) — proses berjalan di background Google`,
          transferId
        });
        auditLog('Transfer Drive', teacherEmail,
          `Drive ditransfer ke ${driveTargetEmail} (transferId: ${transferId})`);
      } catch(e) {
        log.push({ step: 'Transfer Drive', status: 'error', msg: e.message });
        auditLog('Transfer Drive', teacherEmail, e.message, 'error');
      }

      // ── Step 3: Archive akun ──────────────────────────────────────────────
      try {
        await admin.users.update({
          userKey: teacherEmail,
          requestBody: { archived: true }
        });
        log.push({ step: 'Archive akun', status: 'ok', msg: `${teacherEmail} berhasil di-archive` });
      } catch(e) {
        log.push({ step: 'Archive akun', status: 'error', msg: e.message });
      }

      const allOk = log.every(l => l.status === 'ok');
      auditLog('Nonaktifkan Guru', teacherEmail,
        `Target Drive: ${driveTargetEmail} | ${allOk ? 'Semua langkah sukses' : 'Ada langkah yang gagal'}`,
        allOk ? 'success' : 'warning');

      res.json({ success: allOk, log });

    } catch(err) {
      handleError(res, err);
    }
  });

  // GET /api/teachers/transfer-status/:transferId — cek status transfer
  app.get('/api/teachers/transfer-status/:transferId', async (req, res) => {
    try {
      const dt = await getDataTransferClient();
      const r  = await dt.transfers.get({ dataTransferId: req.params.transferId });
      res.json({ success: true, status: r.data.overallTransferStatusCode, data: r.data });
    } catch(err) { handleError(res, err); }
  });

};
