// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: AUDIT LOG — GET /api/audit, DELETE /api/audit
// ═══════════════════════════════════════════════════════════════════════════════

const { db } = require('../db/audit');

module.exports = function(app) {

  // GET /api/audit — ambil log dengan filter & pagination
  app.get('/api/audit', (req, res) => {
    try {
      const { action, status, search, limit = 100, offset = 0 } = req.query;
      const where  = [];
      const params = [];

      if (action) { where.push('action = ?');    params.push(action); }
      if (status) { where.push('status = ?');    params.push(status); }
      if (search) { where.push('target LIKE ?'); params.push(`%${search}%`); }

      const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';

      const total = db.prepare(`SELECT COUNT(*) as c FROM audit_log ${whereStr}`).get(...params).c;
      const rows  = db.prepare(`
        SELECT * FROM audit_log ${whereStr}
        ORDER BY id DESC LIMIT ? OFFSET ?
      `).all(...params, parseInt(limit), parseInt(offset));

      res.json({ success: true, total, data: rows });
    } catch(e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/audit — hapus log lama (lebih dari N hari)
  app.delete('/api/audit', (req, res) => {
    try {
      const days   = parseInt(req.query.days || 90);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const result = db.prepare(
        `DELETE FROM audit_log WHERE timestamp < ?`
      ).run(cutoff.toISOString());
      res.json({ success: true, deleted: result.changes });
    } catch(e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

};
