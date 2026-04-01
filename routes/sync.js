// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: SYNC — Sinkronisasi user & OU dari Google Workspace ke SQLite cache
// ═══════════════════════════════════════════════════════════════════════════════

const syncDb = require('../db/sync');
const { getAdminClient, handleError } = require('../helpers/auth');
const { DOMAIN } = require('../config');

// Flag untuk cegah double sync bersamaan
let _syncRunning = false;

// Helper: SQLite-compatible local datetime string
function sqliteLocalNow() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0') + ' ' +
    String(d.getHours()).padStart(2,'0') + ':' +
    String(d.getMinutes()).padStart(2,'0') + ':' +
    String(d.getSeconds()).padStart(2,'0');
}

async function syncUsers(admin) {
  const start = Date.now();
  const syncMark = sqliteLocalNow();
  let total = 0;

  // Tidak clear cache — upsert in-place, hapus yang stale setelah selesai
  let pageToken = null;
  do {
    const params = {
      domain: DOMAIN, maxResults: 500,
      orderBy: 'email', projection: 'basic',
    };
    if (pageToken) params.pageToken = pageToken;
    const result  = await admin.users.list(params);
    const users   = result.data.users || [];
    if (users.length) {
      syncDb.upsertUsers(users);
      total += users.length;
    }
    pageToken = result.data.nextPageToken || null;
  } while (pageToken);

  // Hapus user yang tidak ada lagi di GWS (last_sync masih lama)
  syncDb.deleteStaleUsers(syncMark);

  const ms = Date.now() - start;
  syncDb.logSync('users', 'success', total, ms, `${total} user disinkronkan dalam ${ms}ms`);
  return { total, ms };
}

async function syncOUs(admin) {
  const start = Date.now();
  const syncMark = sqliteLocalNow();
  let total = 0;

  // Tidak clear cache — upsert in-place, hapus yang stale setelah selesai
  const result = await admin.orgunits.list({ customerId: 'my_customer', type: 'all' });
  const ous    = result.data.organizationUnits || [];
  if (ous.length) {
    syncDb.upsertOUs(ous);
    total = ous.length;
  }

  // Hapus OU yang tidak ada lagi di GWS
  syncDb.deleteStaleOUs(syncMark);

  const ms = Date.now() - start;
  syncDb.logSync('orgunits', 'success', total, ms, `${total} org unit disinkronkan`);
  return { total, ms };
}

module.exports = function(app) {

  // GET /api/sync/status — info cache + last sync
  app.get('/api/sync/status', (req, res) => {
    try {
      res.json({ success: true, data: syncDb.getSyncStatus(), running: _syncRunning });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/sync/logs — riwayat sync
  app.get('/api/sync/logs', (req, res) => {
    try {
      res.json({ success: true, data: syncDb.getSyncLogs(20) });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/sync/users — sync user saja
  app.post('/api/sync/users', async (req, res) => {
    if (_syncRunning) return res.status(409).json({ success: false, error: 'Sync sedang berjalan, harap tunggu...' });
    _syncRunning = true;
    try {
      const admin  = getAdminClient();
      const result = await syncUsers(admin);
      res.json({ success: true, ...result, message: `${result.total} user berhasil disinkronkan (${result.ms}ms)` });
    } catch(err) {
      syncDb.logSync('users', 'error', 0, 0, err.message);
      handleError(res, err);
    } finally { _syncRunning = false; }
  });

  // POST /api/sync/orgunits — sync OU saja
  app.post('/api/sync/orgunits', async (req, res) => {
    if (_syncRunning) return res.status(409).json({ success: false, error: 'Sync sedang berjalan, harap tunggu...' });
    _syncRunning = true;
    try {
      const admin  = getAdminClient();
      const result = await syncOUs(admin);
      res.json({ success: true, ...result, message: `${result.total} org unit berhasil disinkronkan (${result.ms}ms)` });
    } catch(err) {
      syncDb.logSync('orgunits', 'error', 0, 0, err.message);
      handleError(res, err);
    } finally { _syncRunning = false; }
  });

  // POST /api/sync/full — sync semua sekaligus
  app.post('/api/sync/full', async (req, res) => {
    if (_syncRunning) return res.status(409).json({ success: false, error: 'Sync sedang berjalan, harap tunggu...' });
    _syncRunning = true;
    const start = Date.now();
    try {
      const admin  = getAdminClient();
      const [rUsers, rOUs] = await Promise.all([syncUsers(admin), syncOUs(admin)]);
      const ms = Date.now() - start;
      syncDb.logSync('full', 'success', rUsers.total + rOUs.total, ms,
        `${rUsers.total} user + ${rOUs.total} OU (${ms}ms)`);
      res.json({
        success: true,
        totalUsers:    rUsers.total,
        totalOUs:      rOUs.total,
        durationMs:    ms,
        message:       `Sync selesai: ${rUsers.total} user + ${rOUs.total} OU dalam ${ms}ms`,
      });
    } catch(err) {
      syncDb.logSync('full', 'error', 0, 0, err.message);
      handleError(res, err);
    } finally { _syncRunning = false; }
  });

  // GET /api/cache/users — ambil user dari cache
  app.get('/api/cache/users', (req, res) => {
    try {
      const { orgUnit, search, suspended } = req.query;
      const users = syncDb.getAllCachedUsers({
        orgUnit,
        search,
        suspended: suspended === 'true',
      });
      // Format sama seperti Google API agar kompatibel
      const data = users.map(u => ({
        primaryEmail:  u.email,
        name:          { fullName: u.full_name, givenName: u.given_name, familyName: u.family_name },
        orgUnitPath:   u.org_unit_path,
        suspended:     u.is_suspended === 1,
        archived:      u.is_archived  === 1,
        thumbnailPhotoUrl: u.thumbnail_url || null,
      }));
      res.json({ success: true, users: data, total: data.length, fromCache: true });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/cache/orgunits — daftar OU dari cache
  app.get('/api/cache/orgunits', (req, res) => {
    try {
      const ous  = syncDb.getAllCachedOUs();
      const data = ous.map(o => ({
        orgUnitPath:       o.ou_path,
        name:              o.ou_name,
        parentOrgUnitPath: o.parent_path,
        description:       o.description,
      }));
      res.json({ success: true, data, total: data.length, fromCache: true });
    } catch(err) { handleError(res, err); }
  });

};