// ═══════════════════════════════════════════════════════════════════════════════ 
// ROUTES: USERS & ORG UNITS
// GET/POST/PUT/PATCH/DELETE /api/users
// GET /api/orgunits
// ═══════════════════════════════════════════════════════════════════════════════

const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { getAdminClient, handleError } = require('../helpers/auth');
const { auditLog } = require('../db/audit');
const { DOMAIN, DEFAULT_PASSWORD } = require('../config');

const upload = multer({ storage: multer.memoryStorage() });

// ── Helper: Auto-create org unit beserta semua parent-nya ────────────────────
let ouCache = null;

async function loadOUCache(admin) {
  if (ouCache) return ouCache;
  const r = await admin.orgunits.list({ customerId: 'my_customer', type: 'all' });
  const list = r.data.organizationUnits || [];
  ouCache = new Set(list.map(o => o.orgUnitPath));
  ouCache.add('/');
  return ouCache;
}

async function ensureOrgUnit(admin, ouPath) {
  if (!ouPath || ouPath === '/') return;

  const cache = await loadOUCache(admin);
  if (cache.has(ouPath)) return;

  const parts = ouPath.split('/').filter(Boolean);
  let currentPath = '';
  for (const part of parts) {
    const parentPath = currentPath || '/';
    currentPath += '/' + part;
    if (!cache.has(currentPath)) {
      try {
        await admin.orgunits.insert({
          customerId: 'my_customer',
          requestBody: { name: part, parentOrgUnitPath: parentPath },
        });
        cache.add(currentPath);
        console.log(`[OU] Dibuat: ${currentPath}`);
      } catch(e) {
        if (e.errors?.[0]?.reason !== 'duplicate') {
          console.warn(`[OU] Gagal buat ${currentPath}: ${e.message}`);
        }
        cache.add(currentPath);
      }
    }
  }
}

