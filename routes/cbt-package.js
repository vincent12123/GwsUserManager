// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: CBT PACKAGE — Multi-Ruang Ujian
// ═══════════════════════════════════════════════════════════════════════════════

const pkgDb  = require('../db/package');
const cbtDb  = require('../db/cbt');
const { getClassroomClient, handleError } = require('../helpers/auth');

// ── Helper: ambil session/source soal dari data monitor ruang ─────────────────
function getSessionIdFromRoomMonitor(data) {
  return data?.pkg?.soal_source || data?.soal_source || data?.sessionId || null;
}

// ── Helper: hitung total soal aktual dari sesi CBT ────────────────────────────
function getTotalSoal(sessionId) {
  if (!sessionId || !cbtDb.getSoal) return 0;
  try {
    const soal = cbtDb.getSoal(sessionId, false);
    return Array.isArray(soal) ? soal.length : 0;
  } catch (_) {
    return 0;
  }
}

// ── Helper: ambil semua jawaban satu siswa ────────────────────────────────────
function getJawabanSiswa(sessionId, userEmail) {
  if (!sessionId || !userEmail) return [];

  try {
    if (cbtDb.getJawabanSiswa) {
      const rows = cbtDb.getJawabanSiswa(sessionId, userEmail);
      return Array.isArray(rows) ? rows : [];
    }

    if (cbtDb.getAllJawaban) {
      const rows = cbtDb.getAllJawaban(sessionId);
      return Array.isArray(rows)
        ? rows.filter(j => String(j.user_email || '').toLowerCase() === String(userEmail).toLowerCase())
        : [];
    }

    return [];
  } catch (_) {
    return [];
  }
}

// ── Helper: hitung jumlah soal yang sudah dijawab ─────────────────────────────
function countAnswered(jawabanList) {
  if (!Array.isArray(jawabanList)) return 0;

  return jawabanList.filter(j => {
    const val = j?.jawaban;
    if (val === null || val === undefined) return false;
    return String(val).trim() !== '';
  }).length;
}

// ── Helper: enrich data monitor ruang ─────────────────────────────────────────
// Menambahkan:
// - totalSoal: jumlah soal aktual dari source session
// - participants[].answered: jumlah soal yang sudah dijawab siswa
function enrichRoomMonitor(data) {
  if (!data) return data;

  const sessionId = getSessionIdFromRoomMonitor(data);
  const totalSoal = getTotalSoal(sessionId);

  const participants = Array.isArray(data.participants)
    ? data.participants.map(p => {
        const answered = sessionId
          ? countAnswered(getJawabanSiswa(sessionId, p.user_email))
          : (p.answered || 0);

        return {
          ...p,
          answered,
        };
      })
    : [];

  return {
    ...data,
    totalSoal,
    participants,
  };
}


