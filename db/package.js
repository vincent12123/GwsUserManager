// ═══════════════════════════════════════════════════════════════════════════════
// DB: CBT PACKAGE & ROOMS
// Multi-ruang ujian — 1 paket soal → banyak ruang terpisah
// ═══════════════════════════════════════════════════════════════════════════════

const Database = require('better-sqlite3');
const path     = require('path');
const { randomUUID } = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'cbt.db');
const db      = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS cbt_packages (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    mapel         TEXT NOT NULL,
    kelas         TEXT,
    duration      INTEGER DEFAULT 90,
    course_id     TEXT,
    soal_source   TEXT,
    status        TEXT DEFAULT 'draft',
    created_at    TEXT DEFAULT (datetime('now','localtime')),
    started_at    TEXT,
    ended_at      TEXT
  );

  CREATE TABLE IF NOT EXISTS cbt_rooms (
    id               TEXT PRIMARY KEY,
    package_id       TEXT NOT NULL REFERENCES cbt_packages(id) ON DELETE CASCADE,
    room_name        TEXT NOT NULL,
    token            TEXT UNIQUE,
    token_interval   INTEGER DEFAULT 0,
    token_expires_at TEXT,
    pengawas_name    TEXT,
    pengawas_email   TEXT,
    pengawas_token   TEXT UNIQUE,
    max_siswa        INTEGER DEFAULT 40,
    status           TEXT DEFAULT 'draft',
    started_at       TEXT,
    ended_at         TEXT,
    created_at       TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_rooms_package ON cbt_rooms(package_id);
  CREATE INDEX IF NOT EXISTS idx_rooms_token   ON cbt_rooms(token);
  CREATE INDEX IF NOT EXISTS idx_rooms_ptoken  ON cbt_rooms(pengawas_token);
`);

// Tambah room_id ke tabel existing kalau belum ada
try {
  db.exec(`ALTER TABLE cbt_participants ADD COLUMN room_id TEXT`);
} catch(_) {}
try {
  db.exec(`ALTER TABLE cbt_jawaban ADD COLUMN room_id TEXT`);
} catch(_) {}

// ── Helper: generate token unik ───────────────────────────────────────────────
function genToken(prefix = '') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let t = prefix;
  while (t.length < 6) t += chars[Math.floor(Math.random() * chars.length)];
  return t.slice(0, 6);
}

function uniqueToken(column = 'token') {
  let t, exists;
  do {
    t = genToken();
    exists = db.prepare(`SELECT id FROM cbt_rooms WHERE ${column} = ?`).get(t);
  } while (exists);
  return t;
}

function uniquePengawasToken() {
  let t, exists;
  do {
    t = 'P' + genToken().slice(1);
    exists = db.prepare(`SELECT id FROM cbt_rooms WHERE pengawas_token = ?`).get(t);
  } while (exists);
  return t;
}

// ══════════════════════════════════════════════════════════════════════════════
// PACKAGES
// ══════════════════════════════════════════════════════════════════════════════

function createPackage({ name, mapel, kelas, duration, courseId, soalSource }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO cbt_packages (id, name, mapel, kelas, duration, course_id, soal_source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, mapel, kelas || '', parseInt(duration) || 90, courseId || null, soalSource || null);
  return getPackage(id);
}

function getPackage(id) {
  const pkg   = db.prepare(`SELECT * FROM cbt_packages WHERE id = ?`).get(id);
  if (!pkg) return null;
  pkg.rooms   = getRooms(id);
  return pkg;
}

function getAllPackages() {
  const pkgs  = db.prepare(`SELECT * FROM cbt_packages ORDER BY created_at DESC`).all();
  return pkgs.map(p => {
    const rooms = getRooms(p.id);
    const total = rooms.reduce((s, r) => s + (r._joined || 0), 0);
    return { ...p, rooms, totalRooms: rooms.length, totalJoined: total };
  });
}

function updatePackage(id, fields) {
  const allowed = ['name', 'mapel', 'kelas', 'duration', 'course_id', 'soal_source'];
  const sets    = Object.keys(fields).filter(k => allowed.includes(k)).map(k => `${k} = ?`);
  if (!sets.length) return getPackage(id);
  db.prepare(`UPDATE cbt_packages SET ${sets.join(', ')} WHERE id = ?`)
    .run(...Object.keys(fields).filter(k => allowed.includes(k)).map(k => fields[k]), id);
  return getPackage(id);
}

function deletePackage(id) {
  db.prepare(`DELETE FROM cbt_packages WHERE id = ?`).run(id);
}

function startAllRooms(packageId) {
  const rooms = getRooms(packageId);
  const startTx = db.transaction(() => {
    rooms.forEach(r => {
      if (r.status === 'draft') {
        const token = r.token || uniqueToken();
        const pToken = r.pengawas_token || uniquePengawasToken();
        db.prepare(`
          UPDATE cbt_rooms
          SET status = 'active', started_at = datetime('now','localtime'), token = ?, pengawas_token = ?
          WHERE id = ?
        `).run(token, pToken, r.id);
      }
    });
    db.prepare(`
      UPDATE cbt_packages SET status = 'active', started_at = datetime('now','localtime') WHERE id = ?
    `).run(packageId);
  });
  startTx();
  return getPackage(packageId);
}

function endAllRooms(packageId) {
  db.prepare(`
    UPDATE cbt_rooms SET status = 'ended', ended_at = datetime('now','localtime') WHERE package_id = ?
  `).run(packageId);
  db.prepare(`
    UPDATE cbt_packages SET status = 'ended', ended_at = datetime('now','localtime') WHERE id = ?
  `).run(packageId);
  return getPackage(packageId);
}

// ══════════════════════════════════════════════════════════════════════════════
// ROOMS
// ══════════════════════════════════════════════════════════════════════════════

function createRoom(packageId, { roomName, pengawasName, pengawasEmail, maxSiswa, tokenInterval }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO cbt_rooms (id, package_id, room_name, pengawas_name, pengawas_email, max_siswa, token_interval)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, packageId, roomName, pengawasName || '', pengawasEmail || '', parseInt(maxSiswa) || 40, parseInt(tokenInterval) || 0);
  return getRoom(id);
}

function getRoom(id) {
  return db.prepare(`SELECT * FROM cbt_rooms WHERE id = ?`).get(id) || null;
}

function getRoomByToken(token) {
  return db.prepare(`SELECT * FROM cbt_rooms WHERE token = ?`).get(token) || null;
}

function getRoomByPengawasToken(ptoken) {
  return db.prepare(`SELECT * FROM cbt_rooms WHERE pengawas_token = ?`).get(ptoken) || null;
}

function getRooms(packageId) {
  const pkg   = db.prepare(`SELECT * FROM cbt_packages WHERE id = ?`).get(packageId);
  const rooms = db.prepare(`SELECT * FROM cbt_rooms WHERE package_id = ? ORDER BY room_name`).all(packageId);
  return rooms.map(r => {
    const joined    = db.prepare(`SELECT COUNT(*) as n FROM cbt_participants WHERE room_id = ?`).get(r.id)?.n || 0;
    const submitted = db.prepare(`SELECT COUNT(*) as n FROM cbt_participants WHERE room_id = ? AND status = 'submitted'`).get(r.id)?.n || 0;
    // Cheat: join via user_email + soal_source session
    let cheats = 0;
    if (pkg?.soal_source) {
      const emails = db.prepare(`SELECT user_email FROM cbt_participants WHERE room_id = ?`).all(r.id).map(p => p.user_email);
      if (emails.length) {
        const ph = emails.map(() => '?').join(',');
        cheats = db.prepare(`SELECT COUNT(*) as n FROM cbt_cheat_log WHERE session_id = ? AND user_email IN (${ph})`)
          .get(pkg.soal_source, ...emails)?.n || 0;
      }
    }
    return { ...r, _joined: joined, _submitted: submitted, _cheats: cheats };
  });
}

function updateRoom(id, fields) {
  const allowed = ['room_name', 'pengawas_name', 'pengawas_email', 'max_siswa', 'token_interval'];
  const sets    = Object.keys(fields).filter(k => allowed.includes(k)).map(k => `${k} = ?`);
  if (!sets.length) return getRoom(id);
  db.prepare(`UPDATE cbt_rooms SET ${sets.join(', ')} WHERE id = ?`)
    .run(...Object.keys(fields).filter(k => allowed.includes(k)).map(k => fields[k]), id);
  return getRoom(id);
}

function deleteRoom(id) {
  db.prepare(`DELETE FROM cbt_rooms WHERE id = ?`).run(id);
}

function startRoom(id) {
  const token  = uniqueToken();
  const pToken = uniquePengawasToken();
  db.prepare(`
    UPDATE cbt_rooms
    SET status = 'active', started_at = datetime('now','localtime'), token = ?, pengawas_token = ?
    WHERE id = ?
  `).run(token, pToken, id);
  return getRoom(id);
}

function endRoom(id) {
  db.prepare(`
    UPDATE cbt_rooms SET status = 'ended', ended_at = datetime('now','localtime') WHERE id = ?
  `).run(id);
  return getRoom(id);
}

function rotateRoomToken(id) {
  const token = uniqueToken();
  db.prepare(`UPDATE cbt_rooms SET token = ? WHERE id = ?`).run(token, id);
  return getRoom(id);
}

// ══════════════════════════════════════════════════════════════════════════════
// MONITOR DATA
// ══════════════════════════════════════════════════════════════════════════════

// Data lengkap semua ruang untuk koordinator
function getPackageMonitor(packageId) {
  const pkg   = db.prepare(`SELECT * FROM cbt_packages WHERE id = ?`).get(packageId);
  if (!pkg) return null;
  const rooms = getRooms(packageId);
  const totalJoined    = rooms.reduce((s, r) => s + r._joined, 0);
  const totalSubmitted = rooms.reduce((s, r) => s + r._submitted, 0);
  const totalCheats    = rooms.reduce((s, r) => s + r._cheats, 0);
  const totalMax       = rooms.reduce((s, r) => s + r.max_siswa, 0);
  return { pkg, rooms, summary: { totalJoined, totalSubmitted, totalCheats, totalMax } };
}

// Data 1 ruang untuk pengawas (terbatas)
function getRoomMonitor(roomId) {
  const room = getRoom(roomId);
  if (!room) return null;
  const pkg = db.prepare(`SELECT * FROM cbt_packages WHERE id = ?`).get(room.package_id);
  if (!pkg) return { room, pkg: null, participants: [], cheats: [] };

  // Ambil semua participants di ruang ini
  // cbt_jawaban & cbt_cheat_log tidak punya room_id — join via user_email + session_id
  const participants = db.prepare(`
    SELECT p.user_email, p.user_name, p.status, p.joined_at, p.submitted_at,
           p.ip_address, p.risk_level,
      (SELECT COUNT(*) FROM cbt_jawaban j
       WHERE j.session_id = p.session_id AND j.user_email = p.user_email) as answered,
      (SELECT COUNT(*) FROM cbt_cheat_log c
       WHERE c.session_id = p.session_id AND c.user_email = p.user_email) as cheat_count
    FROM cbt_participants p
    WHERE p.room_id = ?
    ORDER BY p.joined_at
  `).all(roomId);

  // Cheat log: ambil semua user yang ada di ruang ini
  const roomEmails = participants.map(p => p.user_email);
  let cheats = [];
  if (roomEmails.length && pkg.soal_source) {
    const placeholders = roomEmails.map(() => '?').join(',');
    cheats = db.prepare(`
      SELECT c.user_email,
        (SELECT p.user_name FROM cbt_participants p
         WHERE p.room_id = ? AND p.user_email = c.user_email LIMIT 1) as user_name,
        c.event_type, c.detail, c.logged_at
      FROM cbt_cheat_log c
      WHERE c.session_id = ? AND c.user_email IN (${placeholders})
      ORDER BY c.logged_at DESC
      LIMIT 100
    `).all(roomId, pkg.soal_source, ...roomEmails);
  }

  return { room, pkg, participants, cheats };
}

// ══════════════════════════════════════════════════════════════════════════════
// CHEAT LOG (tambah room_id support)
// ══════════════════════════════════════════════════════════════════════════════
try {
  db.exec(`ALTER TABLE cbt_cheat_log ADD COLUMN room_id TEXT`);
} catch(_) {}

module.exports = {
  createPackage, getPackage, getAllPackages, updatePackage, deletePackage,
  startAllRooms, endAllRooms,
  createRoom, getRoom, getRoomByToken, getRoomByPengawasToken, getRooms,
  updateRoom, deleteRoom, startRoom, endRoom, rotateRoomToken,
  getPackageMonitor, getRoomMonitor,
};