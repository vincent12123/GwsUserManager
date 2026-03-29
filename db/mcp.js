// ═══════════════════════════════════════════════════════════════════════════════
// DB: MCP — Paket Soal Generated oleh Ollama
// ═══════════════════════════════════════════════════════════════════════════════

const Database = require('better-sqlite3');
const path     = require('path');
const { randomUUID } = require('crypto');

const db = new Database(path.join(__dirname, '..', 'cbt.db'));
db.pragma('journal_mode = WAL');

// ── TABEL MCP PACKAGES ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS mcp_packages (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    mapel       TEXT NOT NULL,
    kelas       TEXT NOT NULL,
    config      TEXT,
    status      TEXT DEFAULT 'draft',
    total_soal  INTEGER DEFAULT 0,
    total_pg    INTEGER DEFAULT 0,
    total_essay INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    updated_at  TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS mcp_soal (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id     TEXT NOT NULL,
    no             INTEGER NOT NULL,
    tipe           TEXT NOT NULL,
    soal           TEXT NOT NULL,
    opsi_a         TEXT,
    opsi_b         TEXT,
    opsi_c         TEXT,
    opsi_d         TEXT,
    kunci          TEXT,
    bobot          INTEGER DEFAULT 1,
    pembahasan     TEXT,
    review_status  TEXT DEFAULT 'pending',
    FOREIGN KEY(package_id) REFERENCES mcp_packages(id) ON DELETE CASCADE
  );
`);

// ── PACKAGES ──────────────────────────────────────────────────────────────────

function createPackage({ mapel, kelas, config, soalArr }) {
  const id   = randomUUID();
  const name = `${mapel} — ${kelas} (${new Date().toLocaleDateString('id-ID')})`;
  const pg   = soalArr.filter(s => s.tipe === 'PG').length;
  const es   = soalArr.filter(s => s.tipe === 'ES').length;

  db.prepare(`
    INSERT INTO mcp_packages (id, name, mapel, kelas, config, total_soal, total_pg, total_essay)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, mapel, kelas, JSON.stringify(config || {}), soalArr.length, pg, es);

  // Insert semua soal sekaligus dalam satu transaksi
  const ins = db.prepare(`
    INSERT INTO mcp_soal (package_id, no, tipe, soal, opsi_a, opsi_b, opsi_c, opsi_d, kunci, bobot, pembahasan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(items => {
    for (const s of items) {
      ins.run(
        id, s.no, (s.tipe || 'PG').toUpperCase(),
        s.soal,
        s.opsi?.A || null, s.opsi?.B || null, s.opsi?.C || null, s.opsi?.D || null,
        s.kunci || null,
        s.bobot || 1,
        s.pembahasan || null
      );
    }
  })(soalArr);

  return getPackage(id);
}

function getAllPackages() {
  return db.prepare(`
    SELECT *, 
      (SELECT COUNT(*) FROM mcp_soal WHERE package_id = mcp_packages.id AND review_status = 'approved') as approved_count,
      (SELECT COUNT(*) FROM mcp_soal WHERE package_id = mcp_packages.id AND review_status = 'rejected') as rejected_count
    FROM mcp_packages 
    ORDER BY created_at DESC
  `).all().map(p => ({
    ...p,
    config: tryParse(p.config),
  }));
}

function getPackage(id) {
  const p = db.prepare(`SELECT * FROM mcp_packages WHERE id = ?`).get(id);
  if (!p) return null;
  return { ...p, config: tryParse(p.config) };
}

function updatePackageStatus(id, status) {
  db.prepare(`UPDATE mcp_packages SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(status, id);
}

function deletePackage(id) {
  db.prepare(`DELETE FROM mcp_packages WHERE id = ?`).run(id);
}

// ── SOAL PER PACKAGE ──────────────────────────────────────────────────────────

function getSoalByPackage(packageId) {
  return db.prepare(`SELECT * FROM mcp_soal WHERE package_id = ? ORDER BY no`).all(packageId)
    .map(soalToObj);
}

function getApprovedSoal(packageId) {
  return db.prepare(`
    SELECT * FROM mcp_soal WHERE package_id = ? AND review_status = 'approved' ORDER BY no
  `).all(packageId).map(soalToObj);
}

function updateSoal(id, fields) {
  const { soal, opsiA, opsiB, opsiC, opsiD, kunci, bobot, pembahasan, reviewStatus } = fields;
  db.prepare(`
    UPDATE mcp_soal SET
      soal = ?, opsi_a = ?, opsi_b = ?, opsi_c = ?, opsi_d = ?,
      kunci = ?, bobot = ?, pembahasan = ?, review_status = ?
    WHERE id = ?
  `).run(soal, opsiA||null, opsiB||null, opsiC||null, opsiD||null,
         kunci||null, bobot||1, pembahasan||null, reviewStatus||'pending', id);
  // Update timestamp package
  const row = db.prepare(`SELECT package_id FROM mcp_soal WHERE id = ?`).get(id);
  if (row) db.prepare(`UPDATE mcp_packages SET updated_at = datetime('now','localtime') WHERE id = ?`).run(row.package_id);
}

function setReviewStatus(soalId, status) {
  db.prepare(`UPDATE mcp_soal SET review_status = ? WHERE id = ?`).run(status, soalId);
  const row = db.prepare(`SELECT package_id FROM mcp_soal WHERE id = ?`).get(soalId);
  if (row) db.prepare(`UPDATE mcp_packages SET updated_at = datetime('now','localtime') WHERE id = ?`).run(row.package_id);
}

function bulkSetReviewStatus(packageId, status) {
  db.prepare(`UPDATE mcp_soal SET review_status = ? WHERE package_id = ?`).run(status, packageId);
  db.prepare(`UPDATE mcp_packages SET updated_at = datetime('now','localtime') WHERE id = ?`).run(packageId);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function soalToObj(row) {
  return {
    id:           row.id,
    package_id:   row.package_id,
    no:           row.no,
    tipe:         row.tipe,
    soal:         row.soal,
    opsi: row.tipe === 'PG' ? {
      A: row.opsi_a, B: row.opsi_b, C: row.opsi_c, D: row.opsi_d,
    } : undefined,
    kunci:        row.kunci,
    bobot:        row.bobot,
    pembahasan:   row.pembahasan,
    reviewStatus: row.review_status,
  };
}

function tryParse(str) {
  try { return JSON.parse(str); } catch { return {}; }
}

// ── EXPORTS ───────────────────────────────────────────────────────────────────

module.exports = {
  createPackage,
  getAllPackages,
  getPackage,
  updatePackageStatus,
  deletePackage,
  getSoalByPackage,
  getApprovedSoal,
  updateSoal,
  setReviewStatus,
  bulkSetReviewStatus,
};