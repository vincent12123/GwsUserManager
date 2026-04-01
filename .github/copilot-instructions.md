# GWS Manager v2.0 — Copilot Instructions

Platform manajemen **Google Workspace** terpadu untuk sekolah. Dibangun dengan Node.js + Express + SQLite + Google APIs + Ollama AI. Dirancang portabel — satu codebase bisa dipakai oleh sekolah mana pun hanya dengan ubah `.env`.

---

## Tech Stack

| Layer | Teknologi |
|---|---|
| Runtime | Node.js v18+ |
| Framework | Express.js |
| Database | SQLite via `better-sqlite3` |
| Template | EJS (`views/`) |
| Auth | Cookie session + `bcryptjs` |
| AI | Ollama (lokal, model `gpt-oss:120b-cloud`) |
| Google APIs | Admin Directory, Classroom, Drive, Sheets |
| Frontend | Vanilla JS (ES6+), no bundler |
| PWA | Service Worker + IndexedDB (`cbt-offline.js`) |
| Math render | KaTeX 0.16.9 (CDN) |
| Mobile App | Capacitor JS (Android APK) |
| Deployment | Ubuntu + aapanel + Cloudflare Tunnel |

---

## Struktur Proyek

```
GwsUserManager/
├── config/
│   └── index.js              # Semua konstanta sekolah — SCHOOL_*, DOMAIN, TEACHER_GROUP, dll
├── db/
│   ├── cbt.js                # ⭐ Master DB — buka koneksi cbt.db, ekspor _db
│   ├── bank.js               # Bank soal — WAJIB pakai _db dari cbt.js
│   ├── mcp.js                # MCP packages — WAJIB pakai _db dari cbt.js
│   ├── package.js            # Multi-Ruang CBT (cbt_packages, cbt_rooms)
│   ├── auth.js               # gws_auth.db — users, sessions, access
│   ├── sspr.js               # SSPR log & rate limit
│   └── audit.js              # audit.db — activity log
├── helpers/
│   └── auth.js               # Google API clients: getAdminClient, getDriveClient, dll
├── middleware/
│   └── auth.js               # Auth middleware — role check, PUBLIC_PAGES, PUBLIC_API
├── routes/                   # Express route handlers (17 file)
│   ├── cbt.js                # CBT Manager + export sheets
│   ├── bank.js               # Bank Soal CRUD + to-session + upload-image
│   ├── mcp.js                # MCP Generator — extract PDF, gen soal, review, import
│   ├── cbt-package.js        # Multi-Ruang CBT
│   ├── nilai-essay.js        # Penilaian Essay + export sheets (share ke TEACHER_GROUP)
│   ├── login.js              # Auth login/logout/manage GWS Manager users
│   ├── sspr.js               # SSPR Kiosk
│   └── ...
├── tools/
│   ├── gen_soal.js           # Ollama prompt builder + genSoal() + fixLatexInSoal()
│   ├── extract_pdf.js        # PDF text extractor
│   └── export_docx.js        # Export soal ke Word
├── public/
│   ├── cbt-siswa.html        # ⭐ Halaman ujian siswa — PWA & web browser (JANGAN UBAH)
│   ├── cbt-siswa-app.html    # ⭐ Halaman ujian khusus Capacitor APK (bebas dimodifikasi)
│   ├── monitor-ruang.html    # Monitor pengawas
│   ├── nilai-essay.html      # Penilaian essay guru (standalone, tanpa login)
│   ├── reset.html            # SSPR Kiosk
│   ├── sw.js                 # Service Worker (hanya untuk PWA/web, tidak dipakai APK)
│   ├── manifest.json         # PWA manifest (static, nama sekolah via /api/health)
│   ├── icons/                # icon-192.png, icon-512.png, icon-180.png, splash-*.png
│   ├── downloads/            # APK distribusi → cbt-siswa.apk
│   ├── uploads/soal/         # Upload gambar soal (dari Markdown editor)
│   ├── css/main.css
│   └── js/                   # Frontend modules per modul
│       ├── cbt-offline.js    # IndexedDB offline sync — dipakai PWA & APK
│       ├── mcp.js, bank.js, cbt.js, navigation.js, ...
├── views/
│   ├── index.ejs             # SPA shell utama
│   ├── layout/
│   │   ├── head.ejs          # DOCTYPE + meta OG + KaTeX CDN
│   │   ├── sidebar.ejs       # Navigasi sidebar dengan hamburger mobile
│   │   └── scripts.ejs       # Semua <script> + CSS mobile sidebar + renderMath()
│   ├── pages/                # Satu file per modul (13 file)
│   │   ├── bank.ejs          # Markdown editor + teks bacaan field
│   │   ├── mcp.ejs           # Toggle teks bacaan / soal cerita
│   │   └── ...
│   └── partials/modals.ejs
├── cbt-app/                  # ⭐ Capacitor project (Android APK)
│   ├── android/              # Project Android Studio
│   │   └── app/src/main/
│   │       ├── java/id/sch/karyabangsa/cbt/
│   │       │   └── MainActivity.java   # Fullscreen immersive mode
│   │       └── res/
│   │           ├── values/styles.xml   # Theme fullscreen
│   │           ├── values/colors.xml
│   │           ├── drawable/splash.xml
│   │           └── mipmap-*/           # Icon semua ukuran
│   ├── www/                  # Dummy folder wajib ada (berisi index.html kosong)
│   ├── capacitor.config.json # ⭐ Config utama — url server, plugins
│   └── package.json
├── generate-icons.js         # Generate PWA icons + Android icons dengan sharp
├── import-gws-users.js       # Import user dari CSV ke gws_auth.db
├── .env                      # Secrets — JANGAN commit
├── .env.example
├── .gitignore
└── README.md
```

