// ═══════════════════════════════════════════════════════════════════════════════
// DB: BANK SOAL — Library soal permanen, terpisah dari sesi CBT
// ═══════════════════════════════════════════════════════════════════════════════

const path           = require('path');
const { randomUUID } = require('crypto');

// ── Gunakan koneksi db yang SAMA dengan cbt.js ────────────────────────────────
// Ini memastikan semua tabel (cbt_jawaban, dll) sudah ada sebelum bank_soal dibuat
// dan menghindari race condition multiple SQLite connections
const cbtModule = require('./cbt');
const db = cbtModule._db;

db.exec(`
  CREATE TABLE IF NOT EXISTS bank_soal (
    id         TEXT PRIMARY KEY,
    mapel      TEXT NOT NULL,
    kelas      TEXT DEFAULT 'Semua',
    bab        TEXT,
    tingkat    TEXT DEFAULT 'C2',
    tipe       TEXT DEFAULT 'PG',
    soal       TEXT NOT NULL,
    opsi_a     TEXT,
    opsi_b     TEXT,
    opsi_c     TEXT,
    opsi_d     TEXT,
    kunci      TEXT,
    bobot      INTEGER DEFAULT 1,
    sumber     TEXT DEFAULT 'Manual',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS bank_soal_tags (
    soal_id TEXT NOT NULL REFERENCES bank_soal(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    PRIMARY KEY (soal_id, tag)
  );

  CREATE TABLE IF NOT EXISTS bank_soal_usage (
    soal_id    TEXT NOT NULL REFERENCES bank_soal(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    dipakai_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (soal_id, session_id)
  );

  CREATE INDEX IF NOT EXISTS idx_bank_mapel   ON bank_soal(mapel);
  CREATE INDEX IF NOT EXISTS idx_bank_kelas   ON bank_soal(kelas);
  CREATE INDEX IF NOT EXISTS idx_bank_tingkat ON bank_soal(tingkat);
  CREATE INDEX IF NOT EXISTS idx_bank_tipe    ON bank_soal(tipe);
`);

// ── CRUD ──────────────────────────────────────────────────────────────────────

function createSoal({ mapel, kelas, bab, tingkat, tipe, soal, opsi_a, opsi_b, opsi_c, opsi_d, kunci, bobot, sumber, tags }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO bank_soal (id, mapel, kelas, bab, tingkat, tipe, soal, opsi_a, opsi_b, opsi_c, opsi_d, kunci, bobot, sumber)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, mapel, kelas || 'Semua', bab || null, tingkat || 'C2', tipe || 'PG',
      soal, opsi_a || null, opsi_b || null, opsi_c || null, opsi_d || null,
      kunci || null, bobot || 1, sumber || 'Manual');
  if (tags?.length) setTags(id, tags);
  return getSoalById(id);
}

function getSoalById(id) {
  const s = db.prepare(`SELECT * FROM bank_soal WHERE id = ?`).get(id);
  if (!s) return null;
  s.tags = db.prepare(`SELECT tag FROM bank_soal_tags WHERE soal_id = ?`).all(id).map(t => t.tag);
  s.usageCount = db.prepare(`SELECT COUNT(*) as n FROM bank_soal_usage WHERE soal_id = ?`).get(id)?.n || 0;
  return s;
}

