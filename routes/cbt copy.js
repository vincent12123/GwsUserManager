// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: CBT MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

const cbtDb  = require('../db/cbt');
const pkgDb  = require('../db/package');
const { getClassroomClient, getAdminClient, handleError } = require('../helpers/auth');
const axios  = require('axios');

// Reuse getIPLocation dari security.js
async function getIPLocation(ip) {
  if (!ip || ip.startsWith('192.168') || ip.startsWith('10.') || ip.startsWith('127.')) {
    return { country: 'Local', countryCode: 'LOCAL', region: '-', city: '-', isp: '-', riskLevel: 'local' };
  }
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,query`, { timeout: 3000 });
    const d   = res.data;
    if (d.status !== 'success') return { riskLevel: 'unknown' };
    const suspicious = ['google','amazon','digitalocean','cloudflare','microsoft azure','linode','vultr','nordvpn','expressvpn'];
    const ispLower   = (d.isp || '').toLowerCase();
    const isVPN      = suspicious.some(s => ispLower.includes(s));
    const isID       = d.countryCode === 'ID';
    const isKalbar   = (d.regionName || '').toLowerCase().includes('kalimantan barat') || (d.regionName || '').toLowerCase().includes('west kalimantan');
    const riskLevel  = isVPN ? 'vpn' : !isID ? 'overseas' : !isKalbar ? 'outside_region' : 'safe';
    return { country: d.country, countryCode: d.countryCode, region: d.regionName, city: d.city, isp: d.isp, riskLevel };
  } catch(_) { return { riskLevel: 'unknown' }; }
}

module.exports = function(app) {

  // ─────────────────────────────────────────────────────────────────────────────
  // SESI UJIAN
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /api/cbt/sessions
  app.get('/api/cbt/sessions', (req, res) => {
    try {
      const sessions = cbtDb.getAllSessions();
      res.json({ success: true, data: sessions });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/cbt/sessions — buat sesi baru
  app.post('/api/cbt/sessions', (req, res) => {
    try {
      const { name, mapel, kelas, courseId, duration, scheduledAt, tokenInterval } = req.body;
      if (!name || !mapel || !kelas) {
        return res.status(400).json({ success: false, error: 'name, mapel, dan kelas wajib diisi' });
      }
      const session = cbtDb.createSession({ name, mapel, kelas, courseId, duration,
        scheduledAt, tokenInterval: parseInt(tokenInterval) || 0 });
      res.json({ success: true, data: session });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/cbt/sessions/:id
  app.get('/api/cbt/sessions/:id', (req, res) => {
    try {
      const session = cbtDb.getSession(req.params.id);
      if (!session) return res.status(404).json({ success: false, error: 'Sesi tidak ditemukan' });
      const stats   = cbtDb.getSessionStats(req.params.id);
      res.json({ success: true, data: { ...session, stats } });
    } catch(err) { handleError(res, err); }
  });

  // PUT /api/cbt/sessions/:id — update sesi
  app.put('/api/cbt/sessions/:id', (req, res) => {
    try {
      const session = cbtDb.updateSession(req.params.id, req.body);
      res.json({ success: true, data: session });
    } catch(err) { handleError(res, err); }
  });

  // DELETE /api/cbt/sessions/:id
  app.delete('/api/cbt/sessions/:id', (req, res) => {
    try {
      const id      = req.params.id;
      const force   = req.query.force === 'true'; // ?force=true untuk paksa hapus

      // Cek apakah ada jawaban essay yang belum dinilai
      const essayCheck = cbtDb.checkUngradedEssay(id);

      if (!force && essayCheck.hasUngraded) {
        return res.status(409).json({
          success:        false,
          blocked:        true,
          error:          `Sesi ini masih memiliki ${essayCheck.ungradedCount} jawaban essay yang belum dinilai.`,
          detail: {
            totalEssay:     essayCheck.totalEssay,
            gradedCount:    essayCheck.gradedCount,
            ungradedCount:  essayCheck.ungradedCount,
            siswaList:      essayCheck.siswaList,  // nama siswa yang belum dinilai
          },
          hint: 'Selesaikan penilaian essay terlebih dahulu, atau gunakan force=true untuk tetap menghapus.',
        });
      }

      cbtDb.deleteSession(id);
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/cbt/sessions/:id/start
  app.post('/api/cbt/sessions/:id/start', (req, res) => {
    try {
      const session = cbtDb.startSession(req.params.id);
      invalidateRosterCache(req.params.id); // fresh cache saat ujian mulai
      res.json({ success: true, data: session });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/cbt/sessions/:id/end
  app.post('/api/cbt/sessions/:id/end', (req, res) => {
    try {
      const session = cbtDb.endSession(req.params.id);
      invalidateRosterCache(req.params.id); // bersihkan cache saat ujian selesai
      res.json({ success: true, data: session });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/cbt/sessions/:id/regenerate-token — manual rotate
  app.post('/api/cbt/sessions/:id/regenerate-token', (req, res) => {
    try {
      const result  = cbtDb.rotateToken(req.params.id);
      const session = cbtDb.getSession(req.params.id);
      res.json({ success: true, token: result.token, expiresAt: result.expiresAt, data: session });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/cbt/sessions/:id/token-status — cek token + sisa waktu
  app.get('/api/cbt/sessions/:id/token-status', (req, res) => {
    try {
      const session = cbtDb.getSession(req.params.id);
      if (!session) return res.status(404).json({ success: false, error: 'Sesi tidak ditemukan' });

      const isRotating   = session.token_interval > 0;
      const expiresAt    = session.token_expires_at ? new Date(session.token_expires_at) : null;
      const secondsLeft  = expiresAt ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : null;

      res.json({
        success: true,
        token:       session.token,
        interval:    session.token_interval,
        isRotating,
        expiresAt:   session.token_expires_at,
        secondsLeft,
      });
    } catch(err) { handleError(res, err); }
  });

// ─────────────────────────────────────────────────────────────────────────────
// CACHE ROSTER CLASSROOM
// Menghindari hit Google API 200x saat siswa login bersamaan.
// Cache berlaku 10 menit per sesi. Di-refresh manual via sync-roster.
// ─────────────────────────────────────────────────────────────────────────────
const rosterCache = new Map(); // { sessionId → { emails: Set<string>, ts: number } }
const ROSTER_TTL  = 10 * 60 * 1000; // 10 menit

async function getCachedRoster(sessionId, courseId) {
  const cached = rosterCache.get(sessionId);
  if (cached && Date.now() - cached.ts < ROSTER_TTL) {
    return cached.emails; // hit cache
  }
  // Miss — fetch dari Classroom API (1 request untuk semua siswa)
  console.log(`[CBT] Fetch roster kelas ${courseId} dari Classroom API...`);
  const classroom = await getClassroomClient();
  let emails = new Set();
  let pageToken;
  do {
    const r = await classroom.courses.students.list({
      courseId, pageSize: 200, pageToken,
    });
    (r.data.students || []).forEach(s => {
      const email = s.profile?.emailAddress?.toLowerCase();
      if (email) emails.add(email);
    });
    pageToken = r.data.nextPageToken;
  } while (pageToken);

  rosterCache.set(sessionId, { emails, ts: Date.now() });
  console.log(`[CBT] Roster ${courseId} di-cache — ${emails.size} siswa`);
  return emails;
}

// Invalidate cache saat sesi dimulai/diakhiri/roster di-sync
function invalidateRosterCache(sessionId) {
  rosterCache.delete(sessionId);
  console.log(`[CBT] Cache roster sesi ${sessionId} dihapus`);
}



  // GET /api/cbt/sessions/:id/participants
  app.get('/api/cbt/sessions/:id/participants', (req, res) => {
    try {
      const participants = cbtDb.getParticipants(req.params.id);
      const stats        = cbtDb.getSessionStats(req.params.id);
      res.json({ success: true, data: participants, stats });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/cbt/sessions/:id/sync-roster — sync peserta dari Classroom
  app.post('/api/cbt/sessions/:id/sync-roster', async (req, res) => {
    try {
      const session = cbtDb.getSession(req.params.id);
      if (!session) return res.status(404).json({ success: false, error: 'Sesi tidak ditemukan' });
      if (!session.course_id) return res.status(400).json({ success: false, error: 'Sesi belum dihubungkan ke kelas' });

      // Invalidate cache supaya data fresh setelah sync manual
      invalidateRosterCache(req.params.id);

      const classroom = await getClassroomClient();
      const r         = await classroom.courses.students.list({ courseId: session.course_id, pageSize: 200 });
      const students  = r.data.students || [];

      let synced = 0;
      for (const s of students) {
        const email = s.profile?.emailAddress || '';
        const name  = s.profile?.name?.fullName || '';
        if (email) {
          cbtDb.joinSession(req.params.id, { userEmail: email, userName: name, ipAddress: null, geo: null });
          synced++;
        }
      }

      res.json({ success: true, synced, total: students.length });
    } catch(err) { handleError(res, err); }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TOKEN VALIDATION (dipakai oleh halaman siswa)
  // ─────────────────────────────────────────────────────────────────────────────

  // POST /api/cbt/validate-token
  app.post('/api/cbt/validate-token', async (req, res) => {
    try {
      const { token, userEmail, userName } = req.body;
      if (!token) return res.status(400).json({ success: false, error: 'Token wajib diisi' });

      const tokenClean = token.toUpperCase().trim();

      // ── Cek token ruang (multi-ruang) dulu ─────────────────────────────────
      const room = pkgDb.getRoomByToken(tokenClean);
      if (room) {
        return handleRoomToken({ room, userEmail, userName, req, res });
      }

      // ── Fallback: token sesi CBT lama ──────────────────────────────────────
      const session = cbtDb.getSessionByToken(tokenClean);
      if (!session) return res.status(404).json({ success: false, error: 'Token tidak valid atau sudah kadaluarsa' });
      if (session.status === 'draft')  return res.status(403).json({ success: false, error: 'Ujian belum dimulai. Tunggu instruksi pengawas.' });
      if (session.status === 'ended') return res.status(403).json({ success: false, error: 'Ujian sudah selesai' });

      // ── VALIDASI 1: Rotating token expiry ──────────────────────────────────
      if (session.token_interval > 0 && session.token_expires_at) {
        const expiresAt = new Date(session.token_expires_at);
        if (Date.now() > expiresAt.getTime()) {
          return res.status(403).json({
            success: false,
            error: 'Token sudah kadaluarsa. Minta token terbaru kepada pengawas.',
            expired: true,
          });
        }
      }

      // ── VALIDASI 2: Domain email harus @karyabangsa.sch.id ─────────────────
      if (userEmail) {
        const domain = userEmail.split('@')[1]?.toLowerCase();
        if (domain !== 'karyabangsa.sch.id') {
          return res.status(403).json({
            success: false,
            error: 'Hanya akun sekolah @karyabangsa.sch.id yang dapat mengikuti ujian ini.',
          });
        }
      }

      // ── OPTIMASI: Skip validasi roster kalau siswa sudah pernah join ───────
      const emailLower = userEmail?.toLowerCase();
      const sudahJoin  = emailLower ? cbtDb.getParticipantByEmail(session.id, emailLower) : null;

      // ── CEK SUBMIT: Tolak kalau siswa sudah kumpulkan ──────────────────────
      if (sudahJoin?.status === 'submitted') {
        return res.status(403).json({
          success: false,
          error:   'Anda sudah mengumpulkan jawaban untuk ujian ini. Silakan hubungi pengawas jika ada masalah.',
          submitted: true,
        });
      }

      // ── VALIDASI 3: Cek roster Classroom (via cache, bukan per-siswa) ───────
      if (userEmail && session.course_id && !sudahJoin) {
        try {
          const roster     = await getCachedRoster(session.id, session.course_id);
          const isEnrolled = roster.has(emailLower);
          if (!isEnrolled) {
            return res.status(403).json({
              success: false,
              error: `Akun ${userEmail} tidak terdaftar di kelas ini. Hubungi pengawas jika ada kesalahan.`,
            });
          }
        } catch(e) {
          console.warn('[CBT] Classroom roster check gagal, izinkan masuk:', e.message);
        }
      }

      // ── CATAT JOIN ─────────────────────────────────────────────────────────
      const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '';

      if (userEmail) {
        if (!sudahJoin) {
          getIPLocation(ip).then(geo => {
            cbtDb.joinSession(session.id, { userEmail, userName, ipAddress: ip, geo });
          }).catch(() => {
            cbtDb.joinSession(session.id, { userEmail, userName, ipAddress: ip, geo: null });
          });
        } else {
          cbtDb.joinSession(session.id, { userEmail, userName, ipAddress: ip, geo: null });
        }
      }

      const expiresAt   = session.token_expires_at ? new Date(session.token_expires_at) : null;
      const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : null;

      // ── HITUNG SISA WAKTU SISWA (supaya timer tidak reset saat refresh) ────
      // Pakai joined_at siswa sebagai acuan — bukan reset ke durasi penuh
      let timeLeftSeconds = session.duration * 60; // default kalau belum ada data
      if (sudahJoin?.joined_at && session.started_at) {
        // Waktu yang sudah terpakai = sekarang - waktu siswa mulai (joined_at)
        const startedMs  = new Date(sudahJoin.joined_at).getTime();
        const elapsedSec = Math.floor((Date.now() - startedMs) / 1000);
        const remaining  = (session.duration * 60) - elapsedSec;
        timeLeftSeconds  = Math.max(0, remaining);
      }

      res.json({
        success: true,
        session: {
          id:            session.id,
          name:          session.name,
          mapel:         session.mapel,
          kelas:         session.kelas,
          duration:      session.duration,
          formUrl:       session.form_url,
          status:        session.status,
          tokenInterval: session.token_interval,
          secondsLeft,
          timeLeft:      timeLeftSeconds, // ← sisa waktu akurat untuk siswa ini
        },
        geo: sudahJoin ? null : undefined,
      });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/cbt/sessions/:id/submit — siswa submit
  app.post('/api/cbt/sessions/:id/submit', (req, res) => {
    try {
      const { userEmail } = req.body;
      if (!userEmail) return res.status(400).json({ success: false, error: 'userEmail wajib' });
      cbtDb.submitParticipant(req.params.id, userEmail);
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ANTI-CHEAT
  // ─────────────────────────────────────────────────────────────────────────────

  // POST /api/cbt/sessions/:id/cheat-log — log event dari browser siswa
  app.post('/api/cbt/sessions/:id/cheat-log', (req, res) => {
    try {
      const { userEmail, eventType, detail } = req.body;
      cbtDb.logCheatEvent(req.params.id, userEmail, eventType, detail);
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/cbt/sessions/:id/cheat-log
  app.get('/api/cbt/sessions/:id/cheat-log', (req, res) => {
    try {
      const logs = cbtDb.getCheatLog(req.params.id);
      res.json({ success: true, data: logs, total: logs.length });
    } catch(err) { handleError(res, err); }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SOAL
  // ─────────────────────────────────────────────────────────────────────────────

  // POST /api/cbt/sessions/:id/soal — import soal dari JSON MCP
  app.post('/api/cbt/sessions/:id/soal', (req, res) => {
    try {
      const { soal } = req.body;
      if (!soal || !Array.isArray(soal) || soal.length === 0) {
        return res.status(400).json({ success: false, error: 'Array soal wajib diisi' });
      }
      const count = cbtDb.importSoal(req.params.id, soal);
      res.json({ success: true, count, message: `${count} soal berhasil diimport` });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/cbt/sessions/:id/soal — untuk admin (dengan kunci)
  app.get('/api/cbt/sessions/:id/soal', (req, res) => {
    try {
      const soal = cbtDb.getSoal(req.params.id, true);
      res.json({ success: true, data: soal, count: soal.length });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/cbt/sessions/:id/soal/siswa — untuk siswa (tanpa kunci, diacak)
  app.get('/api/cbt/sessions/:id/soal/siswa', (req, res) => {
    try {
      const session = cbtDb.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ success: false, error: 'Sesi tidak ditemukan' });
      }

      // Untuk multi-ruang: session ini adalah soal_source dari paket
      // Status sesi bisa draft/ended — yang penting soalnya ada
      // Kalau bukan mode room, tetap validasi status
      const roomId = req.query.roomId;
      if (!roomId && session.status === 'draft') {
        return res.status(403).json({ success: false, error: 'Ujian belum dimulai' });
      }

      // Kalau ada roomId, validasi status ruang
      if (roomId) {
        const room = pkgDb.getRoomByToken ? null : null; // cek via getRoom
        const roomData = pkgDb.getRoom(roomId);
        if (roomData && roomData.status !== 'active') {
          return res.status(403).json({ success: false, error: 'Ruang ujian tidak aktif' });
        }
      }

      const userEmail = req.query.email || 'anonymous';
      const soal      = cbtDb.getSoalShuffled(req.params.id, userEmail);

      if (!soal.length) {
        return res.status(404).json({ success: false, error: 'Soal belum tersedia. Hubungi pengawas.' });
      }

      res.json({ success: true, data: soal, count: soal.length });
    } catch(err) { handleError(res, err); }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // JAWABAN
  // ─────────────────────────────────────────────────────────────────────────────

  // POST /api/cbt/sessions/:id/jawaban — simpan/update satu jawaban
  app.post('/api/cbt/sessions/:id/jawaban', (req, res) => {
    try {
      const { userEmail, nomor, jawaban } = req.body;
      if (!userEmail || !nomor) {
        return res.status(400).json({ success: false, error: 'userEmail dan nomor wajib' });
      }
      const result = cbtDb.saveJawaban(req.params.id, userEmail, nomor, jawaban);
      res.json({ success: true, ...result });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/cbt/sessions/:id/jawaban/:email — semua jawaban satu siswa
  app.get('/api/cbt/sessions/:id/jawaban/:email', (req, res) => {
    try {
      const jawaban = cbtDb.getJawabanSiswa(req.params.id, req.params.email);
      // Convert array ke map {nomor: jawaban}
      const map = {};
      jawaban.forEach(j => { map[j.nomor] = j.jawaban; });
      res.json({ success: true, data: map, raw: jawaban });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/cbt/sessions/:id/rekap — rekap nilai semua siswa (admin)
  app.get('/api/cbt/sessions/:id/rekap', (req, res) => {
    try {
      const rekap    = cbtDb.getRekap(req.params.id);
      const session  = cbtDb.getSession(req.params.id);
      res.json({ success: true, data: rekap, maxPoints: session?.max_points || 100 });
    } catch(err) { handleError(res, err); }
  });

  // PATCH /api/cbt/sessions/:id/jawaban/:email/:nomor/nilai — input nilai essay
  app.patch('/api/cbt/sessions/:id/jawaban/:email/:nomor/nilai', (req, res) => {
    try {
      const { nilai } = req.body;
      cbtDb.saveEssayNilai(req.params.id, req.params.email, parseInt(req.params.nomor), parseFloat(nilai));
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/cbt/sessions/:id/jawaban-semua — semua jawaban (admin, untuk review essay)
  app.get('/api/cbt/sessions/:id/jawaban-semua', (req, res) => {
    try {
      const data = cbtDb.getAllJawaban(req.params.id);
      res.json({ success: true, data });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/cbt/sessions/:id/export-sheets — export rekap nilai ke Google Sheets
  app.post('/api/cbt/sessions/:id/export-sheets', async (req, res) => {
    try {
      const { getDriveClient, getSheetsClient, handleError } = require('../helpers/auth');
      const session  = cbtDb.getSession(req.params.id);
      if (!session) return res.status(404).json({ success: false, error: 'Sesi tidak ditemukan' });

      const rekap    = cbtDb.getRekap(req.params.id);
      const soal     = cbtDb.getSoal(req.params.id, false);
      const parts    = cbtDb.getParticipants(req.params.id);
      const maxPts   = session.max_points || 100;

      // Gabungkan data peserta + rekap
      const rows = parts.map(p => {
        const r = rekap.find(r => r.user_email === p.user_email) || {};
        return {
          nama:        p.user_name  || '-',
          email:       p.user_email,
          status:      p.status     || '-',
          joined_at:   p.joined_at  || '-',
          total_dijawab: r.total_dijawab || 0,
          pg_benar:    r.pg_benar   || 0,
          total_nilai: r.total_nilai|| 0,
          persen:      maxPts > 0 ? Math.round((r.total_nilai||0) / maxPts * 100) : 0,
        };
      });

      const sheets   = await getSheetsClient();
      const drive    = await getDriveClient();
      const title    = `[CBT] ${session.name} — ${session.mapel} ${session.kelas}`;

      // Cek apakah file sudah ada (update, jangan buat baru terus)
      let spreadsheetId = null;
      const search = await drive.files.list({
        q: `name = '${title}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
        fields: 'files(id,name)',
      });
      if (search.data.files?.length > 0) {
        spreadsheetId = search.data.files[0].id;
      } else {
        const newFile = await sheets.spreadsheets.create({
          requestBody: { properties: { title } }
        });
        spreadsheetId = newFile.data.spreadsheetId;
      }

      // Header row
      const headers = ['No', 'Nama', 'Email', 'Status', 'Waktu Join', 'Dijawab', 'PG Benar', 'Total Nilai', 'Persentase (%)'];
      const dataRows = rows.map((r, i) => [
        i + 1, r.nama, r.email, r.status, r.joined_at,
        r.total_dijawab, r.pg_benar, r.total_nilai, r.persen,
      ]);

      // Clear dan tulis ulang
      await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Sheet1' });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Sheet1!A1',
        valueInputOption: 'RAW',
        requestBody: { values: [headers, ...dataRows] },
      });

      // Format header bold + freeze row 1
      const sheetId = 0;
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [
          { repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.2, green: 0.6, blue: 0.4 } } },
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          }},
          { updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          }},
        ]},
      });

      const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      res.json({ success: true, url: sheetUrl, rows: rows.length });
    } catch(err) { handleError(res, err); }
  });

};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Token Ruang (Multi-Ruang CBT)
// Menggunakan cbtDb yang sudah ada — tidak membuka koneksi SQLite baru
// ═══════════════════════════════════════════════════════════════════════════════
async function handleRoomToken({ room, userEmail, userName, req, res }) {
  if (room.status === 'draft')  return res.status(403).json({ success: false, error: 'Ruang ujian belum dimulai. Tunggu instruksi koordinator.' });
  if (room.status === 'ended') return res.status(403).json({ success: false, error: 'Ujian di ruang ini sudah selesai.' });

  const pkg = pkgDb.getPackage(room.package_id);
  if (!pkg || !pkg.soal_source) {
    return res.status(400).json({ success: false, error: 'Sumber soal paket tidak ditemukan. Hubungi koordinator.' });
  }

  // Validasi domain
  const emailLower = (userEmail || '').toLowerCase();
  if (emailLower) {
    const domain = emailLower.split('@')[1];
    if (domain !== 'karyabangsa.sch.id') {
      return res.status(403).json({ success: false, error: 'Hanya akun sekolah @karyabangsa.sch.id yang dapat mengikuti ujian.' });
    }
  }

  // Cek sudah submit — pakai cbtDb yang sudah ada
  const sudahJoin = emailLower ? cbtDb.getParticipantByEmail(pkg.soal_source, emailLower) : null;

  if (sudahJoin?.status === 'submitted') {
    return res.status(403).json({ success: false, error: 'Anda sudah mengumpulkan jawaban untuk ujian ini.', submitted: true });
  }

  // Cek kapasitas ruang
  if (!sudahJoin) {
    const allP     = cbtDb.getParticipants(pkg.soal_source);
    const inRoom   = allP.filter(p => p.room_id === room.id).length;
    if (inRoom >= room.max_siswa) {
      return res.status(403).json({ success: false, error: `Kapasitas ruang ${room.room_name} sudah penuh (${room.max_siswa} siswa).` });
    }
  }

  // Catat join — pakai cbtDb.joinSession dengan room_id
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '';
  if (emailLower) {
    if (!sudahJoin) {
      getIPLocation(ip).then(geo => {
        cbtDb.joinSession(pkg.soal_source, { userEmail: emailLower, userName: userName || '', ipAddress: ip, geo, roomId: room.id });
      }).catch(() => {
        cbtDb.joinSession(pkg.soal_source, { userEmail: emailLower, userName: userName || '', ipAddress: ip, geo: null, roomId: room.id });
      });
    } else {
      cbtDb.joinSession(pkg.soal_source, { userEmail: emailLower, userName: userName || '', ipAddress: ip, geo: null, roomId: room.id });
    }
  }

  // Hitung sisa waktu
  let timeLeftSeconds = pkg.duration * 60;
  if (sudahJoin?.joined_at) {
    const elapsed = Math.floor((Date.now() - new Date(sudahJoin.joined_at).getTime()) / 1000);
    timeLeftSeconds = Math.max(0, (pkg.duration * 60) - elapsed);
  }

  res.json({
    success: true, mode: 'room',
    room:    { id: room.id, name: room.room_name, packageId: pkg.id },
    session: {
      id:            pkg.soal_source,
      name:          pkg.name,
      mapel:         pkg.mapel,
      kelas:         pkg.kelas,
      duration:      pkg.duration,
      status:        room.status,
      tokenInterval: room.token_interval,
      timeLeft:      timeLeftSeconds,
      secondsLeft:   null,
    },
  });
}