---

## Aturan Kritis — WAJIB Diikuti

### 1. Koneksi SQLite — Shared Connection

**❌ JANGAN** buka koneksi SQLite baru di `db/bank.js` atau `db/mcp.js`:
```javascript
// ❌ SALAH — menyebabkan race condition saat startup
const db = new Database('cbt.db');
```

**✅ SELALU** pakai shared connection dari `db/cbt.js`:
```javascript
// ✅ BENAR
const cbtModule = require('./cbt');
const db = cbtModule._db;
```

`db/cbt.js` adalah satu-satunya yang boleh `new Database()` dan **wajib** ekspor `_db`:
```javascript
module.exports = {
  // ... semua fungsi ...
  _db: db,  // ← ekspor wajib
};
```

### 2. Urutan Middleware di server.js

**express.static HARUS sebelum authMiddleware** — agar `manifest.json`, `sw.js`, CSS, JS bisa diakses tanpa login:
```javascript
// ✅ URUTAN BENAR
app.use(express.static(path.join(__dirname, 'public'))); // ← dulu
app.use(authMiddleware);                                  // ← kemudian
```

### 3. Index SQLite — HARUS Setelah CREATE TABLE

```javascript
// ❌ SALAH — CREATE INDEX sebelum tabel ada
db.exec(`CREATE INDEX ... ON cbt_jawaban(...)`);
db.exec(`CREATE TABLE IF NOT EXISTS cbt_jawaban ...`);

// ✅ BENAR — tabel dulu, index kemudian
db.exec(`CREATE TABLE IF NOT EXISTS cbt_jawaban ...`);
db.exec(`CREATE INDEX IF NOT EXISTS ... ON cbt_jawaban(...)`);
```

### 4. Migration Kolom Baru

Selalu tambahkan migration `ALTER TABLE` untuk backward compatibility:
```javascript
try { db.exec(`ALTER TABLE cbt_soal ADD COLUMN opsi_e TEXT`); } catch(_) {}
try { db.exec(`ALTER TABLE cbt_soal ADD COLUMN teks_bacaan TEXT`); } catch(_) {}
try { db.exec(`ALTER TABLE cbt_soal ADD COLUMN teks_bacaan_id TEXT`); } catch(_) {}
```

