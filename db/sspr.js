// ═══════════════════════════════════════════════════════════════════════════════
// DB: SSPR — Self-Service Password Reset
// Rate limiting + audit log, tanpa perlu data NISN
// ═══════════════════════════════════════════════════════════════════════════════

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, '..', 'gws_auth.db');
const db      = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sspr_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT,
    status     TEXT NOT NULL,   -- 'success' | 'failed_notfound' | 'failed_suspended' | 'blocked' | 'failed_password'
    ip_address TEXT,
    user_agent TEXT,
    logged_at  TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sspr_rate (
    key        TEXT PRIMARY KEY,   -- 'ip:x.x.x.x' atau 'email:xxx@yyy'
    attempts   INTEGER DEFAULT 0,
    blocked_until TEXT,
    last_at    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sspr_log_email ON sspr_log(email);
  CREATE INDEX IF NOT EXISTS idx_sspr_log_time  ON sspr_log(logged_at);
`);

// ── Rate limiting ─────────────────────────────────────────────────────────────
const RATE_IP_MAX     = 5;    // maks percobaan per IP per window
const RATE_IP_WINDOW  = 60;   // window dalam menit
const RATE_IP_BLOCK   = 15;   // blokir berapa menit
const RATE_EMAIL_WAIT = 120;  // menit cooldown per akun setelah sukses

function checkRateLimit(ip, email) {
  const now = new Date();

  // Cek blokir IP
  const ipKey  = `ip:${ip}`;
  const ipRate = db.prepare(`SELECT * FROM sspr_rate WHERE key = ?`).get(ipKey);
  if (ipRate?.blocked_until) {
    const unblockAt = new Date(ipRate.blocked_until);
    if (unblockAt > now) {
      const minsLeft = Math.ceil((unblockAt - now) / 60000);
      return { blocked: true, reason: `Terlalu banyak percobaan. Coba lagi dalam ${minsLeft} menit.` };
    }
    // Sudah lewat blokir — reset
    db.prepare(`DELETE FROM sspr_rate WHERE key = ?`).run(ipKey);
  }

  // Cek cooldown email (setelah sukses reset)
  if (email) {
    const emailKey  = `email:${email.toLowerCase()}`;
    const emailRate = db.prepare(`SELECT * FROM sspr_rate WHERE key = ?`).get(emailKey);
    if (emailRate?.blocked_until) {
      const unblockAt = new Date(emailRate.blocked_until);
      if (unblockAt > now) {
        const minsLeft = Math.ceil((unblockAt - now) / 60000);
        return { blocked: true, reason: `Password akun ini baru saja direset. Coba lagi dalam ${minsLeft} menit.` };
      }
      db.prepare(`DELETE FROM sspr_rate WHERE key = ?`).run(emailKey);
    }
  }

  return { blocked: false };
}

function recordAttempt(ip, success) {
  const ipKey = `ip:${ip}`;
  const now   = new Date().toISOString();

  if (success) {
    // Reset counter IP saat sukses
    db.prepare(`DELETE FROM sspr_rate WHERE key = ?`).run(ipKey);
    return;
  }

  const existing = db.prepare(`SELECT * FROM sspr_rate WHERE key = ?`).get(ipKey);
  const attempts = (existing?.attempts || 0) + 1;

  if (attempts >= RATE_IP_MAX) {
    const blockedUntil = new Date(Date.now() + RATE_IP_BLOCK * 60000).toISOString();
    db.prepare(`
      INSERT INTO sspr_rate (key, attempts, blocked_until, last_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET attempts = ?, blocked_until = ?, last_at = ?
    `).run(ipKey, attempts, blockedUntil, now, attempts, blockedUntil, now);
  } else {
    db.prepare(`
      INSERT INTO sspr_rate (key, attempts, last_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET attempts = ?, last_at = ?
    `).run(ipKey, attempts, now, attempts, now);
  }
}

function recordEmailCooldown(email) {
  const emailKey     = `email:${email.toLowerCase()}`;
  const blockedUntil = new Date(Date.now() + RATE_EMAIL_WAIT * 60000).toISOString();
  const now          = new Date().toISOString();
  db.prepare(`
    INSERT INTO sspr_rate (key, attempts, blocked_until, last_at)
    VALUES (?, 1, ?, ?)
    ON CONFLICT(key) DO UPDATE SET attempts = 1, blocked_until = ?, last_at = ?
  `).run(emailKey, blockedUntil, now, blockedUntil, now);
}

// ── Log ───────────────────────────────────────────────────────────────────────
function addLog(email, status, ip, ua) {
  db.prepare(`
    INSERT INTO sspr_log (email, status, ip_address, user_agent)
    VALUES (?, ?, ?, ?)
  `).run(email || null, status, ip || null, ua || null);
}

function getLogs({ limit = 100, offset = 0, email } = {}) {
  if (email) {
    return db.prepare(`
      SELECT * FROM sspr_log WHERE email = ?
      ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(email, parseInt(limit), parseInt(offset));
  }
  return db.prepare(`
    SELECT * FROM sspr_log ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(parseInt(limit), parseInt(offset));
}

function getLogTotal(email) {
  if (email) {
    return db.prepare(`SELECT COUNT(*) as n FROM sspr_log WHERE email = ?`).get(email)?.n || 0;
  }
  return db.prepare(`SELECT COUNT(*) as n FROM sspr_log`).get()?.n || 0;
}

function getLogStats() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    totalToday:   db.prepare(`SELECT COUNT(*) as n FROM sspr_log WHERE logged_at LIKE ?`).get(`${today}%`)?.n || 0,
    successToday: db.prepare(`SELECT COUNT(*) as n FROM sspr_log WHERE status = 'success' AND logged_at LIKE ?`).get(`${today}%`)?.n || 0,
    failedToday:  db.prepare(`SELECT COUNT(*) as n FROM sspr_log WHERE status LIKE 'failed%' AND logged_at LIKE ?`).get(`${today}%`)?.n || 0,
    totalAll:     db.prepare(`SELECT COUNT(*) as n FROM sspr_log`).get()?.n || 0,
  };
}

function deleteLogs(olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
  return db.prepare(`DELETE FROM sspr_log WHERE logged_at < ?`).run(cutoff).changes;
}

module.exports = {
  checkRateLimit, recordAttempt, recordEmailCooldown,
  addLog, getLogs, getLogTotal, getLogStats, deleteLogs,
};