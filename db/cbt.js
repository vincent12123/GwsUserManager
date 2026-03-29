// ═══════════════════════════════════════════════════════════════════════════════
// DB: CBT — Sesi Ujian, Token, Peserta, Anti-cheat Log
// ═══════════════════════════════════════════════════════════════════════════════

const Database = require('better-sqlite3');
const path     = require('path');

const db = new Database(path.join(__dirname, '..', 'cbt.db'));

// Aktifkan WAL mode untuk performa
db.pragma('journal_mode = WAL');

// ── MIGRASI — tambah kolom baru kalau belum ada ───────────────────────────────
const existingCols = db.prepare(`PRAGMA table_info(cbt_sessions)`).all().map(c => c.name);
if (existingCols.length > 0) {
  // Tabel sudah ada, cek kolom baru
  if (!existingCols.includes('token_interval')) {
    db.exec(`ALTER TABLE cbt_sessions ADD COLUMN token_interval INTEGER DEFAULT 0`);
  }
  if (!existingCols.includes('token_expires_at')) {
    db.exec(`ALTER TABLE cbt_sessions ADD COLUMN token_expires_at TEXT`);
  }
}

// ── TABEL SESI ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS cbt_sessions (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    mapel           TEXT NOT NULL,
    kelas           TEXT NOT NULL,
    course_id       TEXT,
    form_url        TEXT,
    form_id         TEXT,
    token           TEXT UNIQUE NOT NULL,
    token_interval  INTEGER DEFAULT 0,
    token_expires_at TEXT,
    duration        INTEGER DEFAULT 90,
    status          TEXT DEFAULT 'draft',
    scheduled_at    TEXT,
    started_at      TEXT,
    ended_at        TEXT,
    max_points      INTEGER DEFAULT 100,
    created_by      TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS cbt_participants (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    user_email  TEXT NOT NULL,
    user_name   TEXT,
    joined_at   TEXT,
    submitted_at TEXT,
    ip_address  TEXT,
    geo_country TEXT,
    geo_region  TEXT,
    geo_city    TEXT,
    geo_isp     TEXT,
    risk_level  TEXT DEFAULT 'safe',
    status      TEXT DEFAULT 'enrolled',
    UNIQUE(session_id, user_email)
  );

  CREATE TABLE IF NOT EXISTS cbt_cheat_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    user_email  TEXT,
    event_type  TEXT NOT NULL,
    detail      TEXT,
    logged_at   TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS cbt_soal (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    nomor       INTEGER NOT NULL,
    tipe        TEXT NOT NULL DEFAULT 'PG',
    soal        TEXT NOT NULL,
    opsi_a      TEXT,
    opsi_b      TEXT,
    opsi_c      TEXT,
    opsi_d      TEXT,
    kunci       TEXT,
    bobot       INTEGER DEFAULT 1,
    pembahasan  TEXT,
    UNIQUE(session_id, nomor)
  );

  CREATE TABLE IF NOT EXISTS cbt_jawaban (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL,
    user_email   TEXT NOT NULL,
    nomor        INTEGER NOT NULL,
    jawaban      TEXT,
    is_correct   INTEGER,
    nilai        REAL DEFAULT 0,
    saved_at     TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(session_id, user_email, nomor)
  );
`);

// ── INDEX untuk performa 200+ siswa ujian bersamaan ──────────────────────────
// HARUS setelah semua CREATE TABLE selesai
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_jawaban_session_email
    ON cbt_jawaban(session_id, user_email);

  CREATE INDEX IF NOT EXISTS idx_participants_session_email
    ON cbt_participants(session_id, user_email);

  CREATE INDEX IF NOT EXISTS idx_cheat_session_email
    ON cbt_cheat_log(session_id, user_email);

  CREATE INDEX IF NOT EXISTS idx_soal_session
    ON cbt_soal(session_id);

  CREATE INDEX IF NOT EXISTS idx_sessions_token
    ON cbt_sessions(token);

  CREATE INDEX IF NOT EXISTS idx_sessions_status
    ON cbt_sessions(status);
`);

// ── HELPERS ───────────────────────────────────────────────────────────────────

function generateToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let token = '';
  for (let i = 0; i < 6; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
}