### 5. cbt-siswa.html — Tetap HTML, Bukan EJS, JANGAN DIUBAH

File ini **tidak boleh** diubah jadi EJS dan **tidak boleh dimodifikasi sembarangan** karena:
- Harus bisa diakses publik tanpa login
- PWA + Service Worker butuh file statis
- Data dinamis (nama sekolah, domain) di-fetch via `/api/health`
- Sudah production-ready dan digunakan siswa via browser & PWA

**Untuk modifikasi tampilan APK** → gunakan `cbt-siswa-app.html` (file terpisah).

### 6. Dua File CBT Siswa — Prinsip Pemisahan

```
cbt-siswa.html      → PWA + web browser — TIDAK PERNAH DIUBAH
cbt-siswa-app.html  → Capacitor APK     — bebas dimodifikasi
js/cbt-offline.js   → shared oleh keduanya
```

`cbt-siswa-app.html` dibuat dari copy `cbt-siswa.html` dengan perbedaan:
- Tidak ada Service Worker registration
- Tidak ada PWA meta tags
- Tidak ada `requestFullscreen()` (ditangani `MainActivity.java`)
- Bebas ganti CSS/tampilan/library (DaisyUI, dll)

### 7. require() di routes — Taruh di Luar module.exports

```javascript
// ❌ SALAH
module.exports = function(app) {
  const mcpDb = require('../db/mcp');
}

// ✅ BENAR
const mcpDb = require('../db/mcp');
module.exports = function(app) { ... }
```

### 8. API Endpoint — Selalu cache: 'no-store'

Semua `fetch()` ke `/api/` **wajib** tambah `cache: 'no-store'` agar Service Worker tidak meng-cache response API:
```javascript
const r = await fetch('/api/cbt/sessions/.../jawaban', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  cache: 'no-store',  // ← wajib untuk semua API call
});
```

### 9. Service Worker — Offline Response HARUS 503

Di `sw.js`, response offline untuk POST jawaban **harus** status `503` (bukan `202`):
```javascript
// ❌ SALAH — 202 dianggap r.ok=true, jawaban dianggap sudah sync
return new Response(JSON.stringify({offline:true}), { status: 202 });

// ✅ BENAR — 503 membuat r.ok=false, client akan enqueue
return new Response(JSON.stringify({offline:true, queued:true}), { status: 503 });
```

---

## Database Schema

### cbt.db (satu file, satu koneksi)

```sql
cbt_sessions (id, name, mapel, kelas, status, token, token_interval,
              token_expires_at, duration, started_at, ended_at, max_points)
cbt_soal (id, session_id, nomor, tipe, soal, opsi_a..opsi_e, kunci,
          bobot, pembahasan, teks_bacaan, teks_bacaan_id)
cbt_jawaban (id, session_id, user_email, nomor, jawaban, is_correct, nilai, saved_at)
cbt_participants (id, session_id, user_email, user_name, status, room_id, joined_at)
cbt_cheat_log (id, session_id, user_email, event_type, detail, logged_at)
cbt_packages (id, name, soal_source, status, created_at)
cbt_rooms (id, package_id, room_name, token, pengawas_token, status)
mcp_packages (id, name, mapel, kelas, config, status, total_soal, ...)
mcp_soal (id, package_id, no, tipe, soal, opsi_a..opsi_e, kunci, bobot,
          pembahasan, teks_bacaan, teks_bacaan_id, review_status)
bank_soal (id, mapel, kelas, bab, tingkat, tipe, soal, opsi_a..opsi_e,
           kunci, bobot, sumber, teks_bacaan, teks_bacaan_id, created_at, updated_at)
bank_soal_tags (soal_id, tag)
bank_soal_usage (soal_id, session_id, dipakai_at)
```

### gws_auth.db

