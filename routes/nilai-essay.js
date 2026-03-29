// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: NILAI ESSAY — Standalone, tidak perlu login GWS Manager
// ═══════════════════════════════════════════════════════════════════════════════

const cbtDb = require('../db/cbt');
const pkgDb = require('../db/package');
const { getSheetsClient, handleError } = require('../helpers/auth');

module.exports = function(app) {

  // ── GET /api/nilai-essay/sessions — list sesi untuk picker (PUBLIK) ─────────
  app.get('/api/nilai-essay/sessions', (req, res) => {
    try {
      const sessions = cbtDb.getAllSessions();
      res.json({ success: true, data: sessions });
    } catch(err) { handleError(res, err); }
  });

  // ── GET /api/nilai-essay/session/:id — info sesi + soal essay ──────────────
  app.get('/api/nilai-essay/session/:id', (req, res) => {
    try {
      const session = cbtDb.getSession(req.params.id);
      if (!session) return res.status(404).json({ success: false, error: 'Sesi tidak ditemukan' });

      const soalEssay = cbtDb.getSoal(req.params.id, false)
        .filter(s => s.tipe === 'ES' || s.tipe === 'ESSAY');

      res.json({
        success: true,
        session: {
          id:       session.id,
          name:     session.name,
          mapel:    session.mapel,
          kelas:    session.kelas,
          status:   session.status,
          duration: session.duration,
        },
        soalEssay,
        totalEssay: soalEssay.length,
      });
    } catch(err) { handleError(res, err); }
  });

  // ── GET /api/nilai-essay/session/:id/answers?nomor=X — jawaban essay per soal
  app.get('/api/nilai-essay/session/:id/answers', (req, res) => {
    try {
      const nomor = req.query.nomor ? parseInt(req.query.nomor) : null;

      // Ambil semua jawaban essay untuk sesi ini
      const allJawaban = cbtDb.getAllJawaban
        ? cbtDb.getAllJawaban(req.params.id)
        : [];

      // Filter essay saja
      const soalList = cbtDb.getSoal(req.params.id, false)
        .filter(s => s.tipe === 'ES' || s.tipe === 'ESSAY');

      const soalNomors = soalList.map(s => s.nomor);
      let jawaban = allJawaban.filter(j => soalNomors.includes(j.nomor));

      if (nomor) {
        jawaban = jawaban.filter(j => j.nomor === nomor);
      }

      // Gabungkan dengan info peserta (nama, ruang)
      const participants = cbtDb.getParticipants(req.params.id);
      const pMap = {};
      participants.forEach(p => { pMap[p.user_email] = p; });

      const enriched = jawaban.map(j => ({
        ...j,
        user_name:  pMap[j.user_email]?.user_name  || j.user_email,
        room_id:    pMap[j.user_email]?.room_id     || null,
        risk_level: pMap[j.user_email]?.risk_level  || 'safe',
        status:     pMap[j.user_email]?.status      || 'enrolled',
      }));

      // Group by nomor soal
      const byNomor = {};
      soalList.forEach(s => { byNomor[s.nomor] = { soal: s, jawaban: [] }; });
      enriched.forEach(j => {
        if (byNomor[j.nomor]) byNomor[j.nomor].jawaban.push(j);
      });

      res.json({ success: true, data: enriched, byNomor });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/nilai-essay/session/:id/nilai — simpan nilai essay ─────────────
  app.post('/api/nilai-essay/session/:id/nilai', (req, res) => {
    try {
      const { userEmail, nomor, nilai } = req.body;
      if (!userEmail || !nomor || nilai === undefined) {
        return res.status(400).json({ success: false, error: 'userEmail, nomor, nilai wajib' });
      }
      const n = parseFloat(nilai);
      if (isNaN(n) || n < 0) {
        return res.status(400).json({ success: false, error: 'Nilai tidak valid' });
      }
      cbtDb.saveEssayNilai(req.params.id, userEmail, parseInt(nomor), n);
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

  // ── GET /api/nilai-essay/session/:id/progress — progress penilaian ──────────
  app.get('/api/nilai-essay/session/:id/progress', (req, res) => {
    try {
      const soalEssay = cbtDb.getSoal(req.params.id, false)
        .filter(s => s.tipe === 'ES' || s.tipe === 'ESSAY');

      const allJawaban = cbtDb.getAllJawaban
        ? cbtDb.getAllJawaban(req.params.id)
        : [];

      const soalNomors = soalEssay.map(s => s.nomor);
      const essayJawaban = allJawaban.filter(j => soalNomors.includes(j.nomor));

      const totalJawaban  = essayJawaban.length;
      const sudahDinilai  = essayJawaban.filter(j => j.nilai !== null && j.nilai > 0).length;
      const belumDinilai  = totalJawaban - sudahDinilai;

      res.json({
        success: true,
        totalSoalEssay: soalEssay.length,
        totalJawaban,
        sudahDinilai,
        belumDinilai,
        pctDone: totalJawaban > 0 ? Math.round(sudahDinilai / totalJawaban * 100) : 0,
      });
    } catch(err) { handleError(res, err); }
  });

  // ── GET /api/nilai-essay/session/:id/rekap — rekap nilai per siswa ──────────
  app.get('/api/nilai-essay/session/:id/rekap', (req, res) => {
    try {
      const rekap = cbtDb.getRekap ? cbtDb.getRekap(req.params.id) : [];
      res.json({ success: true, data: rekap });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/nilai-essay/session/:id/export-sheets ───────────────────────
  // Export rekap nilai lengkap ke Google Sheets (3 sheet)
  app.post('/api/nilai-essay/session/:id/export-sheets', async (req, res) => {
    try {
      const sessionId = req.params.id;
      const session   = cbtDb.getSession(sessionId);
      if (!session) return res.status(404).json({ success: false, error: 'Sesi tidak ditemukan' });

      // ── Kumpulkan semua data ──────────────────────────────────────────────
      const soalAll   = cbtDb.getSoal(sessionId, false);
      const soalPG    = soalAll.filter(s => s.tipe === 'PG');
      const soalEssay = soalAll.filter(s => s.tipe === 'ES' || s.tipe === 'ESSAY');
      const allJawaban = cbtDb.getAllJawaban(sessionId);
      const participants = cbtDb.getParticipants(sessionId);

      // Map room_id → nama ruang (kalau ada multi-ruang)
      const roomMap = {};
      try {
        // cari paket yang punya soal_source ini
        const allPkgs = pkgDb.getAllPackages();
        const pkg = allPkgs.find(p => p.soal_source === sessionId);
        if (pkg?.rooms) {
          pkg.rooms.forEach(r => { roomMap[r.id] = r.room_name; });
        }
      } catch(_) {}

      // Bangun rekap per siswa
      const rekapMap = {};
      participants.forEach(p => {
        rekapMap[p.user_email] = {
          nama:      p.user_name || p.user_email,
          email:     p.user_email,
          ruang:     roomMap[p.room_id] || '—',
          status:    p.status === 'submitted' ? 'Selesai' : 'Tidak Submit',
          dijawab:   0,
          pgBenar:   0,
          nilaiPG:   0,
          nilaiEssay:0,
          total:     0,
        };
      });

      allJawaban.forEach(j => {
        if (!rekapMap[j.user_email]) return;
        const r = rekapMap[j.user_email];
        r.dijawab++;
        if (j.tipe === 'PG') {
          if (j.is_correct === 1) r.pgBenar++;
          r.nilaiPG += j.nilai || 0;
        } else {
          r.nilaiEssay += j.nilai || 0;
        }
      });

      Object.values(rekapMap).forEach(r => {
        r.total = +(r.nilaiPG + r.nilaiEssay).toFixed(1);
      });

      const rekapRows = Object.values(rekapMap)
        .sort((a, b) => a.nama.localeCompare(b.nama));

      // Statistik
      const nilaiList = rekapRows.map(r => r.total).filter(n => n > 0);
      const avg       = nilaiList.length
        ? +(nilaiList.reduce((s, n) => s + n, 0) / nilaiList.length).toFixed(1)
        : 0;
      const maxNilai  = nilaiList.length ? Math.max(...nilaiList) : 0;
      const minNilai  = nilaiList.length ? Math.min(...nilaiList) : 0;
      const maxPoin   = soalAll.reduce((s, x) => s + (x.bobot || 0), 0);

      // ── Buat Spreadsheet ─────────────────────────────────────────────────
      const sheets  = await getSheetsClient();
      const dateStr = new Date().toLocaleDateString('id-ID', {
        day:'2-digit', month:'long', year:'numeric',
      });
      const title = `Nilai ${session.name} — ${dateStr}`;

      const created = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title },
          sheets: [
            { properties: { title: 'Rekap Nilai', sheetId: 0 } },
            { properties: { title: 'Detail Essay', sheetId: 1 } },
            { properties: { title: 'Info Ujian',   sheetId: 2 } },
          ],
        },
      });
      const ssId = created.data.spreadsheetId;

      // ── Sheet 1: Rekap Nilai ──────────────────────────────────────────────
      const headerRekap = [
        ['No','Nama Siswa','Email','Ruang','Status',
         `Dijawab (/${soalAll.length})`,
         `PG Benar (/${soalPG.length})`,
         'Nilai PG','Nilai Essay','Total Nilai','Keterangan']
      ];
      const dataRekap = rekapRows.map((r, i) => [
        i + 1, r.nama, r.email, r.ruang, r.status,
        r.dijawab, r.pgBenar, r.nilaiPG, r.nilaiEssay, r.total, '',
      ]);

      // ── Sheet 2: Detail Essay ─────────────────────────────────────────────
      const headerEssay = [['Nama Siswa','Email','No Soal','Pertanyaan','Jawaban Siswa','Nilai','Maks Poin']];
      const dataEssay = [];
      const essayJawaban = allJawaban.filter(j => j.tipe === 'ES' || j.tipe === 'ESSAY');
      essayJawaban.forEach(j => {
        const p = rekapMap[j.user_email];
        dataEssay.push([
          p?.nama || j.user_email,
          j.user_email,
          j.nomor,
          j.soal_text || '',
          j.jawaban   || '(Tidak menjawab)',
          j.nilai     || 0,
          j.bobot     || 0,
        ]);
      });
      if (!dataEssay.length) dataEssay.push(['Tidak ada soal essay di sesi ini','','','','','','']);

      // ── Sheet 3: Info Ujian ───────────────────────────────────────────────
      const dataInfo = [
        ['INFORMASI UJIAN', ''],
        [''],
        ['Nama Ujian',         session.name],
        ['Mata Pelajaran',     session.mapel],
        ['Kelas',              session.kelas || '—'],
        ['Durasi',             `${session.duration} menit`],
        ['Total Soal',         `${soalAll.length} soal (${soalPG.length} PG + ${soalEssay.length} Essay)`],
        ['Maks Poin',          maxPoin],
        [''],
        ['STATISTIK NILAI', ''],
        [''],
        ['Total Peserta',      rekapRows.length],
        ['Peserta Submit',     rekapRows.filter(r => r.status === 'Selesai').length],
        ['Nilai Tertinggi',    maxNilai],
        ['Nilai Terendah',     minNilai],
        ['Rata-rata',          avg],
        [''],
        ['Tanggal Export',     new Date().toLocaleString('id-ID')],
      ];

      // ── Tulis semua data sekaligus ────────────────────────────────────────
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: ssId,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: 'Rekap Nilai!A1',  values: [...headerRekap, ...dataRekap] },
            { range: 'Detail Essay!A1', values: [...headerEssay, ...dataEssay] },
            { range: 'Info Ujian!A1',   values: dataInfo },
          ],
        },
      });

      // ── Format: bold header + freeze + warna header ───────────────────────
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: ssId,
        requestBody: { requests: [
          // Bold + warna header Sheet 1
          { repeatCell: {
            range:  { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell:   { userEnteredFormat: {
              textFormat:      { bold: true, foregroundColor: { red:1, green:1, blue:1 } },
              backgroundColor: { red: 0.13, green: 0.15, blue: 0.22 },
            }},
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          }},
          // Freeze row 1 Sheet 1
          { updateSheetProperties: {
            properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          }},
          // Bold + warna header Sheet 2
          { repeatCell: {
            range:  { sheetId: 1, startRowIndex: 0, endRowIndex: 1 },
            cell:   { userEnteredFormat: {
              textFormat:      { bold: true, foregroundColor: { red:1, green:1, blue:1 } },
              backgroundColor: { red: 0.13, green: 0.15, blue: 0.22 },
            }},
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          }},
          // Freeze row 1 Sheet 2
          { updateSheetProperties: {
            properties: { sheetId: 1, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          }},
          // Bold header Info Ujian
          { repeatCell: {
            range:  { sheetId: 2, startRowIndex: 0, endRowIndex: 1 },
            cell:   { userEnteredFormat: {
              textFormat: { bold: true, fontSize: 13 },
            }},
            fields: 'userEnteredFormat(textFormat)',
          }},
          // Auto-resize kolom Sheet 1
          { autoResizeDimensions: {
            dimensions: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 11 },
          }},
          // Auto-resize kolom Sheet 2
          { autoResizeDimensions: {
            dimensions: { sheetId: 1, dimension: 'COLUMNS', startIndex: 0, endIndex: 7 },
          }},
          // Warna baris siswa tidak submit (merah muda)
          ...rekapRows.map((r, i) => r.status !== 'Selesai' ? {
            repeatCell: {
              range: { sheetId: 0, startRowIndex: i+1, endRowIndex: i+2 },
              cell:  { userEnteredFormat: {
                backgroundColor: { red: 1, green: 0.9, blue: 0.9 },
              }},
              fields: 'userEnteredFormat(backgroundColor)',
            },
          } : null).filter(Boolean),
        ]},
      });

      const url = `https://docs.google.com/spreadsheets/d/${ssId}`;
      res.json({
        success: true,
        url,
        stats: {
          totalPeserta: rekapRows.length,
          avg, maxNilai, minNilai,
          sudahDinilai: dataInfo[13][1],
        },
      });
    } catch(err) { handleError(res, err); }
  });

};