// ═══════════════════════════════════════════════════════════════════════════════
// DB: SYNC CACHE — Cache user & OU dari Google Workspace ke SQLite
// ═══════════════════════════════════════════════════════════════════════════════

// ── Pakai koneksi yang SAMA dengan auth.js (gws_auth.db) ─────────────────────
const authModule = require('./auth');
const db         = authModule._db;

// ── TABEL CACHE ───────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS gws_user_cache (
    email         TEXT PRIMARY KEY,
    full_name     TEXT,
    given_name    TEXT,
    family_name   TEXT,
    org_unit_path TEXT,
    is_suspended  INTEGER DEFAULT 0,
    is_archived   INTEGER DEFAULT 0,
    thumbnail_url TEXT,
    last_sync     TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS gws_ou_cache (
    ou_path     TEXT PRIMARY KEY,
    ou_name     TEXT NOT NULL,
    parent_path TEXT,
    description TEXT,
    last_sync   TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS gws_sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type   TEXT NOT NULL,
    status      TEXT NOT NULL,
    total       INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    message     TEXT,
    synced_at   TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_cache_ou ON gws_user_cache(org_unit_path);
  CREATE INDEX IF NOT EXISTS idx_cache_suspended ON gws_user_cache(is_suspended);
`);

// ── USER CACHE ────────────────────────────────────────────────────────────────

function upsertUsers(users) {
  const stmt = db.prepare(`
    INSERT INTO gws_user_cache
      (email, full_name, given_name, family_name, org_unit_path, is_suspended, is_archived, thumbnail_url, last_sync)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(email) DO UPDATE SET
      full_name     = excluded.full_name,
      given_name    = excluded.given_name,
      family_name   = excluded.family_name,
      org_unit_path = excluded.org_unit_path,
      is_suspended  = excluded.is_suspended,
      is_archived   = excluded.is_archived,
      thumbnail_url = excluded.thumbnail_url,
      last_sync     = excluded.last_sync
  `);
  const tx = db.transaction((list) => {
    for (const u of list) {
      stmt.run(
        u.primaryEmail?.toLowerCase() || '',
        u.name?.fullName     || '',
        u.name?.givenName    || '',
        u.name?.familyName   || '',
        u.orgUnitPath        || '/',
        u.suspended ? 1 : 0,
        u.archived  ? 1 : 0,
        u.thumbnailPhotoUrl  || null,
      );
    }
  });
  tx(users);
}

function clearUserCache() {
  db.prepare('DELETE FROM gws_user_cache').run();
}

function getUsersByOU(orgUnitPath) {
  return db.prepare(`
    SELECT email, full_name, given_name, family_name, org_unit_path
    FROM gws_user_cache
    WHERE org_unit_path = ? AND is_suspended = 0 AND is_archived = 0
    ORDER BY full_name
  `).all(orgUnitPath);
}

function getAllCachedUsers({ orgUnit, suspended, search } = {}) {
  let where = [];
  let params = [];
  if (orgUnit)  { where.push('org_unit_path = ?'); params.push(orgUnit); }
  if (!suspended) { where.push('is_suspended = 0 AND is_archived = 0'); }
  if (search)   { where.push('(full_name LIKE ? OR email LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return db.prepare(`SELECT * FROM gws_user_cache ${w} ORDER BY full_name`).all(...params);
}

function getCacheUserCount() {
  return db.prepare('SELECT COUNT(*) as n FROM gws_user_cache').get()?.n || 0;
}

// ── OU CACHE ──────────────────────────────────────────────────────────────────

function upsertOUs(ous) {
  const stmt = db.prepare(`
    INSERT INTO gws_ou_cache (ou_path, ou_name, parent_path, description, last_sync)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(ou_path) DO UPDATE SET
      ou_name     = excluded.ou_name,
      parent_path = excluded.parent_path,
      description = excluded.description,
      last_sync   = excluded.last_sync
  `);
  const tx = db.transaction((list) => {
    for (const o of list) {
      stmt.run(o.orgUnitPath, o.name, o.parentOrgUnitPath || '/', o.description || null);
    }
  });
  tx(ous);
}

function clearOUCache() {
  db.prepare('DELETE FROM gws_ou_cache').run();
}

function getAllCachedOUs() {
  return db.prepare('SELECT * FROM gws_ou_cache ORDER BY ou_path').all();
}

function getCacheOUCount() {
  return db.prepare('SELECT COUNT(*) as n FROM gws_ou_cache').get()?.n || 0;
}

// ── SYNC LOG ──────────────────────────────────────────────────────────────────

function logSync(syncType, status, total, durationMs, message) {
  db.prepare(`
    INSERT INTO gws_sync_log (sync_type, status, total, duration_ms, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(syncType, status, total || 0, durationMs || 0, message || null);
  // Simpan maksimal 50 log
  db.prepare(`DELETE FROM gws_sync_log WHERE id NOT IN (SELECT id FROM gws_sync_log ORDER BY id DESC LIMIT 50)`).run();
}

function getLastSync(syncType) {
  return db.prepare(`
    SELECT * FROM gws_sync_log
    WHERE sync_type = ? AND status = 'success'
    ORDER BY id DESC LIMIT 1
  `).get(syncType);
}

function getSyncLogs(limit = 20) {
  return db.prepare(`SELECT * FROM gws_sync_log ORDER BY id DESC LIMIT ?`).all(limit);
}

function getSyncStatus() {
  const lastUsers  = getLastSync('users');
  const lastOUs    = getLastSync('orgunits');
  const lastFull   = getLastSync('full');
  const totalUsers = getCacheUserCount();
  const totalOUs   = getCacheOUCount();
  return {
    totalUsers,
    totalOUs,
    lastUserSync:  lastUsers?.synced_at  || null,
    lastOUSync:    lastOUs?.synced_at    || null,
    lastFullSync:  lastFull?.synced_at   || null,
    lastSyncMsg:   lastUsers?.message    || null,
    isCacheReady:  totalUsers > 0,
  };
}

// Hapus user yang tidak di-update selama sync terakhir (sudah dihapus dari GWS)
function deleteStaleUsers(beforeTimestamp) {
  db.prepare('DELETE FROM gws_user_cache WHERE last_sync < ?').run(beforeTimestamp);
}

function deleteStaleOUs(beforeTimestamp) {
  db.prepare('DELETE FROM gws_ou_cache WHERE last_sync < ?').run(beforeTimestamp);
}

module.exports = {
  upsertUsers, clearUserCache, getUsersByOU, getAllCachedUsers, getCacheUserCount,
  upsertOUs, clearOUCache, getAllCachedOUs, getCacheOUCount,
  deleteStaleUsers, deleteStaleOUs,
  logSync, getLastSync, getSyncLogs, getSyncStatus,
};