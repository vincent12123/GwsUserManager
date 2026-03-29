# 🏫 GWS Manager v2.0

Platform manajemen **Google Workspace** terpadu untuk sekolah — dibangun di atas Node.js, SQLite, dan Google Workspace API. Dirancang untuk berjalan di server lokal sekolah tanpa biaya SaaS tambahan.

> Dikembangkan untuk **SMK Karya Bangsa Sintang**, dapat dikonfigurasi untuk sekolah lain melalui file `.env`.

---

## ✨ Fitur Utama

### 👥 Manajemen Akun
| Fitur | Deskripsi |
|---|---|
| **User Manager** | Tambah, edit, suspend, hapus akun Google Workspace |
| **Bulk Import** | Import ratusan akun sekaligus dari CSV |
| **Classroom Manager** | Kelola semua kelas Google Classroom tanpa masuk satu per satu |
| **Kelola Admin** | Tambah & atur hak akses operator dan guru |

### 📝 CBT — Ujian Online
| Fitur | Deskripsi |
|---|---|
| **CBT Manager** | Buat dan kelola sesi ujian, monitor live, export nilai |
| **Multi-Ruang CBT** | Ujian besar dengan banyak ruang, token unik per ruang |
| **Anti-Cheat** | Deteksi pindah tab, split screen, keluar fullscreen, DevTools |
| **Timer Server-Side** | Waktu dihitung dari server — tidak bisa dimanipulasi |
| **MCP Generator AI** | Generate soal otomatis dari PDF menggunakan Ollama (AI lokal) |
| **Bank Soal** | Library soal permanen — simpan sekali, pakai di banyak sesi |
| **Penilaian Essay** | Guru nilai jawaban essay via link tanpa perlu login |
| **CBT PWA** | Halaman ujian bisa diinstall sebagai app + sync jawaban saat offline |

### 🔑 Akses & Keamanan
| Fitur | Deskripsi |
|---|---|
| **Login 3 Role** | Super Admin, Operator, Guru — menu otomatis menyesuaikan role |
| **SSPR Kiosk** | Reset password mandiri siswa via QR Code — tanpa campur tangan Admin |
| **Security Center** | Monitor device, login activity, VPN, storage, sharing alerts |
| **Drive Audit** | Investigasi kebocoran data diam-diam via Google API |

---

## 🛠 Tech Stack

```
Runtime      : Node.js v22
Framework    : Express.js
Database     : SQLite (better-sqlite3)
Template     : EJS
Auth         : Cookie-based session + bcryptjs
AI Engine    : Ollama (berjalan lokal)
Google APIs  : Admin Directory, Classroom, Drive, Sheets
Frontend     : Vanilla JS + HTML
PWA          : Service Worker + IndexedDB
```

---

## 📦 Prasyarat

- **Node.js** v18 atau lebih baru
- **Google Workspace** account dengan Domain Admin
- **Google Cloud Project** dengan Service Account
- **Ollama** (opsional, untuk MCP Generator AI)

---

## ⚡ Instalasi

### 1. Clone repo

```bash
git clone https://github.com/username/gws-manager.git
cd gws-manager
```

### 2. Install dependencies

```bash
npm install
```

### 3. Konfigurasi environment

```bash
cp .env.example .env
```

Edit `.env` sesuai konfigurasi sekolah:

```env
GOOGLE_SERVICE_ACCOUNT_FILE=./nama-service-account.json
GOOGLE_ADMIN_EMAIL=admin@sekolah.sch.id
GOOGLE_DOMAIN=sekolah.sch.id
PORT=3000

SCHOOL_FULL_NAME=SMK Karya Bangsa Sintang
SCHOOL_SHORT_NAME=SMK Karya Bangsa
SCHOOL_DOMAIN=karyabangsa.sch.id
SCHOOL_ROOT_OU=/Karya Bangsa School
```

### 4. Tambahkan Service Account

Letakkan file JSON Service Account Google di root project:

```
gws-manager/
└── nama-service-account.json   ← letakkan di sini
```

> ⚠️ **Jangan pernah commit file ini ke GitHub.** Sudah ada di `.gitignore`.

### 5. Generate PWA Icons

```bash
node generate-icons.js
```

### 6. Jalankan server

```bash
node server.js
```

### 7. Setup pertama kali

Buka browser → `http://localhost:3000/setup.html`

Buat akun Super Admin pertama, lalu login.

---

## 🗂 Struktur Folder

```
GwsUserManager/
├── config/
│   └── index.js              # Konfigurasi global (domain, OU, nama sekolah)
├── db/
│   ├── auth.js               # User & session GWS Manager
│   ├── bank.js               # Bank soal permanen
│   ├── cbt.js                # Sesi CBT, soal, jawaban
│   ├── mcp.js                # MCP Generator AI
│   ├── package.js            # Multi-Ruang CBT
│   └── sspr.js               # SSPR Kiosk log & rate limit
├── helpers/
│   └── auth.js               # Google API client helper
├── middleware/
│   └── auth.js               # Auth middleware + role check
├── routes/                   # Express route handlers
├── public/
│   ├── cbt-siswa.html        # Halaman ujian siswa (PWA)
│   ├── monitor-ruang.html    # Monitor pengawas ruang
│   ├── nilai-essay.html      # Penilaian essay guru
│   ├── reset.html            # SSPR Kiosk reset password
│   ├── sw.js                 # Service Worker (offline sync)
│   ├── manifest.json         # PWA manifest
│   ├── css/main.css          # Global stylesheet
│   ├── icons/                # PWA icons
│   └── js/                   # Frontend modules
├── views/
│   ├── index.ejs             # SPA utama
│   ├── layout/               # head, sidebar, scripts
│   ├── pages/                # Halaman per modul
│   └── partials/             # Modal, dll
├── tools/
│   ├── extract_pdf.js        # PDF text extractor
│   └── gen_soal.js           # Soal generator
├── server.js                 # Entry point
├── generate-icons.js         # PWA icon generator
├── .env.example              # Template environment variables
└── .gitignore
```

