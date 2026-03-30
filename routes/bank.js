// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: BANK SOAL
// ═══════════════════════════════════════════════════════════════════════════════

const bankDb = require('../db/bank');
const cbtDb  = require('../db/cbt');
const { handleError } = require('../helpers/auth');
const { fixLatexInSoal } = require('../tools/gen_soal');

module.exports = function(app) {

  app.delete('/api/bank', (req, res) => {
    try {
      const { mapel } = req.query;
      if (!mapel) return res.status(400).json({ success: false, error: 'Parameter mapel wajib diisi' });
      res.json({ success: true, deleted: bankDb.deleteByMapel(mapel) });
    } catch(err) { handleError(res, err); }
  });

  app.get('/api/bank', (req, res) => {
    try {
      const { mapel, kelas, bab, tingkat, tipe, search, limit, offset } = req.query;
      res.json({ success: true, ...bankDb.getAllSoal({ mapel, kelas, bab, tingkat, tipe, search, limit, offset }) });
    } catch(err) { handleError(res, err); }
  });

  app.get('/api/bank/stats', (req, res) => {
    try { res.json({ success: true, data: bankDb.getStats() }); }
    catch(err) { handleError(res, err); }
  });

  app.get('/api/bank/mapel', (req, res) => {
    try { res.json({ success: true, data: bankDb.getMapelList() }); }
    catch(err) { handleError(res, err); }
  });

  app.get('/api/bank/bab', (req, res) => {
    try { res.json({ success: true, data: bankDb.getBabList(req.query.mapel) }); }
    catch(err) { handleError(res, err); }
  });

  app.get('/api/bank/tags', (req, res) => {
    try { res.json({ success: true, data: bankDb.getAllTags() }); }
    catch(err) { handleError(res, err); }
  });

  app.post('/api/bank', (req, res) => {
    try {
      const { mapel, soal, tipe } = req.body;
      if (!mapel || !soal || !tipe)
        return res.status(400).json({ success: false, error: 'mapel, soal, dan tipe wajib diisi' });
      res.json({ success: true, data: bankDb.createSoal(req.body) });
    } catch(err) { handleError(res, err); }
  });

  app.post('/api/bank/bulk', (req, res) => {
    try {
      const { soalList, mapel, kelas, bab, sumber } = req.body;
      if (!soalList?.length)
        return res.status(400).json({ success: false, error: 'soalList wajib diisi' });
      const enriched = soalList.map(s => ({
        ...s,
        mapel:  s.mapel  || mapel  || '—',
        kelas:  s.kelas  || kelas  || 'Semua',
        bab:    s.bab    || bab    || null,
        sumber: s.sumber || sumber || 'MCP Generator',
      }));
      const result = bankDb.bulkInsert(enriched);
      res.json({ success: true, inserted: result.length, data: result });
    } catch(err) { handleError(res, err); }
  });

  app.get('/api/bank/export', (req, res) => {
    try {
      const { mapel } = req.query;
      const result    = bankDb.getAllSoal({ mapel, limit: 9999 });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition',
        `attachment; filename="bank_soal${mapel ? '_' + mapel : ''}_${Date.now()}.json"`);
      res.json({ exported_at: new Date().toISOString(), total: result.total, soal: result.data });
    } catch(err) { handleError(res, err); }
  });

  app.post('/api/bank/import', (req, res) => {
    try {
      const { soal, mapel: defaultMapel } = req.body;
      if (!soal?.length)
        return res.status(400).json({ success: false, error: 'Data soal kosong' });
      const normalize = (s) => ({
        soal:    s.soal    || s.pertanyaan || s.question || s.text || '',
        mapel:   s.mapel   || s.mata_pelajaran || s.subject || defaultMapel || '',
        kelas:   s.kelas   || s.class    || 'Semua',
        bab:     s.bab     || s.chapter  || s.topik || null,
        tingkat: s.tingkat || s.level    || s.bloom || 'C2',
        tipe:    (s.tipe   || s.type     || 'PG').toUpperCase(),
        opsi_a:  s.opsi_a  || s.a        || s.opsi?.A || s.options?.A || null,
        opsi_b:  s.opsi_b  || s.b        || s.opsi?.B || s.options?.B || null,
        opsi_c:  s.opsi_c  || s.c        || s.opsi?.C || s.options?.C || null,
        opsi_d:  s.opsi_d  || s.d        || s.opsi?.D || s.options?.D || null,
        opsi_e:  s.opsi_e  || s.e        || s.opsi?.E || s.options?.E || null,
        kunci:   s.kunci   || s.jawaban  || s.answer  || s.key || null,
        bobot:   s.bobot   || s.poin     || s.points  || 1,
        sumber:  s.sumber  || 'Import',
      });
      const valid   = soal.map(normalize).filter(s => s.soal.trim());
      const skipped = soal.length - valid.length;
      if (!valid.length)
        return res.status(400).json({ success: false, error: 'Semua soal dilewati', skipped });
      const result = bankDb.bulkInsert(valid);
      res.json({ success: true, inserted: result.length, skipped });
    } catch(err) { handleError(res, err); }
  });

  app.get('/api/bank/:id', (req, res) => {
    try {
      const s = bankDb.getSoalById(req.params.id);
      if (!s) return res.status(404).json({ success: false, error: 'Soal tidak ditemukan' });
      res.json({ success: true, data: s });
    } catch(err) { handleError(res, err); }
  });

  app.put('/api/bank/:id', (req, res) => {
    try { res.json({ success: true, data: bankDb.updateSoal(req.params.id, req.body) }); }
    catch(err) { handleError(res, err); }
  });

  app.delete('/api/bank/:id', (req, res) => {
    try { bankDb.deleteSoal(req.params.id); res.json({ success: true }); }
    catch(err) { handleError(res, err); }
  });

  // ── POST /api/bank/to-session/:sessionId — copy soal bank ke sesi CBT ─────
  app.post('/api/bank/to-session/:sessionId', (req, res) => {
    try {
      const { sessionId } = req.params;
      const { soalIds }   = req.body;
      if (!soalIds?.length)
        return res.status(400).json({ success: false, error: 'soalIds wajib diisi' });
      const session = cbtDb.getSession(sessionId);
      if (!session) return res.status(404).json({ success: false, error: 'Sesi tidak ditemukan' });
      const soalList = soalIds.map(id => bankDb.getSoalById(id)).filter(Boolean);
      if (!soalList.length)
        return res.status(400).json({ success: false, error: 'Soal tidak ditemukan di bank' });
      const existing  = cbtDb.getSoal(sessionId, false);
      let   nextNomor = existing.length + 1;
      const formatted = soalList.map(s => ({
        no:   nextNomor++,
        tipe: s.tipe,
        soal: s.soal,
        opsi: { A: s.opsi_a||null, B: s.opsi_b||null, C: s.opsi_c||null, D: s.opsi_d||null, E: s.opsi_e||null },
        kunci: s.kunci,
        bobot: s.bobot || 1,
      }));
      cbtDb.appendSoal(sessionId, fixLatexInSoal(formatted));
      bankDb.recordBulkUsage(soalIds, sessionId);
      res.json({ success: true, inserted: formatted.length, total: existing.length + formatted.length });
    } catch(err) { handleError(res, err); }
  });

};