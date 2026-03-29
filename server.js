require('dotenv').config();

const express      = require('express');
const path         = require('path');
const cookieParser = require('cookie-parser');
const authDb       = require('./db/auth');
const { authMiddleware } = require('./middleware/auth');

// Load config dari folder config/index.js
const config = require('./config');

const app = express();

// Expose config ke semua EJS template
app.locals.school = config;     // ← ini yang paling penting
app.locals.config = config;

// ── MIDDLEWARE ─────────────────────────────────────
app.use(require('cors')({ credentials: true, origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Setup EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files dulu — sebelum auth, supaya manifest.json, sw.js, css, js bisa diakses tanpa login
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware — untuk halaman dan API yang butuh login
app.use(authMiddleware);

// Dynamic manifest — nama sekolah dari config
app.get('/manifest.json', (req, res) => {
  res.json({
    name:             `CBT Siswa — ${config.SCHOOL_SHORT_NAME}`,
    short_name:       'CBT Siswa',
    description:      `Aplikasi Ujian Berbasis Komputer ${config.SCHOOL_FULL_NAME}`,
    start_url:        '/cbt-siswa.html',
    scope:            '/',
    display:          'fullscreen',
    orientation:      'portrait-primary',
    background_color: '#0c0f18',
    theme_color:      '#60a5fa',
    lang:             'id',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  });
});

// Health check
const { getAdminClient } = require('./helpers/auth');
app.get('/api/health', async (req, res) => {
  try {
    const admin = getAdminClient();
    await admin.users.list({ domain: config.DOMAIN, maxResults: 1 });
    res.json({ 
      status: 'ok', 
      domain: config.DOMAIN, 
      adminEmail: config.ADMIN_EMAIL,
      school: config.SCHOOL_SHORT_NAME 
    });
  } catch(err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Routes
const routeFiles = [
  'login', 'bank', 'sspr', 'audit', 'users', 'groups', 'classroom', 'content', 'forms',
  'security', 'cbt', 'cbt-package', 'nilai-essay',
  'dashboard', 'teachers', 'mcp', 'drive-audit',
];

for (const name of routeFiles) {
  try {
    require('./routes/' + name)(app);
    console.log('  ✓ routes/' + name + '.js');
  } catch(err) {
    console.error('  ✗ routes/' + name + '.js GAGAL: ' + err.message);
  }
}

// Setup redirect
app.get('/', (req, res, next) => {
  if (!authDb.hasAnyUser()) return res.redirect('/setup.html');
  next();
});

// API 404
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Endpoint tidak ditemukan: ' + req.method + ' ' + req.path });
  }
  next();
});

// SPA Fallback
app.get('*', (req, res) => {
  const special = ['setup', 'cbt-siswa', 'monitor-ruang', 'nilai-essay', 'reset'];
  const name    = req.path.replace(/^\/|\.html$/g, '');

  if (special.includes(name)) {
    return res.sendFile(path.join(__dirname, 'public', name + '.html'));
  }

  // Login juga pakai EJS sekarang
  if (name === 'login') {
    return res.render('pages/login');
  }

  res.render('index');
});

// Start server
const os = require('os');
function getLANIP() {
  const nets = os.networkInterfaces();
  for (const n of Object.keys(nets))
    for (const net of nets[n])
      if (net.family === 'IPv4' && !net.internal) return net.address;
  return 'localhost';
}

app.listen(config.PORT, '0.0.0.0', () => {
  const ip = getLANIP();
  console.log('\n🚀 GWS Manager berjalan:');
  console.log('   Lokal  → http://localhost:' + config.PORT);
  console.log('   LAN    → http://' + ip + ':' + config.PORT);
  console.log('   CBT    → http://' + ip + ':' + config.PORT + '/cbt-siswa.html');
  console.log('   Monitor → http://' + ip + ':' + config.PORT + '/monitor-ruang.html?token=PXXXXX');
  console.log('   Essay   → http://' + ip + ':' + config.PORT + '/nilai-essay.html\n');
  console.log('🏫 Sekolah : ' + config.SCHOOL_FULL_NAME);
  console.log('📋 Domain  : ' + config.DOMAIN);
  console.log('👤 Admin   : ' + config.ADMIN_EMAIL);
  if (!authDb.hasAnyUser()) {
    console.log('\n⚠️  Belum ada user — buka http://localhost:' + config.PORT + '/setup.html\n');
  }
});