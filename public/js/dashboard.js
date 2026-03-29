// ── DASHBOARD ─────────────────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const r = await fetch('/api/dashboard/stats');
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    const d = j.data;

    document.getElementById('dash-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-icon" style="background:#EAF1FF">👥</div>
        <div>
          <div class="stat-label">Total User</div>
          <div class="stat-value">${d.users.total}</div>
          <div class="stat-sub">${d.users.suspended} suspended</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#ECFDF5">✅</div>
        <div>
          <div class="stat-label">User Aktif</div>
          <div class="stat-value">${d.users.active}</div>
          <div class="stat-sub">dari ${d.users.total} total</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#EAF1FF">🏫</div>
        <div>
          <div class="stat-label">Total Kelas</div>
          <div class="stat-value">${d.courses.total}</div>
          <div class="stat-sub">${d.courses.active} aktif</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#FFFBEB">🏢</div>
        <div>
          <div class="stat-label">Org Units</div>
          <div class="stat-value">${d.orgunits.total}</div>
          <div class="stat-sub">unit organisasi</div>
        </div>
      </div>`;

    const maxCount = Math.max(...d.orgunits.distribution.map(o => o.count), 1);
    document.getElementById('dash-oubar').innerHTML = d.orgunits.distribution.length
      ? d.orgunits.distribution.map(ou => `
          <div class="ou-bar">
            <div class="ou-bar-label"><span>${esc(ou.name)}</span><span>${ou.count}</span></div>
            <div class="ou-track"><div class="ou-fill" style="width:${(ou.count / maxCount * 100).toFixed(0)}%"></div></div>
          </div>`).join('')
      : '<div class="ac-msg">Tidak ada data org unit</div>';

    document.getElementById('dash-recent').innerHTML = d.recentUsers.length
      ? d.recentUsers.map(u => `
          <div class="recent-item">
            <div class="avatar">${initials(u.name)}</div>
            <div>
              <div class="recent-name">${esc(u.name)}</div>
              <div class="recent-email">${esc(u.email)}</div>
            </div>
            <div class="recent-date">${fmtDate(u.createdAt)}</div>
          </div>`).join('')
      : '<div class="ac-msg">Belum ada user</div>';

  } catch(e) { toast('Gagal memuat dashboard: ' + e.message, 'error'); }
}