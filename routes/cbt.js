// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: CBT MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

const cbtDb  = require('../db/cbt');
const pkgDb  = require('../db/package');
const { getClassroomClient, getAdminClient, handleError } = require('../helpers/auth');
const { DOMAIN } = require('../config');
const axios  = require('axios');
const { fixLatexInSoal } = require('../tools/gen_soal');

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


const ALLOWED_DOMAIN = String(DOMAIN || require('../config').SCHOOL_DOMAIN || 'karyabangsa.sch.id').toLowerCase();

function createHttpError(status, message, extra = {}) {
  const err = new Error(message);
  err.code  = status;
  Object.assign(err, extra);
  return err;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || '';
}

function assertAllowedSchoolEmail(email) {
  const emailLower = normalizeEmail(email);
  if (!emailLower) {
    throw createHttpError(400, 'Email peserta wajib diisi untuk validasi ujian.');
  }
  const domain = emailLower.split('@')[1];
  if (domain !== ALLOWED_DOMAIN) {
    throw createHttpError(403, `Hanya akun sekolah @${ALLOWED_DOMAIN} yang dapat mengikuti ujian ini.`);
  }
  return emailLower;
}

async function fetchCourseStudents(courseId) {
  const classroom = await getClassroomClient();
  const students  = [];
  let pageToken;
  do {
    const r = await classroom.courses.students.list({
      courseId,
      pageSize: 200,
      pageToken,
    });
    students.push(...(r.data.students || []));
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  return students;
}





async function ensureRosterMembership({ sessionId, courseId, email }) {
  if (!courseId) {
    throw createHttpError(400, 'Sesi belum dihubungkan ke Google Classroom. Hubungi admin atau pengawas.');
  }
  try {
    const roster = await getCachedRoster(sessionId, courseId);
    if (!roster.has(email)) {
      throw createHttpError(403, `Akun ${email} tidak terdaftar di kelas ini. Hubungi pengawas jika ada kesalahan.`);
    }
    return roster;
  } catch (err) {
    if (err.code) throw err;
    console.warn('[CBT] Classroom roster check gagal, tolak masuk:', err.message);
    throw createHttpError(503, 'Validasi peserta ke Google Classroom gagal. Coba lagi beberapa saat atau hubungi pengawas.');
  }
}

function ensureSessionParticipant(sessionId, userEmail, options = {}) {
  const {
    rejectIfSubmitted = false,
    allowEnded = false,
    requireJoined = true,
  } = options;

  const session = cbtDb.getSession(sessionId);
  if (!session) {
    throw createHttpError(404, 'Sesi tidak ditemukan');
  }
  if (session.status === 'draft') {
    throw createHttpError(403, 'Ujian belum dimulai. Tunggu instruksi pengawas.');
  }
  if (!allowEnded && session.status === 'ended') {
    throw createHttpError(403, 'Ujian sudah selesai.');
  }

  const emailLower  = assertAllowedSchoolEmail(userEmail);
  const participant = cbtDb.getParticipantByEmail(sessionId, emailLower);

  if (requireJoined && !participant) {
    throw createHttpError(403, 'Anda belum tervalidasi sebagai peserta ujian ini. Masuk kembali menggunakan token yang valid.');
  }
  if (rejectIfSubmitted && participant?.status === 'submitted') {
    throw createHttpError(403, 'Anda sudah mengumpulkan jawaban untuk ujian ini.', { submitted: true });
  }

  return { session, participant, emailLower };
}

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

    const students = await fetchCourseStudents(session.course_id);

    let synced = 0;
    for (const s of students) {
      const email = normalizeEmail(s.profile?.emailAddress);
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
    const emailLower = assertAllowedSchoolEmail(userEmail);

    // ── Cek token ruang (multi-ruang) dulu ─────────────────────────────────
    const room = pkgDb.getRoomByToken(tokenClean);
    if (room) {
      return handleRoomToken({ room, userEmail: emailLower, userName, req, res });
    }

    // ── Fallback: token sesi CBT lama ──────────────────────────────────────
    const session = cbtDb.getSessionByToken(tokenClean);
    if (!session) return res.status(404).json({ success: false, error: 'Token tidak valid atau sudah kadaluarsa' });
    if (session.status === 'draft') return res.status(403).json({ success: false, error: 'Ujian belum dimulai. Tunggu instruksi pengawas.' });
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

    // ── VALIDASI 2: Peserta harus terdaftar di roster Classroom ────────────
    try {
      await ensureRosterMembership({ sessionId: session.id, courseId: session.course_id, email: emailLower });
    } catch (err) {
      return res.status(err.code || 500).json({ success: false, error: err.message });
    }

    const sudahJoin = cbtDb.getParticipantByEmail(session.id, emailLower);

    // ── CEK SUBMIT: Tolak kalau siswa sudah kumpulkan ──────────────────────
    if (sudahJoin?.status === 'submitted') {
      return res.status(403).json({
        success: false,
        error: 'Anda sudah mengumpulkan jawaban untuk ujian ini. Silakan hubungi pengawas jika ada masalah.',
        submitted: true,
      });
    }

    // ── CATAT JOIN ─────────────────────────────────────────────────────────
    const ip = getClientIP(req);

    if (!sudahJoin) {
      getIPLocation(ip).then(geo => {
        cbtDb.joinSession(session.id, { userEmail: emailLower, userName, ipAddress: ip, geo });
      }).catch(() => {
        cbtDb.joinSession(session.id, { userEmail: emailLower, userName, ipAddress: ip, geo: null });
      });
    } else {
      cbtDb.joinSession(session.id, { userEmail: emailLower, userName, ipAddress: ip, geo: null });
    }

    const expiresAt   = session.token_expires_at ? new Date(session.token_expires_at) : null;
    const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : null;

    // ── HITUNG SISA WAKTU SISWA (supaya timer tidak reset saat refresh) ────
    let timeLeftSeconds = session.duration * 60;
    if (sudahJoin?.joined_at && session.started_at) {
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
        timeLeft:      timeLeftSeconds,
      },
      geo: sudahJoin ? null : undefined,
    });
  } catch(err) { handleError(res, err); }
});

// POST /api/cbt/sessions/:id/submit — siswa submit
app.post('/api/cbt/sessions/:id/submit', (req, res) => {
  try {
    const { userEmail } = req.body;
    const { emailLower, participant } = ensureSessionParticipant(req.params.id, userEmail);

    if (participant?.status === 'submitted') {
      return res.json({ success: true, message: 'Jawaban sudah pernah dikumpulkan.' });
    }

    cbtDb.submitParticipant(req.params.id, emailLower);
    res.json({ success: true });
  } catch(err) {
    res.status(err.code || 500).json({ success: false, error: err.message, submitted: err.submitted || false });
  }
});

  // ─────────────────────────────────────────────────────────────────────────────
  // ANTI-CHEAT
  // ─────────────────────────────────────────────────────────────────────────────

// POST /api/cbt/sessions/:id/cheat-log — log event dari browser siswa
app.post('/api/cbt/sessions/:id/cheat-log', (req, res) => {
  try {
    const { userEmail, eventType, detail } = req.body;
    const { emailLower } = ensureSessionParticipant(req.params.id, userEmail, { rejectIfSubmitted: true });
    if (!eventType) {
      return res.status(400).json({ success: false, error: 'eventType wajib diisi' });
    }
    cbtDb.logCheatEvent(req.params.id, emailLower, eventType, detail);
    res.json({ success: true });
  } catch(err) {
    res.status(err.code || 500).json({ success: false, error: err.message, submitted: err.submitted || false });
  }
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
      const count = cbtDb.importSoal(req.params.id, fixLatexInSoal(soal));
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

    const userEmail  = req.query.email;
    const emailLower = assertAllowedSchoolEmail(userEmail);
    const participant = cbtDb.getParticipantByEmail(req.params.id, emailLower);

    if (!participant) {
      return res.status(403).json({
        success: false,
        error: 'Anda belum tervalidasi sebagai peserta ujian ini. Masuk kembali menggunakan token yang valid.',
      });
    }
    
    if (participant.status === 'submitted') {
      return res.status(403).json({
        success: false,
        error: 'Anda sudah mengumpulkan jawaban untuk ujian ini.',
        submitted: true,
      });
    }

    const roomId = req.query.roomId;
    if (!roomId) {
      if (session.status === 'draft') {
        return res.status(403).json({ success: false, error: 'Ujian belum dimulai' });
      }
      if (session.status === 'ended') {
        return res.status(403).json({ success: false, error: 'Ujian sudah selesai' });
      }
    }

    if (roomId) {
      const roomData = pkgDb.getRoom(roomId);
      if (!roomData) {
        return res.status(404).json({ success: false, error: 'Ruang ujian tidak ditemukan' });
      }
      if (roomData.status !== 'active') {
        return res.status(403).json({ success: false, error: 'Ruang ujian tidak aktif' });
      }
      const pkg = pkgDb.getPackage(roomData.package_id);
      if (!pkg || String(pkg.soal_source) !== String(req.params.id)) {
        return res.status(403).json({ success: false, error: 'Ruang ujian tidak sesuai dengan sesi soal ini' });
      }
      if (participant.room_id && String(participant.room_id) !== String(roomId)) {
        return res.status(403).json({ success: false, error: 'Anda terdaftar di ruang ujian lain. Gunakan token ruang yang benar.' });
      }
    }

    const soal = cbtDb.getSoalShuffled(req.params.id, emailLower);

    if (!soal.length) {
      return res.status(404).json({ success: false, error: 'Soal belum tersedia. Hubungi pengawas.' });
    }

    res.json({ success: true, data: soal, count: soal.length });
  } catch(err) {
    res.status(err.code || 500).json({ success: false, error: err.message, submitted: err.submitted || false });
  }
});

  // ─────────────────────────────────────────────────────────────────────────────
  // JAWABAN
  // ─────────────────────────────────────────────────────────────────────────────

// POST /api/cbt/sessions/:id/jawaban — simpan/update satu jawaban
// Support offline sync: roomId bypass + grace period 5 menit setelah ended
const OFFLINE_GRACE_MS = 5 * 60 * 1000; // 5 menit grace period
app.post('/api/cbt/sessions/:id/jawaban', (req, res) => {
  try {
    const { userEmail, nomor, jawaban, roomId, savedAt } = req.body;
    if (!nomor) {
      return res.status(400).json({ success: false, error: 'nomor wajib diisi' });
    }

    const session = cbtDb.getSession(req.params.id);
    if (!session) return res.status(404).json({ success: false, error: 'Sesi tidak ditemukan' });

    // ── Validasi timestamp offline (savedAt dari client) ──
    if (savedAt) {
      const savedTime  = new Date(savedAt);
      const now        = Date.now();
      const savedMs    = savedTime.getTime();

      // Tolak kalau timestamp dari masa depan (> 30 detik tolerance)
      if (savedMs > now + 30000) {
        return res.status(400).json({ success: false, error: 'Timestamp jawaban tidak valid' });
      }

      // Kalau sesi sudah ended, cek grace period
      if (session.status === 'ended' && session.ended_at) {
        const endedMs = new Date(session.ended_at).getTime();
        if (savedMs > endedMs + OFFLINE_GRACE_MS) {
          return res.status(403).json({ success: false, error: 'Batas waktu grace period offline sudah lewat' });
        }
        // Dalam grace period — lanjut simpan
      }
    }

    // ── Jalur Multi-Ruang (roomId) — bypass cek session.status ──
    if (roomId) {
      const room = pkgDb.getRoomByRoomId ? pkgDb.getRoomByRoomId(roomId) : pkgDb.getRoom(roomId);
      if (!room) return res.status(404).json({ success: false, error: 'Ruang tidak ditemukan' });
      if (room.status !== 'active' && session.status === 'draft') {
        return res.status(403).json({ success: false, error: 'Ruang ujian tidak aktif' });
      }
      const emailLower = userEmail?.toLowerCase?.()?.trim();
      if (!emailLower) return res.status(400).json({ success: false, error: 'Email wajib diisi' });
      const result = cbtDb.saveJawaban(req.params.id, emailLower, nomor, jawaban);
      return res.json({ success: true, ...result });
    }

    // ── Jalur biasa (sesi CBT normal) ──
    const { emailLower } = ensureSessionParticipant(req.params.id, userEmail, { rejectIfSubmitted: true });
    const result = cbtDb.saveJawaban(req.params.id, emailLower, nomor, jawaban);
    res.json({ success: true, ...result });
  } catch(err) {
    res.status(err.code || 500).json({ success: false, error: err.message, submitted: err.submitted || false });
  }
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

      // ── Share ke group guru ───────────────────────────────────────────────
      const _cfg2 = require('../config');
      const shareTarget2 = _cfg2.TEACHER_GROUP;
      let sharedTo2 = null;
      if (shareTarget2) {
        try {
          await drive.permissions.create({
            fileId: spreadsheetId,
            sendNotificationEmail: false,
            requestBody: {
              type:         'group',
              role:         'reader',
              emailAddress: shareTarget2,
            },
          });
          sharedTo2 = shareTarget2;
        } catch(shareErr) {
          console.warn('[cbt export] Share gagal:', shareErr.message);
        }
      }

      res.json({ success: true, url: sheetUrl, rows: rows.length, shared_to: sharedTo2 });
    } catch(err) { handleError(res, err); }
  });

};    
// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Token Ruang (Multi-Ruang CBT)
// Menggunakan cbtDb yang sudah ada — tidak membuka koneksi SQLite baru
// ═══════════════════════════════════════════════════════════════════════════════
async function handleRoomToken({ room, userEmail, userName, req, res }) {
  if (room.status === 'draft') return res.status(403).json({ success: false, error: 'Ruang ujian belum dimulai. Tunggu instruksi koordinator.' });
  if (room.status === 'ended') return res.status(403).json({ success: false, error: 'Ujian di ruang ini sudah selesai.' });

  const pkg = pkgDb.getPackage(room.package_id);
  if (!pkg || !pkg.soal_source) {
    return res.status(400).json({ success: false, error: 'Sumber soal paket tidak ditemukan. Hubungi koordinator.' });
  }

  const sourceSession = cbtDb.getSession(pkg.soal_source);
  if (!sourceSession) {
    return res.status(404).json({ success: false, error: 'Sesi sumber soal paket tidak ditemukan. Hubungi koordinator.' });
  }

  let emailLower;
  try {
    emailLower = assertAllowedSchoolEmail(userEmail);
  } catch (err) {
    return res.status(err.code || 500).json({ success: false, error: err.message });
  }

  try {
    await ensureRosterMembership({
      sessionId: sourceSession.id,
      courseId: sourceSession.course_id,
      email: emailLower,
    });
  } catch (err) {
    return res.status(err.code || 500).json({ success: false, error: err.message });
  }

  const sudahJoin = cbtDb.getParticipantByEmail(pkg.soal_source, emailLower);

  if (sudahJoin?.status === 'submitted') {
    return res.status(403).json({
      success: false,
      error: 'Anda sudah mengumpulkan jawaban untuk ujian ini.',
      submitted: true,
    });
  }

  if (sudahJoin?.room_id && String(sudahJoin.room_id) !== String(room.id)) {
    return res.status(403).json({
      success: false,
      error: 'Anda sudah terdaftar di ruang lain. Gunakan token ruang yang sesuai.',
    });
  }

  if (!sudahJoin) {
    const allP   = cbtDb.getParticipants(pkg.soal_source);
    const inRoom = allP.filter(p => String(p.room_id) === String(room.id)).length;
    if (inRoom >= room.max_siswa) {
      return res.status(403).json({
        success: false,
        error: `Kapasitas ruang ${room.room_name} sudah penuh (${room.max_siswa} siswa).`,
      });
    }
  }

  const ip = getClientIP(req);
  if (!sudahJoin) {
    getIPLocation(ip).then(geo => {
      cbtDb.joinSession(pkg.soal_source, {
        userEmail: emailLower,
        userName: userName || '',
        ipAddress: ip,
        geo,
        roomId: room.id,
      });
    }).catch(() => {
      cbtDb.joinSession(pkg.soal_source, {
        userEmail: emailLower,
        userName: userName || '',
        ipAddress: ip,
        geo: null,
        roomId: room.id,
      });
    });
  } else {
    cbtDb.joinSession(pkg.soal_source, {
      userEmail: emailLower,
      userName: userName || '',
      ipAddress: ip,
      geo: null,
      roomId: room.id,
    });
  }

  let timeLeftSeconds = pkg.duration * 60;
  if (sudahJoin?.joined_at) {
    const elapsed = Math.floor((Date.now() - new Date(sudahJoin.joined_at).getTime()) / 1000);
    timeLeftSeconds = Math.max(0, (pkg.duration * 60) - elapsed);
  }

  res.json({
    success: true,
    mode: 'room',
    room: { id: room.id, name: room.room_name, packageId: pkg.id },
    session: {
      id: pkg.soal_source,
      name: pkg.name,
      mapel: pkg.mapel,
      kelas: pkg.kelas,
      duration: pkg.duration,
      status: room.status,
      tokenInterval: room.token_interval,
      timeLeft: timeLeftSeconds,
      secondsLeft: null,
    },
  });
}