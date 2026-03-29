// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: SSPR — Self-Service Password Reset
// Endpoint publik (tidak butuh login GWS Manager)
// ═══════════════════════════════════════════════════════════════════════════════

const ssprDb = require('../db/sspr');
const { getAdminClient, handleError } = require('../helpers/auth');
const { DOMAIN } = require('../config');

const ALLOWED_DOMAIN = (DOMAIN || require('../config').SCHOOL_DOMAIN).toLowerCase();

// Jam operasional: 05.00 – 22.00 WIB
function isOperationalHour() {
  const hour = new Date().getHours();
  return hour >= 5 && hour < 22;
}

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || '0.0.0.0';
}

function validatePassword(password) {
  if (!password || password.length < 6) return 'Password minimal 6 karakter';
  if (!/[a-zA-Z]/.test(password))       return 'Password harus mengandung huruf';
  if (!/[0-9]/.test(password))           return 'Password harus mengandung angka';
  return null;
}

module.exports = function(app) {

  // ── POST /api/sspr/verify — cek email valid di GWS ───────────────────────
  app.post('/api/sspr/verify', async (req, res) => {
    try {
      const ip    = getIP(req);
      const { email } = req.body;

      if (!email) return res.status(400).json({ success: false, error: 'Email wajib diisi' });

      const emailLower = email.toLowerCase().trim();
      const domain     = emailLower.split('@')[1];

      // Cek domain
      if (domain !== ALLOWED_DOMAIN) {
        return res.status(400).json({
          success: false,
          error:   `Hanya akun @${ALLOWED_DOMAIN} yang dapat mereset password di sini`,
        });
      }

      // Cek jam operasional
      if (!isOperationalHour()) {
        return res.status(403).json({
          success: false,
          error:   'Layanan reset password hanya tersedia pukul 05.00 – 22.00',
        });
      }

      // Rate limit
      const rateCheck = ssprDb.checkRateLimit(ip, emailLower);
      if (rateCheck.blocked) {
        ssprDb.addLog(emailLower, 'blocked', ip, req.headers['user-agent']);
        return res.status(429).json({ success: false, error: rateCheck.reason });
      }

      // Verifikasi ke GWS — apakah akun ada dan aktif
      try {
        const admin    = getAdminClient();
        const userInfo = await admin.users.get({
          userKey: emailLower,
          fields:  'primaryEmail,suspended,name',
        });

        if (userInfo.data.suspended) {
          ssprDb.recordAttempt(ip, false);
          ssprDb.addLog(emailLower, 'failed_suspended', ip, req.headers['user-agent']);
          // Pesan generic — tidak memberi tahu akun suspended
          return res.status(400).json({
            success: false,
            error:   'Akun tidak dapat direset. Hubungi Admin sekolah.',
          });
        }

        // Akun valid
        res.json({
          success: true,
          name:    userInfo.data.name?.givenName || userInfo.data.name?.fullName || '',
        });

      } catch(gwsErr) {
        // Akun tidak ditemukan atau error GWS
        ssprDb.recordAttempt(ip, false);
        ssprDb.addLog(emailLower, 'failed_notfound', ip, req.headers['user-agent']);
        // Pesan generic — tidak memberi tahu apakah email ada atau tidak
        return res.status(400).json({
          success: false,
          error:   'Email tidak ditemukan atau tidak terdaftar. Periksa kembali.',
        });
      }

    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/sspr/reset — reset password ────────────────────────────────
  app.post('/api/sspr/reset', async (req, res) => {
    try {
      const ip    = getIP(req);
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email dan password wajib diisi' });
      }

      const emailLower = email.toLowerCase().trim();
      const domain     = emailLower.split('@')[1];

      if (domain !== ALLOWED_DOMAIN) {
        return res.status(400).json({ success: false, error: 'Domain tidak valid' });
      }

      if (!isOperationalHour()) {
        return res.status(403).json({
          success: false,
          error:   'Layanan reset password hanya tersedia pukul 05.00 – 22.00',
        });
      }

      // Rate limit
      const rateCheck = ssprDb.checkRateLimit(ip, emailLower);
      if (rateCheck.blocked) {
        ssprDb.addLog(emailLower, 'blocked', ip, req.headers['user-agent']);
        return res.status(429).json({ success: false, error: rateCheck.reason });
      }

      // Validasi password
      const pwErr = validatePassword(password);
      if (pwErr) {
        return res.status(400).json({ success: false, error: pwErr });
      }

      // Reset via GWS Directory API
      try {
        const admin = getAdminClient();
        await admin.users.update({
          userKey:     emailLower,
          requestBody: {
            password:              password,
            changePasswordAtNextLogin: false,
          },
        });

        // Sukses
        ssprDb.recordAttempt(ip, true);
        ssprDb.recordEmailCooldown(emailLower);
        ssprDb.addLog(emailLower, 'success', ip, req.headers['user-agent']);

        res.json({ success: true });

      } catch(gwsErr) {
        ssprDb.recordAttempt(ip, false);
        ssprDb.addLog(emailLower, 'failed_gws', ip, req.headers['user-agent']);
        return res.status(500).json({
          success: false,
          error:   'Gagal mereset password. Coba lagi atau hubungi Admin.',
        });
      }

    } catch(err) { handleError(res, err); }
  });

  // ── GET /api/sspr/log — log reset (admin only) ────────────────────────────
  app.get('/api/sspr/log', (req, res) => {
    try {
      const { limit, offset, email } = req.query;
      const logs  = ssprDb.getLogs({ limit, offset, email });
      const total = ssprDb.getLogTotal(email);
      const stats = ssprDb.getLogStats();
      res.json({ success: true, data: logs, total, stats });
    } catch(err) { handleError(res, err); }
  });

  // ── DELETE /api/sspr/log — hapus log lama (admin only) ───────────────────
  app.delete('/api/sspr/log', (req, res) => {
    try {
      const days    = parseInt(req.query.days || 30);
      const deleted = ssprDb.deleteLogs(days);
      res.json({ success: true, deleted });
    } catch(err) { handleError(res, err); }
  });

};