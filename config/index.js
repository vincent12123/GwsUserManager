// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG — GWS Manager
// Semua konstanta global dari environment variables + konfigurasi sekolah
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // === Google Workspace & Server Config ===
  KEY_FILE:         process.env.GOOGLE_SERVICE_ACCOUNT_FILE || './service-account.json',
  ADMIN_EMAIL:      process.env.GOOGLE_ADMIN_EMAIL,
  DOMAIN:           process.env.GOOGLE_DOMAIN,
  PORT:             process.env.PORT || 3000,
  DEFAULT_PASSWORD: process.env.DEFAULT_PASSWORD || 'sintang2026',

  // === KONFIGURASI SEKOLAH (baru) ===
  // Ubah di sini saja kalau mau pakai untuk sekolah lain
  SCHOOL_FULL_NAME:  process.env.SCHOOL_FULL_NAME  || "Sekolah Anda",
  SCHOOL_SHORT_NAME: process.env.SCHOOL_SHORT_NAME || "ForgeEdu",
  SCHOOL_DOMAIN:     process.env.SCHOOL_DOMAIN     || "karyabangsa.sch.id",

  // Root Org Unit paling atas (sesuai screenshot Google Admin kamu)
  SCHOOL_ROOT_OU:    process.env.SCHOOL_ROOT_OU    || "/Karya Bangsa School",

  // OU default yang paling sering dipakai (bisa di-override lewat .env)
  DEFAULT_TEACHER_OU: process.env.DEFAULT_TEACHER_OU || "/Karya Bangsa School/SMK-Karya-Bangsa/Guru",
  DEFAULT_STUDENT_OU: process.env.DEFAULT_STUDENT_OU || "/Karya Bangsa School/SMK-Karya-Bangsa/Siswa",
  DEFAULT_STAFF_OU:   process.env.DEFAULT_STAFF_OU   || "/Karya Bangsa School/SMK-Karya-Bangsa/TU",

  // Informasi tambahan
  VERSION: "2.1",
  APP_NAME: "GWS Manager"
};