```sql
gws_users (id, email, name, role, password_hash, is_active, force_change,
           last_login, created_at)
-- role: 'super_admin' | 'operator' | 'guru'
gws_sessions (id, user_id, created_at, expires_at)
gws_user_access (user_id, menu, can_access)
sspr_log (id, email, ip, status, created_at)
sspr_rate (ip, attempts, blocked_until)
```

### audit.db

```sql
audit_log (id, user_email, action, target, detail, ip, created_at)
```

---

## Soal — Format Data

```javascript
// Format flat (dari DB / bank soal)
{
  soal: "...", tipe: "PG",
  opsi_a: "...", opsi_b: "...", opsi_c: "...", opsi_d: "...", opsi_e: "...",
  kunci: "A", bobot: 2,
  teks_bacaan: "Teks cerita...",
  teks_bacaan_id: "teks-1"
}

// Format object (untuk cbt-siswa.html / import)
{
  no: 1, tipe: "PG", soal: "...",
  opsi: { A: "...", B: "...", C: "...", D: "...", E: "..." },
  kunci: "A", bobot: 2,
  teks_bacaan: "Teks cerita...",
  teks_bacaan_id: "teks-1"
}
```

---

## MCP Generator — Alur Generate Soal

```
Upload PDF
   ↓ POST /api/mcp/extract-pdf
   Teks materi diekstrak

   ↓ POST /api/mcp/gen-soal
   Ollama AI generate soal (2 mode):
   - Normal: JSON { "soal": [...] }
   - withTeksBacaan: JSON { "teks_bacaan": [...], "soal": [...] }

   ↓ mcpDb.createPackage() → simpan ke mcp_packages + mcp_soal

Review (mcpOpenSoal):
   - Tampil teks bacaan (editable) di atas soal
   - Opsi A-E + kunci + pembahasan
   - Status: approved / rejected / pending

Export:
   ├─ 📄 Export DOCX → ZIP download
   ├─ 📚 Simpan ke Bank Soal → POST /api/bank/bulk
   └─ 📋 Import ke CBT → POST /api/mcp/:id/import-to-cbt
```

---

## Sistem Login — 3 Role

| Role | Akses |
|---|---|
| `super_admin` | Semua fitur termasuk Security, Drive Audit, Kelola Admin |
| `operator` | User Manager, CBT, MCP, Bank Soal, SSPR Log |
| `guru` | CBT, MCP Generator, Bank Soal, Classroom |

Siswa dan Pengawas **tidak perlu akun** — akses via token ujian.

### PUBLIC_PAGES (tidak perlu login)
```javascript
'/login.html', '/setup.html', '/cbt-siswa.html', '/cbt-siswa-app.html',
'/monitor-ruang.html', '/nilai-essay.html', '/reset.html'
```

### PUBLIC_API (tidak perlu login)
```javascript
'/api/auth/login', '/api/auth/setup',
'/api/cbt/validate-token', '/api/cbt/sessions/',
'/api/cbt-package/pengawas/', '/api/nilai-essay', '/api/sspr', '/api/health'
```

---

## Capacitor APK — CBT Siswa Android

### Konsep Arsitektur

```
Siswa buka browser / add to homescreen
        ↓
cbt-siswa.html          ← PWA, tidak pernah diubah

Siswa install APK Android
        ↓
capacitor.config.json → url: .../cbt-siswa-app.html
        ↓
WebView load cbt-siswa-app.html dari server
        ↓
Semua API tetap sama (/api/cbt/...)
```

### capacitor.config.json

```json
{
  "appId": "id.sch.karyabangsa.cbt",
  "appName": "CBT Siswa",
  "webDir": "www",
  "server": {
    "url": "https://gws.karyabangsa.sch.id/cbt-siswa-app.html",
    "cleartext": false,
    "androidScheme": "https"
  },
  "android": {
    "backgroundColor": "#0c0f18"
  },
  "plugins": {
    "SplashScreen": {
      "launchShowDuration": 2000,
      "backgroundColor": "#0c0f18",
      "showSpinner": false
    },
    "StatusBar": {
      "overlaysWebView": true,
      "style": "DARK",
      "backgroundColor": "#00000000"
    }
  }
}
```

