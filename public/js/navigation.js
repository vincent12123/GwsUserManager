// ── NAVIGATION ────────────────────────────────────────────────────────────────

const pages = {
  dashboard: { title: 'Dashboard',         sub: 'Ringkasan Google Workspace' },
  users:     { title: 'User Manager',       sub: 'Kelola akun Google Workspace' },
  bulk:      { title: 'Bulk Tambah User',   sub: 'Import banyak user sekaligus' },
  classroom: { title: 'Classroom Manager',  sub: 'Kelola kelas Google Classroom' },
  audit:     { title: 'Audit Log',          sub: 'Rekaman semua aksi admin' },
  security:  { title: 'Security Center',    sub: 'Device audit & login activity monitoring' },
  cbt:       { title: 'CBT Manager',        sub: 'Computer Based Test — kelola ujian online' },
  mcp:       { title: 'MCP Generator',      sub: 'Generate soal otomatis dengan Ollama AI' },
  driveaudit:{ title: '🔍 Drive Audit',     sub: 'Investigasi kebocoran data — silent audit via API' },
  cbtpkg:      { title: '🚪 Multi-Ruang CBT',      sub: 'Koordinasi ujian besar dengan banyak ruang terpisah' },
  adminusers:  { title: '⚙️ Kelola Akun Admin',  sub: 'Tambah, edit, dan atur akses user GWS Manager' },
  bank:        { title: '📚 Bank Soal',             sub: 'Library soal permanen — simpan, kelola, dan reuse soal' },
  sspr:        { title: '🔑 Log Reset Password',    sub: 'Riwayat reset password mandiri siswa (SSPR Kiosk)' },
};

function navigate(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.querySelector(`[onclick="navigate('${id}')"]`).classList.add('active');
  document.getElementById('topbar-title').textContent = pages[id].title;
  document.getElementById('topbar-sub').textContent   = pages[id].sub;

  // Reset scroll ke atas saat pindah halaman
  window.scrollTo({ top: 0, behavior: 'instant' });

  if (id === 'dashboard') loadDashboard();
  if (id === 'users' && allUsers.length === 0) loadUsers();
  if (id === 'classroom' && allCourses.length === 0) loadCourses();
  if (id === 'audit')      loadAuditLog();
  if (id === 'security')   { /* manual load via buttons */ }
  if (id === 'cbt')        loadCBTSessions();
  if (id === 'mcp')        initMCP();
  if (id === 'driveaudit') { /* manual load via form */ }
  if (id === 'cbtpkg')     loadPackages();
  if (id === 'adminusers') loadAdminUsers();
  if (id === 'bank')        loadBankSoal();
  if (id === 'sspr')        loadSSPRLog();
}