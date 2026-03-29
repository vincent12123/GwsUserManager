// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: GROUPS — /api/groups/*
// ═══════════════════════════════════════════════════════════════════════════════

const { getAdminClient, handleError } = require('../helpers/auth');
const { DOMAIN } = require('../config');

module.exports = function(app) {

  // GET /api/groups
  app.get('/api/groups', async (req, res) => {
    try {
      const admin = getAdminClient();
      let allGroups = [], nextToken;
      do {
        const params = { domain: DOMAIN, maxResults: 200 };
        if (nextToken) params.pageToken = nextToken;
        const result = await admin.groups.list(params);
        allGroups = allGroups.concat(result.data.groups || []);
        nextToken = result.data.nextPageToken;
      } while (nextToken);
      res.json({ groups: allGroups, total: allGroups.length });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/groups
  app.post('/api/groups', async (req, res) => {
    try {
      const admin = getAdminClient();
      const { name, email, description } = req.body;
      if (!name || !email) return res.status(400).json({ error: 'name dan email wajib diisi' });
      const finalEmail = email.includes('@') ? email : `${email}@${DOMAIN}`;
      const result = await admin.groups.insert({
        requestBody: { name, email: finalEmail, description: description || '' },
      });
      res.status(201).json({ success: true, message: `Group ${finalEmail} berhasil dibuat`, group: result.data });
    } catch(err) { handleError(res, err); }
  });

  // PUT /api/groups/:email
  app.put('/api/groups/:email', async (req, res) => {
    try {
      const admin  = getAdminClient();
      const result = await admin.groups.update({
        groupKey: req.params.email,
        requestBody: { name: req.body.name, description: req.body.description },
      });
      res.json({ success: true, message: 'Group berhasil diupdate', group: result.data });
    } catch(err) { handleError(res, err); }
  });

  // DELETE /api/groups/:email
  app.delete('/api/groups/:email', async (req, res) => {
    try {
      const admin = getAdminClient();
      await admin.groups.delete({ groupKey: req.params.email });
      res.json({ success: true, message: `Group ${req.params.email} berhasil dihapus` });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/groups/:email/members
  app.get('/api/groups/:email/members', async (req, res) => {
    try {
      const admin  = getAdminClient();
      const result = await admin.members.list({ groupKey: req.params.email, maxResults: 500 });
      res.json({ members: result.data.members || [], total: result.data.members?.length || 0 });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/groups/:email/members
  app.post('/api/groups/:email/members', async (req, res) => {
    try {
      const admin = getAdminClient();
      const { memberEmail, role = 'MEMBER' } = req.body;
      if (!memberEmail) return res.status(400).json({ error: 'memberEmail wajib diisi' });
      await admin.members.insert({ groupKey: req.params.email, requestBody: { email: memberEmail, role } });
      res.status(201).json({ success: true, message: `${memberEmail} berhasil ditambahkan ke group` });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/groups/:email/members/bulk
  app.post('/api/groups/:email/members/bulk', async (req, res) => {
    try {
      const admin = getAdminClient();
      const { members } = req.body;
      if (!members || !members.length) return res.status(400).json({ error: 'members tidak boleh kosong' });
      const results = { success: [], failed: [] };
      for (const memberEmail of members) {
        try {
          await admin.members.insert({ groupKey: req.params.email, requestBody: { email: memberEmail, role: 'MEMBER' } });
          results.success.push(memberEmail);
        } catch(e) {
          results.failed.push({ email: memberEmail, error: e.errors?.[0]?.message || e.message });
        }
        await new Promise(r => setTimeout(r, 150));
      }
      res.json({ success: true, totalSuccess: results.success.length, totalFailed: results.failed.length, results });
    } catch(err) { handleError(res, err); }
  });

  // DELETE /api/groups/:email/members/:memberEmail
  app.delete('/api/groups/:email/members/:memberEmail', async (req, res) => {
    try {
      const admin = getAdminClient();
      await admin.members.delete({ groupKey: req.params.email, memberKey: req.params.memberEmail });
      res.json({ success: true, message: `${req.params.memberEmail} berhasil dihapus dari group` });
    } catch(err) { handleError(res, err); }
  });

};