### MainActivity.java — Fullscreen Immersive

File: `android/app/src/main/java/id/sch/karyabangsa/cbt/MainActivity.java`

```java
package id.sch.karyabangsa.cbt;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setFullscreen();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) setFullscreen();
    }

    private void setFullscreen() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(
                    android.view.WindowInsets.Type.statusBars() |
                    android.view.WindowInsets.Type.navigationBars()
                );
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
        } else {
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            );
        }
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN);
    }
}
```

### styles.xml — Fullscreen Theme

File: `android/app/src/main/res/values/styles.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:windowFullscreen">true</item>
        <item name="android:windowContentOverlay">@null</item>
    </style>

    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
        <item name="android:windowFullscreen">true</item>
    </style>
</resources>
```

### colors.xml

File: `android/app/src/main/res/values/colors.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#0c0f18</color>
    <color name="colorPrimaryDark">#0c0f18</color>
    <color name="colorAccent">#60a5fa</color>
    <color name="splash_background">#0c0f18</color>
</resources>
```

### Warn Bar Layout di cbt-siswa-app.html

Warn bar diposisikan `fixed top:0` sehingga mengisi area status bar yang sudah disembunyikan:

```css
/* Warn bar menempati posisi status bar */
#warn-bar {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 500;
  height: 26px;
  background: rgba(251,191,36,.12);
  border-bottom: 1px solid rgba(251,191,36,.2);
  color: var(--amber);
  text-align: center;
  padding: 0 16px;
  line-height: 26px;
  font-size: 11px;
  font-weight: 600;
  display: none;
}

/* Kompensasi tinggi warn-bar */
#sc-exam {
  flex-direction: column;
  padding-top: 26px;
}
```

### Plugin Capacitor yang Digunakan

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npm install @capacitor/splash-screen @capacitor/status-bar
npm install @capacitor/screen-orientation @capacitor/keep-awake
```

Penggunaan di `cbt-siswa-app.html`:
```javascript
// Saat ujian mulai
if (window.isCapacitor) {
  try { await Capacitor.Plugins.ScreenOrientation.lock({ orientation: 'portrait' }); } catch(_) {}
  try { await Capacitor.Plugins.KeepAwake.keepAwake(); } catch(_) {}
}

// Saat ujian selesai
if (window.isCapacitor) {
  try { await Capacitor.Plugins.ScreenOrientation.unlock(); } catch(_) {}
  try { await Capacitor.Plugins.KeepAwake.allowSleep(); } catch(_) {}
}
```

Deteksi Capacitor:
```javascript
// Di bagian atas <head>
window.isCapacitor = typeof Capacitor !== 'undefined';

// Service Worker — TIDAK diregister di APK
if ('serviceWorker' in navigator && !window.isCapacitor) {
  // register SW hanya di browser
}
```

### Plugin Native yang Tersedia (Opsional)

| Plugin | Fungsi | Berguna untuk |
|---|---|---|
| `@capacitor/network` | Status koneksi akurat | Ganti `navigator.onLine` |
| `@capacitor/push-notifications` | Push notif via FCM | Kirim token ujian ke siswa |
| `@capacitor/geolocation` | GPS real-time | Verifikasi lokasi sekolah |
| `@capacitor/device` | Info device + UUID | Log device di audit ujian |
| `@capacitor/camera` | Foto/scan QR | Verifikasi identitas siswa |
| `@capacitor/battery` | Level baterai | Peringatan baterai lemah |
| `@capacitor/biometric-auth` | Fingerprint / Face ID | Login tanpa ketik token |
| `@capacitor/haptics` | Getar feedback | Konfirmasi pilih jawaban |

### Generate Icons

Jalankan `node generate-icons.js` untuk generate semua ukuran:

```
icons-output/
├── android/
│   ├── mipmap-mdpi/     ic_launcher.png (48px), ic_launcher_round.png, ic_launcher_foreground.png
│   ├── mipmap-hdpi/     (72px)
│   ├── mipmap-xhdpi/    (96px)
│   ├── mipmap-xxhdpi/   (144px)
│   ├── mipmap-xxxhdpi/  (192px)
│   └── drawable/        splash.png (2732×2732), splash_land.png (2732×1536)
└── web/
    ├── icon-192.png     → public/icons/icon-192.png
    ├── icon-512.png     → public/icons/icon-512.png
    └── icon-180.png     → public/icons/icon-180.png (Apple touch icon)
