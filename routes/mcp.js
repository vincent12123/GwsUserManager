/**
 * routes/mcp.js - MCP Generator Soal terintegrasi GWS Manager
 */
const path = require('path');
const fs   = require('fs');

const OUTPUT_DIR = process.env.MCP_OUTPUT_DIR || './mcp_outputs';
const UPLOAD_DIR = process.env.MCP_UPLOAD_DIR || './mcp_uploads';

[UPLOAD_DIR, OUTPUT_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Require DB di luar function agar selalu tersedia ──────────────────────────
const mcpDb = require('../db/mcp');
const cbtDb = require('../db/cbt');
const _cfg  = require('../config');

module.exports = function(app) {

  let multer, archiver;
  try {
    multer   = require('multer');
    archiver = require('archiver');
  } catch(e) {
    console.error('  ✗ routes/mcp.js: dependency hilang —', e.message);
    app.all('/api/mcp/*', (req, res) =>
      res.status(503).json({ success: false, error: 'MCP belum siap. Jalankan: npm install multer archiver' })
    );
    return;
  }

  const express = require('express');

  app.use('/api/mcp/download', express.static(OUTPUT_DIR));

  const upload = multer({
    dest: UPLOAD_DIR,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Hanya file PDF'));
    },
  });

  // GET /api/mcp/health
  app.get('/api/mcp/health', async (req, res) => {
    try {
      const { checkOllama } = require('../ollama_helper');
      const ok    = await checkOllama();
      const model = process.env.OLLAMA_MODEL || 'llama3';
      res.json({ status: ok ? 'ok' : 'error', engine: 'Ollama', model,
        message: ok ? `Model ${model} siap` : 'Ollama tidak merespons' });
    } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
  });

  // GET /api/mcp/packages
  app.get('/api/mcp/packages', (req, res) => {
    try { res.json({ success: true, data: mcpDb.getAllPackages() }); }
    catch(err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // GET /api/mcp/packages/:id
  app.get('/api/mcp/packages/:id', (req, res) => {
    try {
      const pkg = mcpDb.getPackage(req.params.id);
      if (!pkg) return res.status(404).json({ success: false, error: 'Paket tidak ditemukan' });
      const soal = mcpDb.getSoalByPackage(req.params.id);
      res.json({ success: true, data: { ...pkg, soal } });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // DELETE /api/mcp/packages/:id
  app.delete('/api/mcp/packages/:id', (req, res) => {
    try { mcpDb.deletePackage(req.params.id); res.json({ success: true }); }
    catch(err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // POST /api/mcp/extract-pdf
  app.post('/api/mcp/extract-pdf', (req, res, next) => {
    upload.single('file')(req, res, err => {
      if (err) return res.status(400).json({ success: false, error: err.message });
      next();
    });
  }, async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'File PDF wajib diupload' });
    const filePath = req.file.path;
    try {
      const { extractPdf } = require('../tools/extract_pdf');
      const result = await extractPdf(filePath);
      res.json({ success: true, result });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    finally { try { fs.unlinkSync(filePath); } catch {} }
  });

  // POST /api/mcp/gen-soal — generate + simpan ke DB
  app.post('/api/mcp/gen-soal', async (req, res) => {
    const {
      teks_materi, mapel = 'Pemrograman', kelas = 'XI RPL',
      num_pg = 5, num_es = 3, level = 'sedang',
      nama_sekolah, semester = 'Ganjil',
      tahun_ajaran = '2025/2026', waktu = '90 menit', pembuat = 'Guru',
      // Teks bacaan (soal cerita)
      with_teks_bacaan = false,
      num_teks = 1,
      soal_per_teks = 3,
    } = req.body;

    if (!teks_materi || teks_materi.trim().length < 50)
      return res.status(400).json({ success: false, error: 'teks_materi minimal 50 karakter' });

    try {
      const { genSoal } = require('../tools/gen_soal');
      const dataSoal = await genSoal(teks_materi, {
        mapel, kelas,
        numPG:           parseInt(num_pg),
        numES:           parseInt(num_es),
        level,
        withTeksBacaan:  Boolean(with_teks_bacaan),
        numTeks:         parseInt(num_teks)    || 1,
        soalPerTeks:     parseInt(soal_per_teks) || 3,
      });
      if (!dataSoal?.soal?.length) throw new Error('Ollama tidak menghasilkan soal');

      const namaSekolah = nama_sekolah || _cfg.SCHOOL_SHORT_NAME || 'Sekolah';
      const config = {
        level, numPG: parseInt(num_pg), numES: parseInt(num_es),
        namaSekolah, semester, tahunAjaran: tahun_ajaran, waktu, pembuat,
        withTeksBacaan: Boolean(with_teks_bacaan),
      };
      const pkg  = mcpDb.createPackage({ mapel, kelas, config, soalArr: dataSoal.soal });
      const soal = mcpDb.getSoalByPackage(pkg.id);
      console.log(`[MCP] Package ${pkg.id} — ${soal.length} soal, teks_bacaan: ${dataSoal.teks_bacaan?.length || 0}`);
      res.json({ success: true, data: { ...pkg, soal, teks_bacaan: dataSoal.teks_bacaan || [] } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // PATCH /api/mcp/soal/:soalId — update 1 soal + review status
  app.patch('/api/mcp/soal/:soalId', (req, res) => {
    try {
      const { soal, opsiA, opsiB, opsiC, opsiD, opsiE, kunci, bobot, pembahasan, reviewStatus } = req.body;
      mcpDb.updateSoal(parseInt(req.params.soalId), {
        soal, opsiA, opsiB, opsiC, opsiD, opsiE, kunci,
        bobot: parseInt(bobot) || 1, pembahasan,
        reviewStatus: reviewStatus || 'pending',
      });
      res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // PATCH /api/mcp/packages/:id/bulk-status
  app.patch('/api/mcp/packages/:id/bulk-status', (req, res) => {
    try {
      const { status } = req.body;
      if (!['approved','rejected','pending'].includes(status))
        return res.status(400).json({ success: false, error: 'status tidak valid' });
      mcpDb.bulkSetReviewStatus(req.params.id, status);
      res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // POST /api/mcp/packages/:id/export-docx
  app.post('/api/mcp/packages/:id/export-docx', async (req, res) => {
    try {
      const pkg = mcpDb.getPackage(req.params.id);
      if (!pkg) return res.status(404).json({ success: false, error: 'Paket tidak ditemukan' });
      const approvedSoal = mcpDb.getApprovedSoal(req.params.id);
      if (!approvedSoal.length)
        return res.status(400).json({ success: false, error: 'Tidak ada soal yang disetujui' });
      approvedSoal.forEach((s, i) => { s.no = i + 1; });
      const cfg = pkg.config || {};
      const dataSoal = {
        meta: {
          mapel: pkg.mapel, kelas: pkg.kelas,
          topik: approvedSoal[0]?.soal?.slice(0, 60) || '-',
          total_pg:    approvedSoal.filter(s => s.tipe === 'PG').length,
          total_essay: approvedSoal.filter(s => s.tipe === 'ES').length,
          total_bobot: approvedSoal.reduce((s, q) => s + (q.bobot || 0), 0),
        },
        soal: approvedSoal,
      };
      const pengaturan = {
        namaSekolah: cfg.namaSekolah || _cfg.SCHOOL_SHORT_NAME || 'Sekolah',
        semester:    cfg.semester    || 'Ganjil',
        tahunAjaran: cfg.tahunAjaran || '2025/2026',
        waktu:       cfg.waktu       || '90 menit',
        pembuat:     cfg.pembuat     || 'Guru',
      };
      const { exportDocx, exportKunci } = require('../tools/export_docx');
      const [soalResult, kunciResult] = await Promise.all([
        exportDocx(dataSoal, pengaturan, OUTPUT_DIR),
        exportKunci(dataSoal, pengaturan, OUTPUT_DIR),
      ]);
      const ts = Date.now();
      const safeName  = pkg.mapel.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
      const safeKelas = pkg.kelas.replace(/\s+/g, '');
      const jsonFilename = `soal_${safeName}_${safeKelas}_${ts}.json`;
      const jsonPath     = path.join(OUTPUT_DIR, jsonFilename);
      fs.writeFileSync(jsonPath, JSON.stringify({
        meta: { ...dataSoal.meta, ...pengaturan, exported_at: new Date().toISOString() },
        soal: dataSoal.soal,
      }, null, 2));
      const zipFilename = `soal_${safeName}_${safeKelas}_${ts}.zip`;
      const zipPath     = path.join(OUTPUT_DIR, zipFilename);
      await new Promise((resolve, reject) => {
        const output  = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', resolve); archive.on('error', reject);
        archive.pipe(output);
        archive.file(soalResult.filePath,  { name: soalResult.filename });
        archive.file(kunciResult.filePath, { name: kunciResult.filename });
        archive.file(jsonPath, { name: jsonFilename });
        archive.finalize();
      });
      mcpDb.updatePackageStatus(req.params.id, 'reviewed');
      const host = `${req.protocol}://${req.get('host')}`;
      res.json({
        success: true, jumlah: approvedSoal.length,
        result: {
          zip:   { filename: zipFilename,          download_url: `${host}/api/mcp/download/${zipFilename}` },
          soal:  { filename: soalResult.filename,  download_url: `${host}/api/mcp/download/${soalResult.filename}` },
          kunci: { filename: kunciResult.filename, download_url: `${host}/api/mcp/download/${kunciResult.filename}` },
          json:  { filename: jsonFilename,         download_url: `${host}/api/mcp/download/${jsonFilename}` },
        },
      });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // POST /api/mcp/packages/:id/import-to-cbt
  app.post('/api/mcp/packages/:id/import-to-cbt', (req, res) => {
    try {
      const { session_id } = req.body;
      if (!session_id) return res.status(400).json({ success: false, error: 'session_id wajib diisi' });
      const sesi = cbtDb.getSession(session_id);
      if (!sesi) return res.status(404).json({ success: false, error: 'Sesi tidak ditemukan' });
      const approvedSoal = mcpDb.getApprovedSoal(req.params.id);
      if (!approvedSoal.length)
        return res.status(400).json({ success: false, error: 'Tidak ada soal yang disetujui' });
      approvedSoal.forEach((s, i) => { s.no = i + 1; });
      const jumlah = cbtDb.importSoal(session_id, approvedSoal);
      mcpDb.updatePackageStatus(req.params.id, 'imported');
      res.json({ success: true, message: `${jumlah} soal diimport ke sesi "${sesi.name}"`, inserted: jumlah });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // POST /api/bank/upload-image — upload gambar untuk soal (Markdown)
  app.post('/api/bank/upload-image', (req, res, next) => {
    const imgUpload = multer({
      dest: './public/uploads/soal/',
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)
          ? cb(null, true)
          : cb(new Error('Hanya file gambar (jpg/png/gif/webp)'));
      },
    });
    imgUpload.single('image')(req, res, err => {
      if (err) return res.status(400).json({ success: false, error: err.message });
      if (!req.file) return res.status(400).json({ success: false, error: 'File gambar wajib diupload' });
      const url = `/uploads/soal/${req.file.filename}`;
      res.json({ success: true, url, filename: req.file.filename });
    });
  });

};