function generateId() {
  return 'cbt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

// Hitung token_expires_at berdasarkan interval (menit)
function calcExpiry(intervalMinutes) {
  if (!intervalMinutes || intervalMinutes === 0) return null; // 0 = permanen
  return new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();
}

// Rotate token — buat token baru, update expiry
function rotateToken(sessionId) {
  const session = getSession(sessionId);
  if (!session) return null;

  let token = generateToken();
  while (db.prepare('SELECT id FROM cbt_sessions WHERE token = ? AND id != ?').get(token, sessionId)) {
    token = generateToken();
  }
  const expiresAt = calcExpiry(session.token_interval);
  db.prepare('UPDATE cbt_sessions SET token = ?, token_expires_at = ? WHERE id = ?')
    .run(token, expiresAt, sessionId);
  return { token, expiresAt };
}

// Auto-rotate scheduler — panggil saat server start
const rotateTimers = new Map();

function scheduleRotation(sessionId) {
  const session = getSession(sessionId);
  if (!session || session.status !== 'active') return;
  if (!session.token_interval || session.token_interval === 0) return;

  // Hitung kapan harus rotate berikutnya
  const now        = Date.now();
  const expiresAt  = session.token_expires_at ? new Date(session.token_expires_at).getTime() : now;
  const delay      = Math.max(expiresAt - now, 1000);

  // Clear timer lama kalau ada
  if (rotateTimers.has(sessionId)) clearTimeout(rotateTimers.get(sessionId));

  const timer = setTimeout(() => {
    const s = getSession(sessionId);
    if (!s || s.status !== 'active') return;
    rotateToken(sessionId);
    scheduleRotation(sessionId); // jadwalkan rotasi berikutnya
  }, delay);

  rotateTimers.set(sessionId, timer);
}

function stopRotation(sessionId) {
  if (rotateTimers.has(sessionId)) {
    clearTimeout(rotateTimers.get(sessionId));
    rotateTimers.delete(sessionId);
  }
}

// ── SESSION CRUD ──────────────────────────────────────────────────────────────

function createSession({ name, mapel, kelas, courseId, duration = 90, scheduledAt, tokenInterval = 0, createdBy }) {
  const id        = generateId();
  let token       = generateToken();
  while (db.prepare('SELECT id FROM cbt_sessions WHERE token = ?').get(token)) {
    token = generateToken();
  }
  const expiresAt = calcExpiry(tokenInterval);
  db.prepare(`
    INSERT INTO cbt_sessions (id, name, mapel, kelas, course_id, token, token_interval, token_expires_at, duration, scheduled_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, mapel, kelas, courseId || null, token, tokenInterval || 0, expiresAt, duration, scheduledAt || null, createdBy || null);
  return getSession(id);
}

function getSession(id) {
  return db.prepare('SELECT * FROM cbt_sessions WHERE id = ?').get(id);
}

function getSessionByToken(token) {
  return db.prepare('SELECT * FROM cbt_sessions WHERE token = ?').get(token);
}

function getAllSessions() {
  return db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM cbt_soal WHERE session_id = s.id) as soal_count
    FROM cbt_sessions s
    ORDER BY s.created_at DESC
  `).all();
}

// Ambil sesi yang punya jawaban — termasuk sesi yang sudah dihapus dari cbt_sessions
// Dipakai oleh nilai-essay.html agar data tidak hilang walau sesi dihapus
function getSessionsWithAnswers() {
  return db.prepare(`
    SELECT
      j.session_id                                  as id,
      COALESCE(s.name,  '(Sesi Dihapus: ' || j.session_id || ')') as name,
      COALESCE(s.mapel, '—')                        as mapel,
      COALESCE(s.kelas, '—')                        as kelas,
      COALESCE(s.status,'deleted')                  as status,
      COALESCE(s.duration, 90)                      as duration,
      COALESCE(s.created_at, MIN(j.saved_at))       as created_at,
      COUNT(DISTINCT j.user_email)                  as total_siswa,
      COUNT(j.id)                                   as total_jawaban,
      (SELECT COUNT(*) FROM cbt_soal
        WHERE session_id = j.session_id
          AND (tipe = 'ES' OR tipe = 'ESSAY'))      as essay_soal_count,
      SUM(CASE WHEN so.tipe IN ('ES','ESSAY') THEN 1 ELSE 0 END) as essay_jawaban_count
    FROM cbt_jawaban j
    LEFT JOIN cbt_sessions s ON s.id = j.session_id
    LEFT JOIN cbt_soal so    ON so.session_id = j.session_id AND so.nomor = j.nomor
    GROUP BY j.session_id
    ORDER BY MAX(j.saved_at) DESC
  `).all();
}

function updateSession(id, fields) {
  const allowed = ['name','mapel','kelas','course_id','form_url','form_id','token',
                   'token_interval','token_expires_at','duration','status',
                   'scheduled_at','started_at','ended_at','max_points'];
  const sets    = Object.keys(fields).filter(k => allowed.includes(k)).map(k => `${k} = ?`);
  if (!sets.length) return getSession(id);
  const vals = Object.keys(fields).filter(k => allowed.includes(k)).map(k => fields[k]);
  db.prepare(`UPDATE cbt_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return getSession(id);
}

function deleteSession(id) {
  db.prepare('DELETE FROM cbt_cheat_log WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM cbt_participants WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM cbt_sessions WHERE id = ?').run(id);
}

// Cek jawaban essay yang belum dinilai — dipakai sebelum hapus sesi
function checkUngradedEssay(sessionId) {
  const essayNomors = db.prepare(`
    SELECT nomor FROM cbt_soal
    WHERE session_id = ? AND (tipe = 'ES' OR tipe = 'ESSAY')
  `).all(sessionId).map(s => s.nomor);

  if (!essayNomors.length) {
    return { hasUngraded: false, totalEssay: 0, gradedCount: 0, ungradedCount: 0, siswaList: [] };
  }

  const ph       = essayNomors.map(() => '?').join(',');
  const allEssay = db.prepare(`
    SELECT j.user_email, p.user_name, j.nomor, j.nilai
    FROM cbt_jawaban j
    LEFT JOIN cbt_participants p ON p.session_id = j.session_id AND p.user_email = j.user_email
    WHERE j.session_id = ? AND j.nomor IN (${ph})
  `).all(sessionId, ...essayNomors);

  const ungraded  = allEssay.filter(j => j.nilai === null || j.nilai === 0);
  const siswaSet  = {};
  ungraded.forEach(j => { siswaSet[j.user_email] = j.user_name || j.user_email; });

  return {
    hasUngraded:   ungraded.length > 0,
    totalEssay:    allEssay.length,
    gradedCount:   allEssay.length - ungraded.length,
    ungradedCount: ungraded.length,
    siswaList:     Object.values(siswaSet).slice(0, 10),
  };
}

function startSession(id) {
  const session = getSession(id);
  if (!session) return null;
  // Set first expiry saat start
  const expiresAt = calcExpiry(session.token_interval);
  db.prepare(`UPDATE cbt_sessions SET status = 'active', started_at = datetime('now','localtime'), token_expires_at = ? WHERE id = ?`)
    .run(expiresAt, id);
  const updated = getSession(id);
  // Jadwalkan rotasi kalau interval > 0
  if (session.token_interval > 0) scheduleRotation(id);
  return updated;
}

function endSession(id) {
  stopRotation(id);
  db.prepare(`UPDATE cbt_sessions SET status = 'ended', ended_at = datetime('now','localtime') WHERE id = ?`).run(id);
  return getSession(id);
}

// ── PARTICIPANTS ──────────────────────────────────────────────────────────────

function joinSession(sessionId, { userEmail, userName, ipAddress, geo, roomId }) {
  db.prepare(`
    INSERT INTO cbt_participants (session_id, room_id, user_email, user_name, joined_at, ip_address, geo_country, geo_region, geo_city, geo_isp, risk_level, status)
    VALUES (?, ?, ?, ?, datetime('now','localtime'), ?, ?, ?, ?, ?, ?, 'active')
    ON CONFLICT(session_id, user_email) DO UPDATE SET
      joined_at   = datetime('now','localtime'),
      ip_address  = excluded.ip_address,
      geo_country = excluded.geo_country,
      geo_region  = excluded.geo_region,
      geo_city    = excluded.geo_city,
      geo_isp     = excluded.geo_isp,
      risk_level  = excluded.risk_level,
      room_id     = COALESCE(excluded.room_id, cbt_participants.room_id),
      status      = CASE WHEN cbt_participants.status = 'submitted' THEN 'submitted' ELSE 'active' END
  `).run(sessionId, roomId || null, userEmail, userName || null, ipAddress || null,
    geo?.country || null, geo?.region || null, geo?.city || null,
    geo?.isp || null, geo?.riskLevel || 'unknown');
}

function submitParticipant(sessionId, userEmail) {
  db.prepare(`
    UPDATE cbt_participants SET status = 'submitted', submitted_at = datetime('now','localtime')
    WHERE session_id = ? AND user_email = ?
  `).run(sessionId, userEmail);
}

function getParticipants(sessionId) {
  return db.prepare('SELECT * FROM cbt_participants WHERE session_id = ? ORDER BY joined_at').all(sessionId);
}

// Cek apakah 1 user sudah pernah join — dipakai validate-token untuk skip roster check
// Return: { id, status, joined_at, submitted_at } atau null
function getParticipantByEmail(sessionId, userEmail) {
  return db.prepare(
    'SELECT id, status, joined_at, submitted_at FROM cbt_participants WHERE session_id = ? AND user_email = ?'
  ).get(sessionId, (userEmail || '').toLowerCase()) || null;
}

// ── ANTI-CHEAT LOG ────────────────────────────────────────────────────────────

function logCheatEvent(sessionId, userEmail, eventType, detail) {
  db.prepare(`
    INSERT INTO cbt_cheat_log (session_id, user_email, event_type, detail)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, userEmail || null, eventType, detail || null);
}

function getCheatLog(sessionId) {
  return db.prepare('SELECT * FROM cbt_cheat_log WHERE session_id = ? ORDER BY logged_at DESC').all(sessionId);
}

// ── STATS ─────────────────────────────────────────────────────────────────────

function getSessionStats(sessionId) {
  const total     = db.prepare('SELECT COUNT(*) as n FROM cbt_participants WHERE session_id = ?').get(sessionId)?.n || 0;
  const active    = db.prepare(`SELECT COUNT(*) as n FROM cbt_participants WHERE session_id = ? AND status = 'active'`).get(sessionId)?.n || 0;
  const submitted = db.prepare(`SELECT COUNT(*) as n FROM cbt_participants WHERE session_id = ? AND status = 'submitted'`).get(sessionId)?.n || 0;
  const risky     = db.prepare(`SELECT COUNT(*) as n FROM cbt_participants WHERE session_id = ? AND risk_level IN ('high','overseas','vpn')`).get(sessionId)?.n || 0;
  const cheats    = db.prepare('SELECT COUNT(*) as n FROM cbt_cheat_log WHERE session_id = ?').get(sessionId)?.n || 0;
  return { total, active, submitted, notJoined: total - active - submitted, risky, cheats };
}

// ── SOAL ──────────────────────────────────────────────────────────────────────

function importSoal(sessionId, soalArr) {
  // Hapus soal lama dulu
  db.prepare('DELETE FROM cbt_soal WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM cbt_jawaban WHERE session_id = ?').run(sessionId);

  const ins = db.prepare(`
    INSERT INTO cbt_soal (session_id, nomor, tipe, soal, opsi_a, opsi_b, opsi_c, opsi_d, kunci, bobot, pembahasan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    for (const s of items) {
      ins.run(
        sessionId, s.no, (s.tipe || 'PG').toUpperCase(),
        s.soal,
        s.opsi?.A || null, s.opsi?.B || null, s.opsi?.C || null, s.opsi?.D || null,
        s.kunci || null,
        s.bobot || 1,
        s.pembahasan || null
      );
    }
  });
  insertMany(soalArr);
}

// Append soal tanpa hapus yang sudah ada (dipakai oleh Bank Soal → Sesi)
function appendSoal(sessionId, soalArr) {
  const ins = db.prepare(`
    INSERT INTO cbt_soal (session_id, nomor, tipe, soal, opsi_a, opsi_b, opsi_c, opsi_d, kunci, bobot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items) => {
    for (const s of items) {
      ins.run(
        sessionId,
        s.no || s.nomor,
        (s.tipe || 'PG').toUpperCase(),
        s.soal,
        s.opsi?.A || s.opsi_a || null,
        s.opsi?.B || s.opsi_b || null,
        s.opsi?.C || s.opsi_c || null,
        s.opsi?.D || s.opsi_d || null,
        s.kunci || null,
        s.bobot || 1
      );
    }
  });
  insertMany(soalArr);
}

function getSoal(sessionId, withKunci = true) {
  const rows = db.prepare('SELECT * FROM cbt_soal WHERE session_id = ? ORDER BY nomor').all(sessionId);
  return rows.map(r => {
    const s = {
      id: r.id, nomor: r.nomor, tipe: r.tipe, soal: r.soal, bobot: r.bobot,
      opsi: r.tipe === 'PG' ? { A: r.opsi_a, B: r.opsi_b, C: r.opsi_c, D: r.opsi_d } : null,
    };
    if (withKunci) { s.kunci = r.kunci; s.pembahasan = r.pembahasan; }
    return s;
  });
}

// Randomize soal per siswa — Fisher-Yates shuffle
// Seed dari email siswa agar urutan konsisten kalau refresh
function getSoalShuffled(sessionId, userEmail) {
  const rows = db.prepare('SELECT * FROM cbt_soal WHERE session_id = ? ORDER BY nomor').all(sessionId);

  // Buat seed dari email untuk konsistensi (siswa yang sama selalu dapat urutan sama)
  let seed = 0;
  for (let i = 0; i < userEmail.length; i++) seed += userEmail.charCodeAt(i);
  seed = seed * 9301 + 49297;

  function seededRand() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  // Shuffle array soal
  const shuffled = [...rows];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(seededRand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Juga acak opsi PG per soal (A/B/C/D diacak)
  return shuffled.map((r, displayIdx) => {
    let opsi = null;
    if (r.tipe === 'PG') {
      const keys    = ['A', 'B', 'C', 'D'].filter(k => r[`opsi_${k.toLowerCase()}`]);
      const vals    = keys.map(k => r[`opsi_${k.toLowerCase()}`]);
      // Acak urutan opsi tapi track kunci baru
      for (let i = vals.length - 1; i > 0; i--) {
        const j = Math.floor(seededRand() * (i + 1));
        [vals[i], vals[j]] = [vals[j], vals[i]];
        [keys[i], keys[j]] = [keys[j], keys[i]];
      }
      opsi = {};
      ['A', 'B', 'C', 'D'].forEach((k, i) => { if (vals[i] !== undefined) opsi[k] = vals[i]; });
    }
    return {
      id:           r.id,
      nomor:        r.nomor,        // nomor asli untuk auto-grade
      displayNomor: displayIdx + 1, // nomor tampilan (urutan acak)
      tipe:         r.tipe,
      soal:         r.soal,
      bobot:        r.bobot,
      opsi,
    };
  });
}

function getSoalCount(sessionId) {
  return db.prepare('SELECT COUNT(*) as n FROM cbt_soal WHERE session_id = ?').get(sessionId)?.n || 0;
}

// ── JAWABAN ───────────────────────────────────────────────────────────────────

function saveJawaban(sessionId, userEmail, nomor, jawaban) {
  // Ambil soal untuk auto-grade PG
  const soal = db.prepare('SELECT * FROM cbt_soal WHERE session_id = ? AND nomor = ?').get(sessionId, nomor);
  let isCorrect = null;
  let nilai     = 0;

  if (soal && soal.tipe === 'PG' && soal.kunci) {
    isCorrect = jawaban?.trim().toUpperCase() === soal.kunci.trim().toUpperCase() ? 1 : 0;
    nilai     = isCorrect ? (soal.bobot || 1) : 0;
  }

  db.prepare(`
    INSERT INTO cbt_jawaban (session_id, user_email, nomor, jawaban, is_correct, nilai, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(session_id, user_email, nomor) DO UPDATE SET
      jawaban   = excluded.jawaban,
      is_correct = excluded.is_correct,
      nilai     = excluded.nilai,
      saved_at  = excluded.saved_at
  `).run(sessionId, userEmail, nomor, jawaban || null, isCorrect, nilai);

  return { isCorrect, nilai };
}

function saveEssayNilai(sessionId, userEmail, nomor, nilai) {
  db.prepare(`
    UPDATE cbt_jawaban SET nilai = ? WHERE session_id = ? AND user_email = ? AND nomor = ?
  `).run(nilai, sessionId, userEmail, nomor);
}

function getJawabanSiswa(sessionId, userEmail) {
  return db.prepare('SELECT * FROM cbt_jawaban WHERE session_id = ? AND user_email = ? ORDER BY nomor')
    .all(sessionId, userEmail);
}

function getAllJawaban(sessionId) {
  return db.prepare(`
    SELECT j.*, s.soal as soal_text, s.kunci, s.tipe, s.bobot
    FROM cbt_jawaban j
    JOIN cbt_soal s ON s.session_id = j.session_id AND s.nomor = j.nomor
    WHERE j.session_id = ?
    ORDER BY j.user_email, j.nomor
  `).all(sessionId);
}

function getRekap(sessionId) {
  // Rekap nilai per siswa
  return db.prepare(`
    SELECT
      user_email,
      COUNT(*) as total_dijawab,
      SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as pg_benar,
      SUM(nilai) as total_nilai
    FROM cbt_jawaban
    WHERE session_id = ?
    GROUP BY user_email
    ORDER BY total_nilai DESC
  `).all(sessionId);
}

module.exports = {
  createSession, getSession, getSessionByToken, getAllSessions, getSessionsWithAnswers,
  updateSession, deleteSession, startSession, endSession, checkUngradedEssay,
  rotateToken, scheduleRotation, stopRotation,
  joinSession, submitParticipant, getParticipants, getParticipantByEmail,
  logCheatEvent, getCheatLog, getSessionStats,
  importSoal, appendSoal, getSoal, getSoalShuffled, getSoalCount,
  saveJawaban, saveEssayNilai, getJawabanSiswa, getAllJawaban, getRekap,
  // Ekspor instance db agar modul lain (bank.js, sspr.js) bisa pakai koneksi yang sama
  _db: db,
};