```

### Distribusi APK

Taruh APK di server, siswa download langsung:
```
https://gws.karyabangsa.sch.id/downloads/cbt-siswa.apk
```

Tambah di `server.js`:
```javascript
app.use('/downloads', express.static(path.join(__dirname, 'public', 'downloads')));
```

Siswa perlu izinkan "Install from unknown sources" satu kali. Peringatan Play Protect normal — tap "Instal Saja".

### Build APK Release

```bash
cd cbt-app
npx cap sync
npx cap open android
# Di Android Studio: Build → Generate Signed Bundle/APK → APK
# Keystore: cbt-keystore.jks (simpan permanen!)
```

APK hasil: `android/app/release/app-release.apk`

---

## PWA — cbt-siswa.html

### Syarat Install
- HTTPS (atau localhost untuk dev)
- `manifest.json` valid dengan icon **PNG** (bukan SVG)
- Service Worker terdaftar
- Icon 192×192 dan 512×512 (generate dengan `generate-icons.js`)

### iOS
- Harus buka di **Safari** (bukan Chrome di iOS)
- Install via: Share → Tambahkan ke Layar Utama
- `display: standalone` (bukan `fullscreen`)
- Background Sync tidak support → pakai interval fallback di `cbt-offline.js`
- Untuk APK iOS butuh: Mac + Xcode + Apple Developer Account ($99/tahun)
- Alternatif gratis: PWA via Safari (sudah support dengan meta tags yang ada)

### Offline Sync

```javascript
// cbt-offline.js — shared antara PWA dan APK
CBTOffline.init(sessionId, userEmail, roomId)
CBTOffline.sendAnswer(nomor, jawaban)  // sync ke IndexedDB + server
CBTOffline.submitWithFlush(timeoutMs)  // submit + drain queue
CBTOffline.clearSession()
```

---

## Matematika — KaTeX

```
Inline:   $x^2 + y^2 = r^2$
Display:  $$\sum_{i=1}^{n} x_i$$
Logaritma: $^5\log 125$
Pecahan:  $\frac{a}{b}$
Akar:     $\sqrt{x}$
```

KaTeX dimuat di:
- `views/layout/head.ejs` — untuk dashboard
- `public/cbt-siswa.html` — untuk halaman ujian siswa
- `public/cbt-siswa-app.html` — untuk APK

---

## Konvensi Kode

### Backend (Node.js)
```javascript
app.post('/api/...', async (req, res) => {
  try {
    res.json({ success: true, data: ... });
  } catch(err) { handleError(res, err); }
});
```

### Frontend (Vanilla JS)
```javascript
const r = await fetch('/api/...', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
  cache: 'no-store',  // ← selalu tambahkan ini
});
const j = await r.json();
if (!j.success) throw new Error(j.error);
```

### EJS Templates
```ejs
<%- include('layout/head') %>
<%= school.SCHOOL_SHORT_NAME %>
<%= config.DOMAIN %>
```

---

## Anti-Cheat CBT

Deteksi otomatis saat ujian berlangsung:
- `tab_switch` — pindah tab/window
- `split_screen` — split screen terdeteksi (via resize detection)
- `exit_fullscreen` — keluar dari fullscreen (desktop only, skip di mobile/APK)
- `devtools_attempt` — coba buka developer tools

Setelah N kali pelanggaran (default 3) → jawaban dikumpulkan otomatis.

**Catatan APK:** `exit_fullscreen` detection dinonaktifkan di `cbt-siswa-app.html` karena fullscreen sudah dijamin oleh `MainActivity.java`.

---

## Bug Penting yang Sudah Diselesaikan

| Bug | Penyebab | Fix |
|---|---|---|
| `no such table: main.cbt_jawaban` | Index dibuat sebelum tabel | Pindah CREATE INDEX setelah semua CREATE TABLE |
| `getAllPackages is not a function` | `db/mcp.js` buka koneksi terpisah | Pakai `_db` dari `db/cbt.js` |
| `manifest.json Syntax error` | authMiddleware sebelum express.static | Pindah express.static ke sebelum authMiddleware |
| `fixLatexInSoal is not a function` | Tidak dieksport dari gen_soal.js | Tambah ke module.exports |
| PWA icon invalid (799 bytes) | SVG di manifest, bukan PNG | Generate PNG dengan sharp |
| iOS tidak bisa install PWA | `display: fullscreen` | Ganti ke `standalone` |
| Sidebar tidak muncul di mobile | Tidak ada hamburger button | Tambah ke `index.ejs` |
| Gap hitam di atas APK | `padding-top: env(safe-area-inset-top)` di body | Hapus padding — tidak diperlukan karena fullscreen |
| Gap status bar di APK | `windowTranslucentStatus` tidak cukup | Ganti ke `android:windowFullscreen=true` + `MainActivity.java` immersive |
| Offline sync tidak jalan setelah APK | SW return status `202` saat offline | Ganti ke `503` — `202` dianggap `r.ok=true` sehingga jawaban dianggap sudah sync |
| SW cache response API | Fetch tanpa `cache: 'no-store'` | Tambah `cache: 'no-store'` di semua fetch API |
| SW register di Capacitor WebView | Tidak ada pengecekan `isCapacitor` | `if ('serviceWorker' in navigator && !window.isCapacitor)` |

---

## Script Utilitas

```bash
# Generate PWA icons + Android icons
node generate-icons.js