function getAllSoal({ mapel, kelas, bab, tingkat, tipe, search, limit = 100, offset = 0 } = {}) {
  const where = [];
  const params = [];

  if (mapel)  { where.push('mapel = ?');               params.push(mapel); }
  if (kelas && kelas !== 'Semua') { where.push(`(kelas = ? OR kelas = 'Semua')`); params.push(kelas); }
  if (bab)    { where.push('bab = ?');                 params.push(bab); }
  if (tingkat){ where.push('tingkat = ?');              params.push(tingkat); }
  if (tipe)   { where.push('tipe = ?');                 params.push(tipe); }
  if (search) { where.push('soal LIKE ?');              params.push(`%${search}%`); }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as n FROM bank_soal ${whereStr}`).get(...params)?.n || 0;

  const rows = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM bank_soal_usage WHERE soal_id = s.id) as usage_count,
      (SELECT GROUP_CONCAT(tag, ', ') FROM bank_soal_tags WHERE soal_id = s.id) as tags_str
    FROM bank_soal s
    ${whereStr}
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), parseInt(offset));

  return { total, data: rows };
}

function updateSoal(id, fields) {
  const allowed = ['mapel','kelas','bab','tingkat','tipe','soal','opsi_a','opsi_b','opsi_c','opsi_d','kunci','bobot','sumber'];
  const sets    = Object.keys(fields).filter(k => allowed.includes(k)).map(k => `${k} = ?`);
  if (!sets.length) return getSoalById(id);
  sets.push(`updated_at = datetime('now','localtime')`);
  db.prepare(`UPDATE bank_soal SET ${sets.join(', ')} WHERE id = ?`)
    .run(...Object.keys(fields).filter(k => allowed.includes(k)).map(k => fields[k]), id);
  if (fields.tags) setTags(id, fields.tags);
  return getSoalById(id);
}

function deleteSoal(id) {
  db.prepare(`DELETE FROM bank_soal WHERE id = ?`).run(id);
}

function deleteByMapel(mapel) {
  const result = db.prepare(`DELETE FROM bank_soal WHERE mapel = ?`).run(mapel);
  return result.changes;
}

// ── TAGS ─────────────────────────────────────────────────────────────────────

function setTags(soalId, tags) {
  db.prepare(`DELETE FROM bank_soal_tags WHERE soal_id = ?`).run(soalId);
  const stmt = db.prepare(`INSERT OR IGNORE INTO bank_soal_tags (soal_id, tag) VALUES (?, ?)`);
  tags.forEach(t => t && stmt.run(soalId, t.trim()));
}

function getAllTags() {
  return db.prepare(`SELECT DISTINCT tag FROM bank_soal_tags ORDER BY tag`).all().map(t => t.tag);
}

// ── BULK INSERT (dari MCP Generator) ─────────────────────────────────────────

function bulkInsert(soalList) {
  const inserted = [];
  const insert   = db.transaction(() => {
    for (const s of soalList) {
      const result = createSoal(s);
      inserted.push(result);
    }
  });
  insert();
  return inserted;
}

// ── USAGE TRACKING ────────────────────────────────────────────────────────────

function recordUsage(soalId, sessionId) {
  db.prepare(`INSERT OR IGNORE INTO bank_soal_usage (soal_id, session_id) VALUES (?, ?)`).run(soalId, sessionId);
}

function recordBulkUsage(soalIds, sessionId) {
  const stmt = db.prepare(`INSERT OR IGNORE INTO bank_soal_usage (soal_id, session_id) VALUES (?, ?)`);
  const tx   = db.transaction(() => soalIds.forEach(id => stmt.run(id, sessionId)));
  tx();
}

// ── STATISTIK ─────────────────────────────────────────────────────────────────

function getStats() {
  const total   = db.prepare(`SELECT COUNT(*) as n FROM bank_soal`).get()?.n || 0;
  const byMapel = db.prepare(`SELECT mapel, COUNT(*) as n FROM bank_soal GROUP BY mapel ORDER BY n DESC`).all();
  const byTipe  = db.prepare(`SELECT tipe, COUNT(*) as n FROM bank_soal GROUP BY tipe`).all();
  const byTingkat = db.prepare(`SELECT tingkat, COUNT(*) as n FROM bank_soal GROUP BY tingkat ORDER BY tingkat`).all();
  const topUsed = db.prepare(`
    SELECT s.id, s.soal, s.mapel, s.tipe, COUNT(u.session_id) as pakai_count
    FROM bank_soal s
    JOIN bank_soal_usage u ON u.soal_id = s.id
    GROUP BY s.id ORDER BY pakai_count DESC LIMIT 10
  `).all();
  return { total, byMapel, byTipe, byTingkat, topUsed };
}

function getMapelList() {
  return db.prepare(`SELECT DISTINCT mapel FROM bank_soal ORDER BY mapel`).all().map(r => r.mapel);
}

function getBabList(mapel) {
  const q = mapel
    ? db.prepare(`SELECT DISTINCT bab FROM bank_soal WHERE mapel = ? AND bab IS NOT NULL ORDER BY bab`).all(mapel)
    : db.prepare(`SELECT DISTINCT bab FROM bank_soal WHERE bab IS NOT NULL ORDER BY bab`).all();
  return q.map(r => r.bab);
}

module.exports = {
  createSoal, getSoalById, getAllSoal, updateSoal, deleteSoal, deleteByMapel,
  setTags, getAllTags,
  bulkInsert, recordUsage, recordBulkUsage,
  getStats, getMapelList, getBabList,
};