module.exports = function(app) {

  // GET /api/users
  app.get('/api/users', async (req, res) => {
    try {
      const admin = getAdminClient();
      const { query, pageToken, maxResults = 100, orderBy = 'email', orgUnit, fetchAll } = req.query;

      if (fetchAll === 'true') {
        let allUsers = [], nextToken = undefined;
        do {
          const params = { domain: DOMAIN, maxResults: 500, orderBy, projection: 'full' };
          if (query)     params.query = query;
          if (orgUnit)   params.query = `orgUnitPath=${orgUnit}`;
          if (nextToken) params.pageToken = nextToken;
          const result = await admin.users.list(params);
          allUsers  = allUsers.concat(result.data.users || []);
          nextToken = result.data.nextPageToken;
        } while (nextToken);
        return res.json({ users: allUsers, nextPageToken: null, total: allUsers.length });
      }

      const params = {
        domain: DOMAIN,
        maxResults: Math.min(parseInt(maxResults), 500),
        orderBy, projection: 'full',
      };
      if (query)     params.query = query;
      if (pageToken) params.pageToken = pageToken;
      if (orgUnit)   params.query = `orgUnitPath=${orgUnit}`;

      const result = await admin.users.list(params);
      res.json({
        users: result.data.users || [],
        nextPageToken: result.data.nextPageToken || null,
        total: result.data.users?.length || 0,
      });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/users/:email
  app.get('/api/users/:email', async (req, res) => {
    try {
      const admin  = getAdminClient();
      const result = await admin.users.get({ userKey: req.params.email, projection: 'full' });
      res.json(result.data);
    } catch(err) { handleError(res, err); }
  });

  // POST /api/users — tambah satu user
  app.post('/api/users', async (req, res) => {
    try {
      const admin = getAdminClient();
      const { firstName, lastName, email, password, orgUnit, role } = req.body;
      if (!firstName || !lastName || !email) {
        return res.status(400).json({ error: 'firstName, lastName, dan email wajib diisi' });
      }
      const finalEmail = email.includes('@') ? email : `${email}@${DOMAIN}`;
      const userBody = {
        name: { givenName: firstName, familyName: lastName },
        primaryEmail: finalEmail,
        password: password || DEFAULT_PASSWORD,
        changePasswordAtNextLogin: true,
      };
      if (orgUnit) userBody.orgUnitPath = orgUnit;
      const result = await admin.users.insert({ requestBody: userBody });
      if (role === 'admin') {
        await admin.users.makeAdmin({ userKey: finalEmail, requestBody: { status: true } });
      }
      res.status(201).json({ success: true, message: `User ${finalEmail} berhasil dibuat`, user: result.data });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/users/bulk — bulk create dari textarea
  app.post('/api/users/bulk', async (req, res) => {
    try {
      const admin = getAdminClient();
      const { users } = req.body;
      if (!users || !Array.isArray(users) || users.length === 0) {
        return res.status(400).json({ error: 'Array users tidak boleh kosong' });
      }

      ouCache = null;
      const results = { success: [], failed: [], ouCreated: [] };

      for (const u of users) {
        try {
          const finalEmail = u.email.includes('@') ? u.email : `${u.email}@${DOMAIN}`;
          const orgUnit    = u.orgUnit || '/';
          if (orgUnit !== '/') {
            const before = ouCache ? ouCache.size : 0;
            await ensureOrgUnit(admin, orgUnit);
            const after = ouCache ? ouCache.size : 0;
            if (after > before) results.ouCreated.push(orgUnit);
          }
          await admin.users.insert({
            requestBody: {
              name: { givenName: u.firstName, familyName: u.lastName },
              primaryEmail: finalEmail,
              password: u.password || DEFAULT_PASSWORD,
              changePasswordAtNextLogin: true,
              orgUnitPath: orgUnit,
            },
          });
          results.success.push(finalEmail);
        } catch(e) {
          results.failed.push({ email: u.email, error: e.errors?.[0]?.message || e.message });
        }
      }

      res.json({
        success: true,
        totalSuccess: results.success.length,
        totalFailed:  results.failed.length,
        ouCreated:    [...new Set(results.ouCreated)],
        results,
      });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/users/bulk-csv — bulk create dari file CSV
  app.post('/api/users/bulk-csv', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'File CSV tidak ditemukan' });
      const records = parse(req.file.buffer.toString('utf-8'), {
        columns: true, skip_empty_lines: true, trim: true,
      });
      const users = records.map(row => ({
        firstName: row.firstName || row.first_name || row['Nama Depan'] || '',
        lastName:  row.lastName  || row.last_name  || row['Nama Belakang'] || '',
        email:     row.email     || row.Email || '',
        orgUnit:   row.orgUnit   || row.org_unit || row['Unit'] || '/',
        password:  row.password  || '',
      })).filter(u => u.firstName && u.email);

      const admin = getAdminClient();
      ouCache = null;
      const results = { success: [], failed: [], ouCreated: [] };

      for (const u of users) {
        try {
          const finalEmail = u.email.includes('@') ? u.email : `${u.email}@${DOMAIN}`;
          const orgUnit    = u.orgUnit || '/';
          if (orgUnit !== '/') {
            const before = ouCache ? ouCache.size : 0;
            await ensureOrgUnit(admin, orgUnit);
            const after = ouCache ? ouCache.size : 0;
            if (after > before) results.ouCreated.push(orgUnit);
          }
          await admin.users.insert({
            requestBody: {
              name: { givenName: u.firstName, familyName: u.lastName },
              primaryEmail: finalEmail,
              password: u.password || DEFAULT_PASSWORD,
              changePasswordAtNextLogin: true,
              orgUnitPath: orgUnit,
            },
          });
          results.success.push(finalEmail);
        } catch(e) {
          results.failed.push({ email: u.email, error: e.errors?.[0]?.message || e.message });
        }
      }

      res.json({
        success: true,
        totalParsed:  users.length,
        totalSuccess: results.success.length,
        totalFailed:  results.failed.length,
        ouCreated:    [...new Set(results.ouCreated)],
        results,
      });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/users/license — archive / restore user
  app.post('/api/users/license', async (req, res) => {
    const { email, licenseType } = req.body;
    try {
      if (!email || !licenseType) {
        return res.status(400).json({ error: 'email dan licenseType wajib diisi' });
      }
      const admin = getAdminClient();

      if (licenseType === 'archived') {
        await admin.users.update({ userKey: email, requestBody: { archived: true } });
        auditLog('Ganti Lisensi (Archive)', email, 'Diubah ke Archived User');
      } else if (licenseType === 'active') {
        await admin.users.update({ userKey: email, requestBody: { archived: false, suspended: false } });
        auditLog('Ganti Lisensi (Restore)', email, 'Dikembalikan ke Education Fundamentals');
      } else if (licenseType === 'gmailonly') {
        return res.status(400).json({ success: false, error: 'Gmail Only belum didukung via API. Gunakan Admin Console.' });
      } else {
        return res.status(400).json({ error: `licenseType tidak dikenal: ${licenseType}` });
      }

      res.json({ success: true, message: `User ${email} berhasil diubah ke ${licenseType}` });
    } catch(err) {
      auditLog('Ganti Lisensi', email || '-', err.message, 'error');
      handleError(res, err);
    }
  });

  // PUT /api/users/:email — update user
  app.put('/api/users/:email', async (req, res) => {
    try {
      const admin = getAdminClient();
      const { firstName, lastName, newEmail, orgUnit, suspended, password } = req.body;
      const updateBody = {};
      if (firstName || lastName) {
        updateBody.name = {};
        if (firstName) updateBody.name.givenName  = firstName;
        if (lastName)  updateBody.name.familyName = lastName;
      }
      if (newEmail)  updateBody.primaryEmail = newEmail;
      if (orgUnit)   updateBody.orgUnitPath  = orgUnit;
      if (typeof suspended === 'boolean') updateBody.suspended = suspended;
      if (password)  { updateBody.password = password; updateBody.changePasswordAtNextLogin = true; }
      const result = await admin.users.update({ userKey: req.params.email, requestBody: updateBody });
      res.json({ success: true, message: 'User berhasil diupdate', user: result.data });
    } catch(err) { handleError(res, err); }
  });

  // PATCH /api/users/:email — toggle suspend
  app.patch('/api/users/:email', async (req, res) => {
    try {
      const admin  = getAdminClient();
      const result = await admin.users.update({ userKey: req.params.email, requestBody: req.body });
      res.json({ success: true, user: result.data });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/users/:email/suspend
  app.post('/api/users/:email/suspend', async (req, res) => {
    try {
      const admin = getAdminClient();
      await admin.users.update({ userKey: req.params.email, requestBody: { suspended: true } });
      res.json({ success: true, message: `User ${req.params.email} berhasil disuspend` });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/users/:email/restore
  app.post('/api/users/:email/restore', async (req, res) => {
    try {
      const admin = getAdminClient();
      await admin.users.update({ userKey: req.params.email, requestBody: { suspended: false } });
      res.json({ success: true, message: `User ${req.params.email} berhasil direstore` });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/users/:email/reset-password
  app.post('/api/users/:email/reset-password', async (req, res) => {
    try {
      const admin       = getAdminClient();
      const newPassword = req.body.password || DEFAULT_PASSWORD;
      await admin.users.update({
        userKey: req.params.email,
        requestBody: { password: newPassword, changePasswordAtNextLogin: true },
      });
      res.json({ success: true, message: `Password ${req.params.email} berhasil direset` });
    } catch(err) { handleError(res, err); }
  });

  // DELETE /api/users/:email
  app.delete('/api/users/:email', async (req, res) => {
    try {
      const admin = getAdminClient();
      await admin.users.delete({ userKey: req.params.email });
      auditLog('Hapus User', req.params.email, 'User dihapus permanen');
      res.json({ success: true, message: `User ${req.params.email} berhasil dihapus` });
    } catch(err) {
      auditLog('Hapus User', req.params.email, err.message, 'error');
      handleError(res, err);
    }
  });

  // GET /api/orgunits
  app.get('/api/orgunits', async (req, res) => {
    try {
      const admin  = getAdminClient();
      const result = await admin.orgunits.list({ customerId: 'my_customer', type: 'all' });
      res.json(result.data.organizationUnits || []);
    } catch(err) { handleError(res, err); }
  });

};
