// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: AUTH — Login, Logout, Setup, User Management
// ═══════════════════════════════════════════════════════════════════════════════

const authDb = require('../db/auth');
const { handleError } = require('../helpers/auth');

module.exports = function(app) {

  // ── POST /api/auth/setup — setup pertama kali ─────────────────────────────
  app.post('/api/auth/setup', (req, res) => {
    try {
      if (authDb.hasAnyUser()) {
        return res.status(403).json({ success: false, error: 'Setup sudah selesai' });
      }
      const { email, name, password, confirm } = req.body;
      if (!email || !name || !password) {
        return res.status(400).json({ success: false, error: 'Email, nama, dan password wajib diisi' });
      }
      if (password !== confirm) {
        return res.status(400).json({ success: false, error: 'Password tidak cocok' });
      }
      if (password.length < 6) {
        return res.status(400).json({ success: false, error: 'Password minimal 6 karakter' });
      }
      const user = authDb.createUser({ email, name, role: 'super_admin', password, forceChange: false });
      res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/auth/login ──────────────────────────────────────────────────
  app.post('/api/auth/login', (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email dan password wajib diisi' });
      }

      const user = authDb.verifyPassword(email, password);
      if (!user) {
        return res.status(401).json({ success: false, error: 'Email atau password salah' });
      }

      const ip        = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '';
      const ua        = req.headers['user-agent'] || '';
      const sessionId = authDb.createSession(user.id, ip, ua);

      authDb.updateLastLogin(user.id, ip);

      // Set cookie httpOnly — tidak bisa diakses JS
      res.cookie('gwsSession', sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge:   8 * 60 * 60 * 1000, // 8 jam
      });

      res.json({
        success:     true,
        forceChange: user.force_change === 1,
        user: {
          id:    user.id,
          email: user.email,
          name:  user.name,
          role:  user.role,
          menus: authDb.getRoleMenus(user.role),
        },
      });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/auth/logout ─────────────────────────────────────────────────
  app.post('/api/auth/logout', (req, res) => {
    const sessionId = req.cookies?.gwsSession;
    if (sessionId) authDb.deleteSession(sessionId);
    res.clearCookie('gwsSession');
    res.json({ success: true });
  });

  // ── GET /api/auth/me — info user saat ini ─────────────────────────────────
  app.get('/api/auth/me', (req, res) => {
    if (!req.gwsUser) return res.status(401).json({ error: 'Belum login' });
    res.json({
      success: true,
      user: {
        id:    req.gwsUser.id,
        email: req.gwsUser.email,
        name:  req.gwsUser.name,
        role:  req.gwsUser.role,
        menus: authDb.getRoleMenus(req.gwsUser.role),
        forceChange: req.gwsUser.force_change === 1,
      },
    });
  });

  // ── POST /api/auth/change-password ───────────────────────────────────────
  app.post('/api/auth/change-password', (req, res) => {
    try {
      if (!req.gwsUser) return res.status(401).json({ error: 'Belum login' });
      const { currentPassword, newPassword, confirm } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, error: 'Password lama dan baru wajib diisi' });
      }
      if (newPassword !== confirm) {
        return res.status(400).json({ success: false, error: 'Konfirmasi password tidak cocok' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ success: false, error: 'Password minimal 6 karakter' });
      }
      // Verifikasi password lama
      const check = authDb.verifyPassword(req.gwsUser.email, currentPassword);
      if (!check) {
        return res.status(401).json({ success: false, error: 'Password lama salah' });
      }
      authDb.resetPassword(req.gwsUser.id, newPassword, false);
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

  // ── GET /api/auth/users — daftar user GWS Manager ─────────────────────────
  app.get('/api/auth/users', (req, res) => {
    try {
      if (!req.gwsUser || req.gwsUser.role !== 'super_admin') {
        return res.status(403).json({ error: 'Akses ditolak — hanya Super Admin' });
      }
      res.json({ success: true, data: authDb.getAllUsers() });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/auth/users — tambah user ───────────────────────────────────
  app.post('/api/auth/users', (req, res) => {
    try {
      if (!req.gwsUser || req.gwsUser.role !== 'super_admin') {
        return res.status(403).json({ error: 'Akses ditolak' });
      }
      const { email, name, role, password } = req.body;
      if (!email || !name || !role || !password) {
        return res.status(400).json({ success: false, error: 'Semua field wajib diisi' });
      }
      // Cek email duplikat
      if (authDb.getUserByEmail(email)) {
        return res.status(409).json({ success: false, error: 'Email sudah terdaftar' });
      }
      const user = authDb.createUser({ email, name, role, password, forceChange: true });
      res.json({ success: true, data: user });
    } catch(err) { handleError(res, err); }
  });

  // ── PUT /api/auth/users/:id — edit user ──────────────────────────────────
  app.put('/api/auth/users/:id', (req, res) => {
    try {
      if (!req.gwsUser || req.gwsUser.role !== 'super_admin') {
        return res.status(403).json({ error: 'Akses ditolak' });
      }
      // Jangan edit diri sendiri role-nya
      if (req.params.id === req.gwsUser.id && req.body.role && req.body.role !== req.gwsUser.role) {
        return res.status(400).json({ success: false, error: 'Tidak bisa mengubah role akun sendiri' });
      }
      const updated = authDb.updateUser(req.params.id, req.body);
      res.json({ success: true, data: updated });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/auth/users/:id/reset-password ───────────────────────────────
  app.post('/api/auth/users/:id/reset-password', (req, res) => {
    try {
      if (!req.gwsUser || req.gwsUser.role !== 'super_admin') {
        return res.status(403).json({ error: 'Akses ditolak' });
      }
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, error: 'Password minimal 6 karakter' });
      }
      authDb.resetPassword(req.params.id, newPassword, true);
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

  // ── DELETE /api/auth/users/:id ────────────────────────────────────────────
  app.delete('/api/auth/users/:id', (req, res) => {
    try {
      if (!req.gwsUser || req.gwsUser.role !== 'super_admin') {
        return res.status(403).json({ error: 'Akses ditolak' });
      }
      if (req.params.id === req.gwsUser.id) {
        return res.status(400).json({ success: false, error: 'Tidak bisa menghapus akun sendiri' });
      }
      authDb.deleteUser(req.params.id);
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

};