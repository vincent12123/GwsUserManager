/**
 * import-gws-users.js
 * Import gws_users dari CSV ke gws_auth.db
 *
 * Usage:
 *   node import-gws-users.js ./gws_users_export.csv
 *   node import-gws-users.js ./gws_users_export.csv --dry-run
 *   node import-gws-users.js ./gws_users_export.csv --replace   ← timpa data yang sudah ada
 */

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');

// ── Argumen ──────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const csvFile  = args.find(a => !a.startsWith('--'));
const isDryRun = args.includes('--dry-run');
const doReplace = args.includes('--replace');

if (!csvFile) {
  console.error('Usage: node import-gws-users.js <file.csv> [--dry-run] [--replace]');
  process.exit(1);
}

const csvPath = path.resolve(csvFile);
if (!fs.existsSync(csvPath)) {
  console.error('File tidak ditemukan:', csvPath);
  process.exit(1);
}

// ── Baca CSV (UTF-16) ─────────────────────────────────────────────────────
function parseCSV(filePath) {
  const raw  = fs.readFileSync(filePath);
  let text;
  // Detect BOM
  if (raw[0] === 0xFF && raw[1] === 0xFE) {
    text = raw.slice(2).toString('utf16le');
  } else if (raw[0] === 0xFE && raw[1] === 0xFF) {
    text = raw.slice(2).swap16().toString('utf16le');
  } else {
    // Try UTF-8 / UTF-8 BOM
    text = raw.slice(raw[0] === 0xEF ? 3 : 0).toString('utf-8');
  }

  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

  return lines.slice(1).map(line => {
    // Simple CSV parse — handle quoted fields
    const values = [];
    let inQuote = false, cur = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuote = !inQuote; continue; }
      if (c === ',' && !inQuote) { values.push(cur); cur = ''; continue; }
      cur += c;
    }
    values.push(cur);

    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] || '').trim(); });
    return obj;
  }).filter(r => r.email); // skip baris kosong
}

// ── Connect DB ────────────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'gws_auth.db');
if (!fs.existsSync(DB_PATH)) {
  console.error('gws_auth.db tidak ditemukan di:', DB_PATH);
  console.error('Jalankan script ini dari folder GwsUserManager/');
  process.exit(1);
}

const db = new Database(DB_PATH);

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  console.log('\n📥 Import gws_users dari CSV');
  console.log('   File  :', csvPath);
  console.log('   DB    :', DB_PATH);
  console.log('   Mode  :', isDryRun ? '🔍 Dry Run (tidak ada perubahan)' : doReplace ? '⚠️  Replace (timpa data existing)' : '✅ Insert (skip jika sudah ada)');
  console.log('');

  const rows = parseCSV(csvPath);
  console.log(`📊 Ditemukan ${rows.length} baris di CSV\n`);

  if (!rows.length) {
    console.log('❌ Tidak ada data yang bisa diimport.');
    return;
  }

  // Cek kolom yang ada
  const sample = rows[0];
  const required = ['email', 'name', 'role'];
  const missing = required.filter(k => !(k in sample));
  if (missing.length) {
    console.error('❌ Kolom wajib tidak ada di CSV:', missing.join(', '));
    console.error('   Kolom yang ada:', Object.keys(sample).join(', '));
    process.exit(1);
  }

  // Statistik
  let inserted = 0, skipped = 0, replaced = 0, errors = 0;

  const stmtCheck   = db.prepare(`SELECT id, email FROM gws_users WHERE email = ? OR id = ?`);
  const stmtInsert  = db.prepare(`
    INSERT INTO gws_users (id, email, name, role, password_hash, is_active, force_change, last_login, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const stmtReplace = db.prepare(`
    INSERT OR REPLACE INTO gws_users (id, email, name, role, password_hash, is_active, force_change, last_login, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const importFn = db.transaction((rows) => {
    for (const r of rows) {
      try {
        const id           = r.id            || require('crypto').randomUUID();
        const email        = r.email.toLowerCase().trim();
        const name         = r.name          || email.split('@')[0];
        const role         = ['super_admin','operator','guru'].includes(r.role) ? r.role : 'guru';
        const passwordHash = r.password_hash || null;
        const isActive     = r.is_active === '1' || r.is_active === 'true' ? 1 : 0;
        const forceChange  = r.force_change === '1' || r.force_change === 'true' ? 1 : 1; // default force change
        const lastLogin    = r.last_login    || null;
        const createdAt    = r.created_at    || new Date().toLocaleString('id-ID');

        // Validasi
        if (!email.includes('@')) {
          console.log(`  ⚠️  Skip [${email}] — email tidak valid`);
          errors++;
          continue;
        }
        if (!passwordHash) {
          console.log(`  ⚠️  Skip [${email}] — password_hash kosong (user tidak bisa login)`);
          errors++;
          continue;
        }

        const existing = stmtCheck.get(email, id);

        if (existing && !doReplace) {
          console.log(`  ⏭  Skip [${email}] — sudah ada (id: ${existing.id.slice(0,8)}...)`);
          skipped++;
          continue;
        }

        if (!isDryRun) {
          if (doReplace) {
            stmtReplace.run(id, email, name, role, passwordHash, isActive, forceChange, lastLogin, createdAt);
            if (existing) {
              console.log(`  🔄 Replace [${email}] (${role})`);
              replaced++;
            } else {
              console.log(`  ✅ Insert  [${email}] (${role})`);
              inserted++;
            }
          } else {
            stmtInsert.run(id, email, name, role, passwordHash, isActive, forceChange, lastLogin, createdAt);
            console.log(`  ✅ Insert  [${email}] (${role})`);
            inserted++;
          }
        } else {
          // Dry run — tampilkan saja
          if (existing) {
            console.log(`  [DRY] ${doReplace ? 'Replace' : 'Skip'} [${email}] — sudah ada`);
          } else {
            console.log(`  [DRY] Insert [${email}] (${role})`);
          }
          inserted++;
        }
      } catch(e) {
        console.log(`  ❌ Error [${r.email}]:`, e.message);
        errors++;
      }
    }
  });

  importFn(rows);

  // Ringkasan
  console.log('\n' + '─'.repeat(50));
  console.log('📋 RINGKASAN IMPORT');
  console.log('─'.repeat(50));
  if (isDryRun) {
    console.log(`  🔍 Dry Run — tidak ada perubahan ke database`);
    console.log(`  📊 Akan diproses: ${inserted} baris`);
  } else {
    console.log(`  ✅ Berhasil insert  : ${inserted}`);
    if (doReplace) console.log(`  🔄 Berhasil replace : ${replaced}`);
    console.log(`  ⏭  Dilewati (skip)  : ${skipped}`);
    console.log(`  ❌ Error            : ${errors}`);
    console.log(`  📊 Total di DB      : ${db.prepare('SELECT COUNT(*) as n FROM gws_users').get().n}`);
  }
  console.log('─'.repeat(50));

  // Tampilkan semua user di DB setelah import
  if (!isDryRun) {
    console.log('\n👥 User di gws_auth.db sekarang:');
    const all = db.prepare('SELECT id, email, name, role, is_active FROM gws_users ORDER BY role, name').all();
    all.forEach(u => {
      const status = u.is_active ? '🟢' : '🔴';
      console.log(`  ${status} [${u.role.padEnd(11)}] ${u.name.padEnd(20)} ${u.email}`);
    });
  }

  console.log('');
}

main();