---

## 🔐 Pengaturan Google Service Account

### Di Google Cloud Console

1. Buat project baru atau gunakan yang sudah ada
2. Aktifkan API berikut:
   - Admin SDK API
   - Google Classroom API
   - Google Drive API
   - Google Sheets API
3. Buat **Service Account**
4. Download file JSON key
5. Di **Google Workspace Admin** → Security → API Controls → Domain-wide Delegation
6. Tambahkan Client ID Service Account dengan scopes:

```
https://www.googleapis.com/auth/admin.directory.user
https://www.googleapis.com/auth/admin.directory.orgunit
https://www.googleapis.com/auth/admin.directory.group
https://www.googleapis.com/auth/classroom.courses
https://www.googleapis.com/auth/classroom.rosters
https://www.googleapis.com/auth/classroom.announcements
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/spreadsheets
```

---

## 👤 Hak Akses

| Fitur | Super Admin | Operator | Guru |
|---|:---:|:---:|:---:|
| Dashboard | ✅ | ✅ | ✅ |
| User Manager | ✅ | ✅ | ❌ |
| Classroom Manager | ✅ | ✅ | ✅ |
| CBT Manager | ✅ | ✅ | ✅ |
| Multi-Ruang CBT | ✅ | ✅ | ❌ |
| MCP Generator | ✅ | ✅ | ✅ |
| Bank Soal | ✅ | ✅ | ✅ |
| Penilaian Essay | ✅ (link) | ✅ (link) | ✅ (link) |
| SSPR Log | ✅ | ✅ | ❌ |
| Security Center | ✅ | ❌ | ❌ |
| Drive Audit | ✅ | ❌ | ❌ |
| Kelola Admin | ✅ | ❌ | ❌ |

> **Siswa & Pengawas** tidak butuh akun GWS Manager — akses via token ujian dan link monitor.

---

## 📱 SSPR Kiosk — Reset Password Mandiri

Siswa bisa reset password Google mereka sendiri:

1. Scan QR Code yang ditempel di mading / lab komputer
2. Masukkan email sekolah
3. Buat password baru (min. 6 karakter, huruf + angka)
4. Selesai — bisa login dalam 30 detik

**Keamanan:** Rate limiting 5 percobaan/IP, cooldown 2 jam per akun, hanya jam 05.00–22.00.

URL kiosk: `http://[IP-SERVER]:3000/reset`

---

## 🤖 MCP Generator AI (Ollama)

Generate soal ujian otomatis dari materi PDF:

### Install Ollama

```bash
# Linux/Mac
curl -fsSL https://ollama.ai/install.sh | sh

# Windows
# Download installer dari https://ollama.ai
```

### Pull model

```bash
ollama pull llama3.2
# atau model lain sesuai spesifikasi server
```

Ollama berjalan lokal di `http://localhost:11434` — data tidak keluar ke internet.

---

## 📲 PWA — Ujian Offline

Halaman ujian siswa (`/cbt-siswa.html`) mendukung mode **Progressive Web App**:

- **Install** sebagai app di HP/laptop — tidak perlu buka browser
- **Offline Sync** — jawaban disimpan lokal jika koneksi putus, sync otomatis saat online
- **Grace period** 5 menit setelah waktu habis untuk sync jawaban offline

> ⚠️ PWA hanya berfungsi di HTTPS atau `localhost`. Untuk akses LAN sekolah, diperlukan sertifikat SSL.

---

## 🗺 Roadmap

- [x] User Manager + Bulk Import
- [x] Classroom Manager + Broadcast
- [x] CBT Engine + Anti-Cheat
- [x] Multi-Ruang CBT
- [x] MCP Generator AI
- [x] Bank Soal Permanen
- [x] Penilaian Essay Standalone
- [x] Security Center + Drive Audit
- [x] Sistem Login 3 Role
- [x] SSPR Kiosk
- [x] CBT PWA + Offline Sync
- [ ] Shared Drive Automator per Jurusan
- [ ] Backup & Restore CBT
- [ ] Bulk Reset Password + PDF Slip
- [ ] Rapor Nilai Siswa PDF

---

## 🤝 Kontribusi

Pull request dipersilakan. Untuk perubahan besar, buka issue terlebih dahulu.

Pastikan tidak ada data sensitif (service account, .env, .db) yang ikut di-commit.

---

## 📄 Lisensi

MIT License — bebas digunakan dan dimodifikasi untuk keperluan pendidikan.

---

<div align="center">
  <sub>Dibuat dengan ❤️ oleh <strong>Sukardi</strong> · SMK Karya Bangsa Sintang</sub>
</div>