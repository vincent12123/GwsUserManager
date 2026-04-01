// ═══════════════════════════════════════════════════════════════════════════════
// DB: AUTH — gws_users + sessions
// ═══════════════════════════════════════════════════════════════════════════════

const Database       = require('better-sqlite3');
const path           = require('path');
const bcrypt         = require('bcryptjs');
const { randomUUID } = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'gws_auth.db');
const db      = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS gws_users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'guru',
    password_hash TEXT NOT NULL,
    is_active     INTEGER DEFAULT 1,
    force_change  INTEGER DEFAULT 0,
    last_login    TEXT,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS gws_sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES gws_users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    expires_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT
  );

  CREATE TABLE IF NOT EXISTS gws_user_access (
    user_id      TEXT NOT NULL REFERENCES gws_users(id) ON DELETE CASCADE,
    access_type  TEXT NOT NULL,
    access_value TEXT NOT NULL,
    PRIMARY KEY (user_id, access_type, access_value)
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON gws_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON gws_sessions(expires_at);
`);

// ── ROLES ─────────────────────────────────────────────────────────────────────
const ROLES = {
  super_admin: {
    label: 'Super Admin',
    menus: ['dashboard','adminusers','users','bulk','classroom','audit','security','cbt','mcp','bank','driveaudit','cbtpkg','sspr'],
    color: '#f87171',
  },
  operator: {
    label: 'Operator',
    menus: ['dashboard','users','bulk','classroom','cbt','mcp','bank','cbtpkg','sspr'],
    color: '#60a5fa',
  },
  guru: {
    label: 'Guru',
    menus: ['dashboard','classroom','cbt','mcp','bank'],
    color: '#34d399',
  },
};

function getRoleMenus(role) {
  return ROLES[role]?.menus || ROLES.guru.menus;
}

// ── USER CRUD ─────────────────────────────────────────────────────────────────
function createUser({ email, name, role, password, forceChange = true }) {
  const id   = randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO gws_users (id, email, name, role, password_hash, force_change)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, email.toLowerCase().trim(), name, role || 'guru', hash, forceChange ? 1 : 0);
  return getUserById(id);
}

function getUserById(id) {
  return db.prepare(`SELECT id,email,name,role,is_active,force_change,last_login,created_at FROM gws_users WHERE id = ?`).get(id) || null;
}

function getUserByEmail(email) {
  return db.prepare(`SELECT * FROM gws_users WHERE email = ?`).get(email?.toLowerCase().trim()) || null;
}

function getAllUsers() {
  return db.prepare(`SELECT id,email,name,role,is_active,force_change,last_login,created_at FROM gws_users ORDER BY role,name`).all();
}

function updateUser(id, fields) {
  const allowed = ['email','name','role','is_active'];
  const sets    = Object.keys(fields).filter(k => allowed.includes(k)).map(k => `${k} = ?`);
  if (!sets.length) return getUserById(id);
  db.prepare(`UPDATE gws_users SET ${sets.join(', ')} WHERE id = ?`)
    .run(...Object.keys(fields).filter(k => allowed.includes(k)).map(k => fields[k]), id);
  return getUserById(id);
}

function resetPassword(id, newPassword, forceChange = true) {
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare(`UPDATE gws_users SET password_hash = ?, force_change = ? WHERE id = ?`)
    .run(hash, forceChange ? 1 : 0, id);
}

function deleteUser(id) {
  db.prepare(`DELETE FROM gws_users WHERE id = ?`).run(id);
}

function verifyPassword(email, password) {
  const user = getUserByEmail(email);
  if (!user || !user.is_active) return null;
  const ok = bcrypt.compareSync(password, user.password_hash);
  return ok ? user : null;
}

function updateLastLogin(id, ip) {
  db.prepare(`UPDATE gws_users SET last_login = datetime('now','localtime') WHERE id = ?`).run(id);
}

// ── SESSIONS ──────────────────────────────────────────────────────────────────
const SESSION_TTL_HOURS = 8;

function createSession(userId, ip, userAgent) {
  // Hapus session lama user ini dulu (max 3 session aktif)
  const old = db.prepare(`SELECT id FROM gws_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 2`).all(userId);
  old.forEach(s => db.prepare(`DELETE FROM gws_sessions WHERE id = ?`).run(s.id));

  const id       = randomUUID();
  const expires  = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO gws_sessions (id, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`)
    .run(id, userId, expires, ip || '', userAgent || '');
  return id;
}

function getSession(sessionId) {
  const s = db.prepare(`SELECT * FROM gws_sessions WHERE id = ?`).get(sessionId);
  if (!s) return null;
  if (new Date(s.expires_at) < new Date()) {
    db.prepare(`DELETE FROM gws_sessions WHERE id = ?`).run(sessionId);
    return null;
  }
  const user = getUserById(s.user_id);
  return user ? { session: s, user } : null;
}

function deleteSession(sessionId) {
  db.prepare(`DELETE FROM gws_sessions WHERE id = ?`).run(sessionId);
}

function cleanExpiredSessions() {
  db.prepare(`DELETE FROM gws_sessions WHERE expires_at < datetime('now')`).run();
}

// Bersihkan expired sessions setiap 1 jam
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

// ── SETUP CHECK ───────────────────────────────────────────────────────────────
function hasAnyUser() {
  return db.prepare(`SELECT COUNT(*) as n FROM gws_users`).get()?.n > 0;
}

// ── ACCESS CONTROL ────────────────────────────────────────────────────────────
function getUserAccess(userId) {
  return db.prepare(`SELECT access_type, access_value FROM gws_user_access WHERE user_id = ?`).all(userId);
}

function setUserAccess(userId, accessList) {
  db.prepare(`DELETE FROM gws_user_access WHERE user_id = ?`).run(userId);
  const stmt = db.prepare(`INSERT INTO gws_user_access (user_id, access_type, access_value) VALUES (?, ?, ?)`);
  accessList.forEach(({ type, value }) => stmt.run(userId, type, value));
}

module.exports = {
  ROLES, getRoleMenus,
  createUser, getUserById, getUserByEmail, getAllUsers,
  updateUser, resetPassword, deleteUser, verifyPassword, updateLastLogin,
  createSession, getSession, deleteSession, cleanExpiredSessions,
  hasAnyUser, getUserAccess, setUserAccess,
  _db: db,
};