module.exports = function(app) {

  // ── GET /api/cbt-package — list semua paket ─────────────────────────────────
  app.get('/api/cbt-package', (req, res) => {
    try {
      res.json({ success: true, data: pkgDb.getAllPackages() });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/cbt-package — buat paket baru ─────────────────────────────────
  app.post('/api/cbt-package', (req, res) => {
    try {
      const { name, mapel, kelas, duration, courseId, soalSource } = req.body;
      if (!name || !mapel) return res.status(400).json({ success: false, error: 'name dan mapel wajib' });
      const pkg = pkgDb.createPackage({ name, mapel, kelas, duration, courseId, soalSource });
      res.json({ success: true, data: pkg });
    } catch(err) { handleError(res, err); }
  });

  // ── GET /api/cbt-package/:id ────────────────────────────────────────────────
  app.get('/api/cbt-package/:id', (req, res) => {
    try {
      const pkg = pkgDb.getPackage(req.params.id);
      if (!pkg) return res.status(404).json({ success: false, error: 'Paket tidak ditemukan' });
      res.json({ success: true, data: pkg });
    } catch(err) { handleError(res, err); }
  });

  // ── PUT /api/cbt-package/:id ────────────────────────────────────────────────
  app.put('/api/cbt-package/:id', (req, res) => {
    try {
      const pkg = pkgDb.updatePackage(req.params.id, req.body);
      res.json({ success: true, data: pkg });
    } catch(err) { handleError(res, err); }
  });

  // ── DELETE /api/cbt-package/:id ─────────────────────────────────────────────
  app.delete('/api/cbt-package/:id', (req, res) => {
    try {
      pkgDb.deletePackage(req.params.id);
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/cbt-package/:id/rooms — tambah ruang ──────────────────────────
  app.post('/api/cbt-package/:id/rooms', (req, res) => {
    try {
      const { roomName, pengawasName, pengawasEmail, maxSiswa, tokenInterval } = req.body;
      if (!roomName) return res.status(400).json({ success: false, error: 'Nama ruang wajib' });
      const room = pkgDb.createRoom(req.params.id, { roomName, pengawasName, pengawasEmail, maxSiswa, tokenInterval });
      res.json({ success: true, data: room });
    } catch(err) { handleError(res, err); }
  });

  // ── PUT /api/cbt-package/rooms/:roomId ──────────────────────────────────────
  app.put('/api/cbt-package/rooms/:roomId', (req, res) => {
    try {
      const room = pkgDb.updateRoom(req.params.roomId, req.body);
      res.json({ success: true, data: room });
    } catch(err) { handleError(res, err); }
  });

  // ── DELETE /api/cbt-package/rooms/:roomId ───────────────────────────────────
  app.delete('/api/cbt-package/rooms/:roomId', (req, res) => {
    try {
      pkgDb.deleteRoom(req.params.roomId);
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/cbt-package/:id/start-all ─────────────────────────────────────
app.post('/api/cbt-package/:id/start-all', (req, res) => {
  try {
    const pkg = pkgDb.getPackage(req.params.id);
    if (!pkg) return res.status(404).json({ success: false, error: 'Paket tidak ditemukan' });
    if (!pkg.soal_source) return res.status(400).json({ success: false, error: 'Sumber soal belum dipilih' });
    if (pkg.rooms.length === 0) return res.status(400).json({ success: false, error: 'Belum ada ruang yang dibuat' });
    
    const updated = pkgDb.startAllRooms(req.params.id);

    // ── FIX: aktivasi session soal_source jika masih draft ──
    const session = cbtDb.getSession(pkg.soal_source);
    if (session && session.status === 'draft') {
      cbtDb.startSession(pkg.soal_source);
      console.log(`[Package] Session ${pkg.soal_source} auto-started via start-all`);
    }

    res.json({ success: true, data: updated });
  } catch(err) { handleError(res, err); }
});

  // ── POST /api/cbt-package/:id/end-all ───────────────────────────────────────
app.post('/api/cbt-package/:id/end-all', (req, res) => {
  try {
    const updated = pkgDb.endAllRooms(req.params.id);

    const pkg = pkgDb.getPackage(req.params.id);
    if (pkg && pkg.soal_source) {
      const session = cbtDb.getSession(pkg.soal_source);
      if (session && session.status === 'active') {
        cbtDb.endSession(pkg.soal_source);  // ← pakai endSession
        console.log(`[Package] Session ${pkg.soal_source} auto-ended via end-all`);
      }
    }

    res.json({ success: true, data: updated });
  } catch(err) { handleError(res, err); }
});
  // ── POST /api/cbt-package/rooms/:roomId/start ────────────────────────────────
// ── POST /api/cbt-package/rooms/:roomId/start ────────────────────────────────
app.post('/api/cbt-package/rooms/:roomId/start', (req, res) => {
  try {
    const room = pkgDb.startRoom(req.params.roomId);

    // ── FIX: aktivasi session soal_source jika masih draft ──
    const allPkgs = pkgDb.getAllPackages();
    const parentPkg = allPkgs.find(p =>
      Array.isArray(p.rooms) && p.rooms.some(r => r.id === req.params.roomId)
    );
    if (parentPkg && parentPkg.soal_source) {
      const session = cbtDb.getSession(parentPkg.soal_source);
      if (session && session.status === 'draft') {
        cbtDb.startSession(parentPkg.soal_source);  // ← pakai startSession, bukan updateSession
        console.log(`[Package] Session ${parentPkg.soal_source} auto-started via room ${req.params.roomId}`);
      }
    }

    res.json({ success: true, data: room });
  } catch(err) { handleError(res, err); }
});

  // ── POST /api/cbt-package/rooms/:roomId/end ──────────────────────────────────
  app.post('/api/cbt-package/rooms/:roomId/end', (req, res) => {
    try {
      const room = pkgDb.endRoom(req.params.roomId);
      res.json({ success: true, data: room });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/cbt-package/rooms/:roomId/rotate-token ─────────────────────────
  app.post('/api/cbt-package/rooms/:roomId/rotate-token', (req, res) => {
    try {
      const room = pkgDb.rotateRoomToken(req.params.roomId);
      res.json({ success: true, data: room });
    } catch(err) { handleError(res, err); }
  });

  // ── GET /api/cbt-package/:id/monitor — koordinator ───────────────────────────
  app.get('/api/cbt-package/:id/monitor', (req, res) => {
    try {
      const data = pkgDb.getPackageMonitor(req.params.id);
      if (!data) return res.status(404).json({ success: false, error: 'Paket tidak ditemukan' });
      res.json({ success: true, data: enrichRoomMonitor(data) });
    } catch(err) { handleError(res, err); }
  });

  // ── GET /api/cbt-package/room/:roomId/monitor — pengawas ─────────────────────
  app.get('/api/cbt-package/room/:roomId/monitor', (req, res) => {
    try {
      const data = pkgDb.getRoomMonitor(req.params.roomId);
      if (!data) return res.status(404).json({ success: false, error: 'Ruang tidak ditemukan' });
      res.json({ success: true, data: enrichRoomMonitor(data) });
    } catch(err) { handleError(res, err); }
  });

  // ── GET /api/cbt-package/pengawas/:ptoken — akses pengawas via token ──────────
  app.get('/api/cbt-package/pengawas/:ptoken', (req, res) => {
    try {
      const room = pkgDb.getRoomByPengawasToken(req.params.ptoken);
      if (!room) return res.status(404).json({ success: false, error: 'Token pengawas tidak valid' });
      const data = pkgDb.getRoomMonitor(room.id);
      res.json({ success: true, data: enrichRoomMonitor(data) });
    } catch(err) { handleError(res, err); }
  });

  // ── GET /api/cbt-package/:id/export — rekap gabungan semua ruang ─────────────
  app.get('/api/cbt-package/:id/export', async (req, res) => {
    try {
      const pkg = pkgDb.getPackage(req.params.id);
      if (!pkg) return res.status(404).json({ success: false, error: 'Paket tidak ditemukan' });

      // Kumpulkan rekap semua ruang
      const rekap = [];
      for (const room of pkg.rooms) {
        const data = pkgDb.getRoomMonitor(room.id);
        if (!data) continue;
        for (const p of data.participants) {
          const jawaban = cbtDb.getAllJawaban ? cbtDb.getAllJawaban(pkg.soal_source, p.user_email) : [];
          const nilaiPG = jawaban.filter(j => j.is_correct === 1).reduce((s, j) => s + (j.nilai || 0), 0);
          rekap.push({
            ruang:       room.room_name,
            pengawas:    room.pengawas_name || '-',
            nama:        p.user_name,
            email:       p.user_email,
            status:      p.status,
            dijawab:     p.answered || 0,
            nilaiPG,
            cheat:       p.cheat_count || 0,
            joinedAt:    p.joined_at,
            submittedAt: p.submitted_at,
          });
        }
      }

      // Export ke Google Sheets kalau ada soalSource
      if (req.query.sheets === '1' && pkg.soal_source) {
        try {
          const { getSheetsClient } = require('../helpers/auth');
          const sheets  = await getSheetsClient();
          const title   = `Rekap ${pkg.name} — ${new Date().toLocaleDateString('id-ID')}`;
          const created = await sheets.spreadsheets.create({
            requestBody: { properties: { title } },
          });
          const ssId    = created.data.spreadsheetId;
          const header  = [['Ruang','Pengawas','Nama','Email','Status','Dijawab','Nilai PG','Cheat','Join','Submit']];
          const rows    = rekap.map(r => [r.ruang,r.pengawas,r.nama,r.email,r.status,r.dijawab,r.nilaiPG,r.cheat,r.joinedAt,r.submittedAt]);
          await sheets.spreadsheets.values.update({
            spreadsheetId: ssId, range: 'Sheet1!A1',
            valueInputOption: 'RAW',
            requestBody: { values: [...header, ...rows] },
          });
          return res.json({ success: true, sheetsUrl: `https://docs.google.com/spreadsheets/d/${ssId}`, rekap });
        } catch(se) {
          console.warn('[Package] Sheets export gagal:', se.message);
        }
      }

      res.json({ success: true, rekap });
    } catch(err) { handleError(res, err); }
  });
};