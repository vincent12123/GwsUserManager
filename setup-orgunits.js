require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');

// ─── Struktur Org Unit Yayasan Pendidikan Karya Bangsa ────────────────────────
const STRUKTUR = [
  {
    nama: 'SMK Karya Bangsa',
    path: '/SMK-Karya-Bangsa',
    sub: ['Guru', 'Siswa', 'TU'],
  },
  {
    nama: 'SMA Karya Bangsa',
    path: '/SMA-Karya-Bangsa',
    sub: ['Guru', 'Siswa', 'TU'],
  },
  {
    nama: 'SMP Karya Bangsa',
    path: '/SMP-Karya-Bangsa',
    sub: ['Guru', 'Siswa', 'TU'],
  },
  {
    nama: 'SD Karya Bangsa',
    path: '/SD-Karya-Bangsa',
    sub: ['Guru', 'Siswa', 'TU'],
  },
  {
    nama: 'Golden Bee',
    path: '/Golden-Bee',
    sub: ['Guru', 'Siswa', 'TU'],
  },
  {
    nama: 'KB Golden Bee',
    path: '/KB-Golden-Bee',
    sub: ['Guru', 'Siswa', 'TU'],
  },
];

// ─── Auth ─────────────────────────────────────────────────────────────────────
function getAdminClient() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || './service-account.json';
  if (!fs.existsSync(keyFile)) {
    throw new Error(`File tidak ditemukan: ${keyFile}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/admin.directory.orgunit'],
    clientOptions: { subject: process.env.GOOGLE_ADMIN_EMAIL },
  });
  return google.admin({ version: 'directory_v1', auth });
}

// ─── Helper: buat satu org unit, skip kalau sudah ada ─────────────────────────
async function buatOrgUnit(admin, nama, parentPath) {
  try {
    await admin.orgunits.insert({
      customerId: 'my_customer',
      requestBody: {
        name: nama,
        parentOrgUnitPath: parentPath,
      },
    });
    return { status: 'dibuat', path: `${parentPath}/${nama}` };
  } catch (err) {
    if (err.code === 409 || err?.errors?.[0]?.reason === 'duplicate') {
      return { status: 'sudah ada', path: `${parentPath}/${nama}` };
    }
    throw err;
  }
}

// ─── Helper: hapus semua org unit yang ada (kecuali root) ─────────────────────
async function hapusSemuaOrgUnit(admin) {
  console.log('🔍 Mengambil daftar org unit yang ada...');

  const result = await admin.orgunits.list({
    customerId: 'my_customer',
    type: 'all',
  });

  const semua = result.data.organizationUnits || [];

  if (semua.length === 0) {
    console.log('   ℹ️  Tidak ada org unit yang perlu dihapus.\n');
    return;
  }

  console.log(`   Ditemukan ${semua.length} org unit lama.\n`);

  // Urutkan: yang paling dalam (path terpanjang) dihapus duluan
  // agar tidak error karena parent masih ada child
  semua.sort((a, b) => {
    const depthA = (a.orgUnitPath.match(/\//g) || []).length;
    const depthB = (b.orgUnitPath.match(/\//g) || []).length;
    return depthB - depthA; // descending: child dulu, baru parent
  });

  console.log('🗑️  Menghapus org unit lama...');
  let hapusBerhasil = 0;
  let hapusGagal = 0;

  for (const ou of semua) {
    try {
      await admin.orgunits.delete({
        customerId: 'my_customer',
        orgUnitPath: ou.orgUnitPath,
      });
      console.log(`   🗑  Dihapus: ${ou.orgUnitPath}`);
      hapusBerhasil++;
    } catch (err) {
      // Org unit yang masih berisi user akan error — pindahkan usernya ke root
      const reason = err?.errors?.[0]?.message || err.message;
      console.log(`   ⚠️  Gagal hapus: ${ou.orgUnitPath}`);
      console.log(`       Alasan: ${reason}`);
      console.log(`       → User di org unit ini otomatis dipindah ke root (/)`);

      // Coba pindahkan semua user di org unit ini ke root, lalu hapus lagi
      try {
        const users = await admin.users.list({
          domain: process.env.GOOGLE_DOMAIN,
          query: `orgUnitPath='${ou.orgUnitPath}'`,
          maxResults: 500,
          projection: 'basic',
        });

        const userList = users.data.users || [];
        for (const u of userList) {
          await admin.users.update({
            userKey: u.primaryEmail,
            requestBody: { orgUnitPath: '/' },
          });
        }

        if (userList.length > 0) {
          console.log(`       ✅ ${userList.length} user dipindahkan ke root`);
          await new Promise(r => setTimeout(r, 500));
        }

        // Coba hapus lagi setelah user dipindahkan
        await admin.orgunits.delete({
          customerId: 'my_customer',
          orgUnitPath: ou.orgUnitPath,
        });
        console.log(`   🗑  Dihapus (setelah kosongkan): ${ou.orgUnitPath}`);
        hapusBerhasil++;
        hapusGagal--; // koreksi counter
      } catch (e2) {
        console.log(`   ❌ Tetap gagal: ${e2?.errors?.[0]?.message || e2.message}`);
      }
      hapusGagal++;
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n   Selesai hapus: ✅ ${hapusBerhasil} berhasil, ❌ ${hapusGagal} gagal\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   Setup Org Unit - Yayasan Pendidikan Karya Bangsa  ║');
  console.log('║   Sukardi, S.Kom · SMK Karya Bangsa · Sintang       ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const admin = getAdminClient();

  // ── FASE 1: Hapus semua org unit lama ──────────────────────────────────────
  console.log('━━━ FASE 1: Bersihkan org unit lama ━━━━━━━━━━━━━━━━━━\n');
  await hapusSemuaOrgUnit(admin);

  // Jeda sebentar sebelum mulai buat yang baru
  console.log('⏳ Menunggu sebentar sebelum membuat struktur baru...\n');
  await new Promise(r => setTimeout(r, 2000));

  console.log('━━━ FASE 2: Buat struktur org unit baru ━━━━━━━━━━━━━━\n');
  let totalDibuat = 0;
  let totalSkip = 0;
  let totalError = 0;

  for (const sekolah of STRUKTUR) {
    console.log(`\n📂 ${sekolah.nama}`);

    // 1. Buat parent org unit (level sekolah)
    try {
      const hasil = await buatOrgUnit(admin, sekolah.path.replace('/', ''), '/');
      if (hasil.status === 'dibuat') {
        console.log(`   ✅ Dibuat  : ${hasil.path}`);
        totalDibuat++;
      } else {
        console.log(`   ⏭  Skip    : ${hasil.path} (sudah ada)`);
        totalSkip++;
      }
    } catch (err) {
      console.log(`   ❌ Error   : ${sekolah.path} — ${err.message}`);
      totalError++;
      continue;
    }

    // 2. Buat sub org unit (Guru, Siswa, TU)
    for (const sub of sekolah.sub) {
      try {
        const hasil = await buatOrgUnit(admin, sub, sekolah.path);
        if (hasil.status === 'dibuat') {
          console.log(`   ✅ Dibuat  : ${sekolah.path}/${sub}`);
          totalDibuat++;
        } else {
          console.log(`   ⏭  Skip    : ${sekolah.path}/${sub} (sudah ada)`);
          totalSkip++;
        }
      } catch (err) {
        console.log(`   ❌ Error   : ${sekolah.path}/${sub} — ${err.message}`);
        totalError++;
      }

      // Jeda kecil agar tidak kena rate limit Google API
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log('\n──────────────────────────────────────────────────────');
  console.log(`📊 Ringkasan:`);
  console.log(`   ✅ Berhasil dibuat : ${totalDibuat} org unit`);
  console.log(`   ⏭  Sudah ada (skip): ${totalSkip} org unit`);
  console.log(`   ❌ Error           : ${totalError} org unit`);
  console.log('──────────────────────────────────────────────────────');

  if (totalError === 0) {
    console.log('\n🎉 Semua org unit berhasil disiapkan!\n');
    console.log('Struktur yang terbuat:');
    for (const s of STRUKTUR) {
      console.log(`  ${s.path}/`);
      for (const sub of s.sub) {
        console.log(`    └── ${sub}`);
      }
    }
  } else {
    console.log('\n⚠️  Ada beberapa error. Cek pesan di atas.');
    console.log('Kemungkinan penyebab:');
    console.log('  - Service account belum dapat izin orgunit');
    console.log('  - Domain-Wide Delegation belum aktif');
    console.log('  - Scope orgunit belum ditambahkan di Admin Console\n');
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  if (err.message.includes('service-account.json')) {
    console.error('   → Pastikan file service-account.json ada di folder ini');
  }
  if (err.message.includes('unauthorized') || err.code === 401) {
    console.error('   → Cek GOOGLE_ADMIN_EMAIL di file .env');
    console.error('   → Pastikan Domain-Wide Delegation sudah aktif');
  }
  process.exit(1);
});