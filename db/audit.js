// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT DATABASE — GWS Manager
// SQLite setup + helper function auditLog()
// ═══════════════════════════════════════════════════════════════════════════════

const Database = require('better-sqlite3');
const path     = require('path');
const { ADMIN_EMAIL } = require('../config');

const db = new Database(path.join(__dirname, '..', 'audit.db'));

// Buat tabel jika belum ada
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp    TEXT    NOT NULL,
    action       TEXT    NOT NULL,
    target       TEXT    NOT NULL,
    detail       TEXT,
    performed_by TEXT    NOT NULL DEFAULT 'system',
    status       TEXT    NOT NULL DEFAULT 'success'
  )
`);

/**
 * Catat aksi admin ke database
 * @param {string} action  - Nama aksi (mis: 'Hapus User')
 * @param {string} target  - Email atau ID yang diproses
 * @param {string|object} detail - Detail tambahan
 * @param {string} status  - 'success' | 'error' | 'warning'
 */
function auditLog(action, target, detail = '', status = 'success') {
  try {
    db.prepare(`
      INSERT INTO audit_log (timestamp, action, target, detail, performed_by, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      action,
      target,
      typeof detail === 'object' ? JSON.stringify(detail) : detail,
      ADMIN_EMAIL || 'system',
      status
    );
  } catch(e) {
    console.error('[AUDIT ERROR]', e.message);
  }
}

module.exports = { db, auditLog };