# Import user dari CSV ke gws_auth.db
node import-gws-users.js gws_users_export.csv --dry-run
node import-gws-users.js gws_users_export.csv
node import-gws-users.js gws_users_export.csv --replace

# Capacitor — sync dan build
cd cbt-app
npx cap sync         # sync config ke Android project
npx cap open android # buka Android Studio

# Cek DB
sqlite3 cbt.db ".tables"
sqlite3 gws_auth.db "SELECT email, role FROM gws_users"
```

---

## Portabilitas Multi-Sekolah

```env
SCHOOL_FULL_NAME=SMK Negeri 1 Pontianak
SCHOOL_SHORT_NAME=SMKN1PTK
SCHOOL_DOMAIN=smkn1ptk.sch.id
SCHOOL_ROOT_OU=/SMK Negeri 1
DEFAULT_TEACHER_OU=/SMK Negeri 1/Guru
DEFAULT_STUDENT_OU=/SMK Negeri 1/Siswa
TEACHER_GROUP=classroom_teachers@smkn1ptk.sch.id
GOOGLE_DOMAIN=smkn1ptk.sch.id
GOOGLE_ADMIN_EMAIL=admin@smkn1ptk.sch.id
GOOGLE_SERVICE_ACCOUNT_FILE=./service-account.json
```

Untuk ganti sekolah di APK: ubah `appId` di `capacitor.config.json` dan `package` di `MainActivity.java`.

---

## Deployment

```
Server: Ubuntu 24.04 + aapanel
Reverse proxy: Cloudflare Tunnel (tidak butuh port forward)
URL: https://gws.karyabangsa.sch.id

# Setelah update file statis (termasuk cbt-siswa-app.html):
# Purge Cloudflare cache → Caching → Configuration → Purge Everything

# APK tidak perlu rebuild jika hanya update HTML/CSS/JS di server
# Rebuild APK hanya jika ada perubahan capacitor.config.json atau plugin native
```

---

*Dikembangkan oleh Sukardi — SMK Karya Bangsa Sintang*
*GWS Manager v2.0 — 2026*