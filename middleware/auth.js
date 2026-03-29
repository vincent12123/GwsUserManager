// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: AUTH
// Cek session cookie setiap request ke halaman/API yang butuh login
// ═══════════════════════════════════════════════════════════════════════════════

const authDb = require('../db/auth');

// Halaman publik — tidak perlu login
const PUBLIC_PAGES = [
  '/login.html',
  '/setup.html',
  '/cbt-siswa.html',
  '/monitor-ruang.html',
  '/nilai-essay.html',
  '/reset.html',
];

// API publik — tidak perlu login
const PUBLIC_API = [
  '/api/auth/login',
  '/api/auth/setup',
  '/api/cbt/validate-token',
  '/api/cbt/sessions/',         // siswa butuh akses soal
  '/api/cbt-package/pengawas/', // monitor pengawas
  '/api/nilai-essay',           // penilaian essay guru — semua sub-path
  '/api/sspr',              // SSPR kiosk — publik
];

// Role yang diizinkan per endpoint API (prefix match)
const ROLE_RULES = {
  // Hanya super_admin
  '/api/security':    ['super_admin'],
  '/api/drive-audit': ['super_admin'],
  '/api/audit':       ['super_admin'],

  // super_admin + operator
  '/api/users':       ['super_admin','operator'],
  '/api/orgunits':    ['super_admin','operator'],
  '/api/groups':      ['super_admin','operator'],
  '/api/cbt-package': ['super_admin','operator'],
  '/api/dashboard':   ['super_admin','operator','guru'],

  // Semua role yang login
  '/api/cbt':         ['super_admin','operator','guru'],
  '/api/mcp':         ['super_admin','operator','guru'],
  '/api/classroom':   ['super_admin','operator','guru'],
  '/api/content':     ['super_admin','operator','guru'],
  '/api/forms':       ['super_admin','operator','guru'],
};

function isPublicPath(path) {
  if (PUBLIC_PAGES.some(p => path === p || path.startsWith(p.replace('.html','')))) return true;
  if (PUBLIC_API.some(p => path.startsWith(p))) return true;
  // Asset statis — tidak perlu login
  if (path.match(/\.(js|css|png|jpg|ico|json|woff|woff2|ttf|svg|webp|webmanifest)$/)) return true;
  // Service worker harus publik
  if (path === '/sw.js') return true;
  if (path === '/' || path === '/index.html') return false; // perlu login
  return false;
}

function getRequiredRoles(apiPath) {
  for (const [prefix, roles] of Object.entries(ROLE_RULES)) {
    if (apiPath.startsWith(prefix)) return roles;
  }
  return null; // tidak ada aturan khusus
}

// ── Middleware utama ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  // Selalu izinkan OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') return next();

  const path = req.path;

  // Setup page — hanya bisa diakses kalau belum ada user
  if (path === '/setup.html' || path.startsWith('/api/auth/setup')) {
    if (authDb.hasAnyUser()) {
      return path.startsWith('/api/')
        ? res.status(403).json({ error: 'Setup sudah selesai' })
        : res.redirect('/');
    }
    return next();
  }

  // Path publik — langsung lanjut
  if (isPublicPath(path)) return next();

  // Cek session cookie
  const sessionId = req.cookies?.gwsSession;
  if (!sessionId) {
    return path.startsWith('/api/')
      ? res.status(401).json({ error: 'Belum login', redirect: '/login.html' })
      : res.redirect('/login.html');
  }

  const sessionData = authDb.getSession(sessionId);
  if (!sessionData) {
    res.clearCookie('gwsSession');
    return path.startsWith('/api/')
      ? res.status(401).json({ error: 'Session expired', redirect: '/login.html' })
      : res.redirect('/login.html');
  }

  // Pasang user ke request
  req.gwsUser    = sessionData.user;
  req.gwsSession = sessionData.session;

  // Cek role untuk API
  if (path.startsWith('/api/')) {
    const required = getRequiredRoles(path);
    if (required && !required.includes(sessionData.user.role)) {
      return res.status(403).json({
        error: `Akses ditolak — role ${sessionData.user.role} tidak diizinkan`,
        required,
      });
    }
  }

  next();
}

// ── Helper untuk route handler ────────────────────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.gwsUser) return res.status(401).json({ error: 'Belum login' });
    if (!roles.includes(req.gwsUser.role)) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };