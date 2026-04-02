/**
 * public/js/drive-audit.js
 * ═════════════════════════
 * Drive Audit Center — frontend logic
 */

// ── State ─────────────────────────────────────────────────────────────────────
let _da = {
  userEmail:  '',
  userInfo:   null,
  storage:    null,
  files:      null,
  sharing:    null,
  activity:   null,
  trash:      null,
};

let _daActiveTab = 'target';

// ── Tab switching ─────────────────────────────────────────────────────────────
function daTab(tab) {
  _daActiveTab = tab;
  document.querySelectorAll('.da-tab-btn').forEach(b =>
    b.classList.toggle('act', b.dataset.tab === tab)
  );
  document.querySelectorAll('.da-panel').forEach(p =>
    p.style.display = p.dataset.panel === tab ? 'block' : 'none'
  );
}

// ── PANEL 1: Target & Info ────────────────────────────────────────────────────
async function daLoadUserInfo() {
  const email = document.getElementById('da-email-input')?.value?.trim();
  if (!email) { toast('Email wajib diisi', 'error'); return; }
  if (!email.includes('@')) { toast('Format email tidak valid', 'error'); return; }

  _da.userEmail = email;

  const btn    = document.getElementById('da-btn-info');
  btn.disabled = true; btn.textContent = '⏳ Memuat...';

  const el = document.getElementById('da-user-info-result');
  el.innerHTML = `<div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--muted)">Mengambil info user...</span></div>`;

  try {
    const r = await fetch('/api/drive-audit/user-info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: email }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);

    _da.userInfo = j.user;
    _da.storage  = j.storage;

    const u = j.user;
    const s = j.storage;
    const pctColor = s.usedPct >= 90 ? 'var(--red)' : s.usedPct >= 70 ? 'var(--amber)' : 'var(--green)';

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="card" style="padding:14px">
          <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:10px">👤 Info Akun</div>
          ${u ? `
          <div class="da-info-row"><span>Nama</span><span style="font-weight:600">${esc(u.name?.fullName || '-')}</span></div>
          <div class="da-info-row"><span>Email</span><span>${esc(u.primaryEmail || '-')}</span></div>
          <div class="da-info-row"><span>OU</span><span>${esc(u.orgUnitPath || '-')}</span></div>
          <div class="da-info-row"><span>Last Login</span><span>${u.lastLoginTime ? new Date(u.lastLoginTime).toLocaleString('id-ID') : 'Tidak pernah'}</span></div>
          <div class="da-info-row"><span>Status</span>
            <span class="badge ${u.suspended ? 'badge-suspended' : 'badge-active'}">
              <span class="badge-dot"></span>${u.suspended ? 'Suspended' : 'Aktif'}
            </span></div>
          ` : `<div style="color:var(--muted);font-size:12px">Info user tidak tersedia</div>`}
        </div>
        <div class="card" style="padding:14px">
          <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:10px">💾 Storage</div>
          <div class="da-info-row"><span>Total Pakai</span><span style="font-weight:700;color:${pctColor}">${s.usedGB} GB (${s.usedPct}%)</span></div>
          <div class="da-info-row"><span>Drive</span><span>${s.driveGB} GB</span></div>
          <div class="da-info-row"><span>📸 Google Photos</span>
            <span style="color:${s.photosFlag ? 'var(--red)' : 'var(--text)'}">
              ${s.photosGB} GB ${s.photosFlag ? '🚨 Besar!' : ''}
            </span>
          </div>
          <div class="da-info-row"><span>Gmail</span><span>${s.gmailGB || 0} GB</span></div>
          <div class="da-info-row"><span>Trash</span>
            <span style="color:${s.trashFlag ? 'var(--red)' : 'var(--muted)'}">
              ${s.trashGB} GB ${s.trashFlag ? '⚠️' : ''}
            </span></div>
          <div class="da-info-row"><span>Kuota</span><span>${s.limitGB} GB</span></div>
          <div style="margin-top:10px">
            <div style="background:var(--surface2);border-radius:4px;height:8px;overflow:hidden">
              <div style="height:100%;width:${s.usedPct}%;background:${pctColor};border-radius:4px"></div>
            </div>
          </div>
          ${s.trashFlag ? `<div style="margin-top:8px;font-size:11px;color:var(--red)">⚠️ Trash > 500 MB — mungkin ada file yang disembunyikan</div>` : ''}
          ${s.photosFlag ? `<div style="margin-top:4px;font-size:11px;color:var(--red)">📸 Photos ${s.photosGB} GB — penggunaan tidak wajar, perlu investigasi</div>` : ''}
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="daLoadFiles()">📁 Audit File Inventory</button>
        <button class="btn btn-ghost" onclick="daLoadSharing()">🔗 Cek Sharing</button>
        <button class="btn btn-ghost" onclick="daLoadActivity()">📋 Activity Log</button>
        <button class="btn btn-ghost" onclick="daLoadTrash()">🗑 Cek Trash</button>
      </div>`;
  } catch(e) {
    el.innerHTML = `<div style="color:var(--red);padding:12px">❌ ${e.message}</div>`;
  } finally { btn.disabled = false; btn.textContent = '🔍 Mulai Audit'; }
}

// ── PANEL 2: File Inventory ───────────────────────────────────────────────────
async function daLoadFiles() {
  if (!_da.userEmail) { toast('Mulai dari panel Target dulu', 'error'); return; }
  daTab('files');

  const tbody = document.getElementById('da-files-tbody');
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--muted)">Mengambil semua file... (bisa 30-60 detik)</span></div></td></tr>`;

  try {
    const r = await fetch('/api/drive-audit/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: _da.userEmail }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    _da.files = j;

    // Update summary
    document.getElementById('da-files-summary').innerHTML = `
      <div class="da-stat"><div class="da-stat-num">${j.total.toLocaleString()}</div><div class="da-stat-lbl">Total File</div></div>
      <div class="da-stat"><div class="da-stat-num">${j.totalSizeMB > 1024 ? (j.totalSizeMB/1024).toFixed(1)+' GB' : j.totalSizeMB+' MB'}</div><div class="da-stat-lbl">Total Ukuran</div></div>
      <div class="da-stat" style="border-color:${j.sharedCount > 0 ? 'var(--amber)' : 'var(--border)'}">
        <div class="da-stat-num" style="color:${j.sharedCount > 0 ? 'var(--amber)' : 'var(--text)'}">${j.sharedCount}</div>
        <div class="da-stat-lbl">Dishared</div></div>
      <div class="da-stat" style="border-color:${j.sensitiveCount > 0 ? 'var(--red)' : 'var(--border)'}">
        <div class="da-stat-num" style="color:${j.sensitiveCount > 0 ? 'var(--red)' : 'var(--text)'}">${j.sensitiveCount}</div>
        <div class="da-stat-lbl">Kata Kunci Sensitif</div></div>`;

    daRenderFiles('all');
    document.getElementById('da-files-filter').onchange = e => daRenderFiles(e.target.value);
    document.getElementById('da-files-search').oninput  = e => daRenderFiles(
      document.getElementById('da-files-filter').value, e.target.value
    );
  } catch(e) { tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red);padding:12px">❌ ${e.message}</td></tr>`; }
}

function daRenderFiles(filter = 'all', search = '') {
  const tbody = document.getElementById('da-files-tbody');
  if (!_da.files) return;

  let data = _da.files.files || [];
  if (filter === 'shared')    data = data.filter(f => f.shared);
  if (filter === 'large')     data = data.filter(f => f.sizeMB > 10);
  if (filter === 'sensitive') data = data.filter(f => f.sensitive);
  if (search) data = data.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="state-box"><div class="state-emoji">📁</div><div class="state-title">Tidak ada file</div></td></tr>`;
    return;
  }

  const mimeLabel = m => {
    if (m.includes('spreadsheet') || m.includes('excel')) return '📊';
    if (m.includes('document') || m.includes('word'))     return '📄';
    if (m.includes('presentation') || m.includes('powerpoint')) return '📑';
    if (m.includes('pdf'))    return '📕';
    if (m.includes('image'))  return '🖼';
    if (m.includes('video'))  return '🎬';
    if (m.includes('audio'))  return '🎵';
    if (m.includes('zip') || m.includes('rar')) return '📦';
    return '📎';
  };

  tbody.innerHTML = data.slice(0, 500).map(f => `
    <tr>
      <td><span style="font-size:16px">${mimeLabel(f.mimeType)}</span></td>
      <td>
        <div style="font-weight:600;font-size:12.5px">${esc(f.name)}</div>
        ${f.sensitive ? `<span style="font-size:10px;color:var(--red);font-weight:600">🔑 SENSITIF</span>` : ''}
      </td>
      <td style="font-size:11px;color:var(--muted)">${f.sizeMB > 0 ? f.sizeMB + ' MB' : '—'}</td>
      <td style="font-size:11px;color:var(--muted)">${f.createdTime ? f.createdTime.slice(0,10) : '—'}</td>
      <td style="font-size:11px;color:var(--muted)">${f.modifiedTime ? f.modifiedTime.slice(0,10) : '—'}</td>
      <td style="text-align:center">
        ${f.shared
          ? `<span class="badge badge-archived" style="font-size:10px">🔗 Shared</span>`
          : `<span style="font-size:11px;color:var(--muted)">—</span>`}
      </td>
    </tr>`).join('');
}

// ── PANEL 3: Sharing ─────────────────────────────────────────────────────────
async function daLoadSharing() {
  if (!_da.userEmail) { toast('Mulai dari panel Target dulu', 'error'); return; }
  daTab('sharing');

  const el = document.getElementById('da-sharing-content');
  el.innerHTML = `<div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--muted)">Menganalisis sharing... (mungkin 30-60 detik)</span></div>`;

  try {
    const r = await fetch('/api/drive-audit/sharing', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: _da.userEmail }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    _da.sharing = j;

    const renderGroup = (title, color, icon, items, keyFn) => {
      if (!items.length) return '';
      return `
        <div style="margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:14px">${icon}</span>
            <span style="font-weight:700;font-size:13px;color:${color}">${title}</span>
            <span class="badge" style="background:rgba(0,0,0,.2);color:${color};font-size:10px">${items.length}</span>
          </div>
          <div class="card" style="overflow:hidden">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead><tr style="background:var(--surface2)">
                <th style="padding:7px 12px;text-align:left;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Nama File</th>
                <th style="padding:7px 12px;text-align:left;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">${keyFn === 'email' ? 'Dishare ke' : 'Tipe'}</th>
                <th style="padding:7px 12px;text-align:left;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Role</th>
                <th style="padding:7px 12px;text-align:right;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Ukuran</th>
                <th style="padding:7px 12px;text-align:center;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Aksi</th>
              </tr></thead>
              <tbody>
                ${items.map(s => `<tr style="border-top:1px solid var(--border)">
                  <td style="padding:8px 12px;font-weight:600;max-width:240px">
                    ${s.webViewLink
                      ? `<a href="${s.webViewLink}" target="_blank" rel="noopener"
                           style="color:var(--text);text-decoration:none"
                           title="Buka di Google Drive">
                           ${esc(s.fileName)}
                           <span style="font-size:10px;color:var(--muted);margin-left:4px">↗</span>
                         </a>`
                      : esc(s.fileName)
                    }
                  </td>
                  <td style="padding:8px 12px;color:${color}">${esc(keyFn === 'email' ? s.email : (s.category === 'anyone_link' ? '🌐 Siapa saja dengan link' : s.domain || '—'))}</td>
                  <td style="padding:8px 12px;font-size:11px;color:var(--muted)">${s.role}</td>
                  <td style="padding:8px 12px;text-align:right;font-size:11px;color:var(--muted)">${s.sizeMB > 0 ? s.sizeMB + ' MB' : '—'}</td>
                  <td style="padding:8px 12px;text-align:center">
                    ${s.webViewLink
                      ? `<a href="${s.webViewLink}" target="_blank" rel="noopener"
                           class="btn btn-ghost"
                           style="padding:2px 8px;font-size:11px;text-decoration:none"
                           title="Buka file di Google Drive">🔗 Buka</a>`
                      : '—'
                    }
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    };

    el.innerHTML =
      (!j.criticalCount && !j.warningCount && !j.infoCount
        ? `<div style="color:var(--green);padding:20px;text-align:center">✅ Tidak ditemukan sharing mencurigakan</div>`
        : '') +
      renderGroup('🚨 KRITIS — Dishare ke Email Personal', 'var(--red)', '🚨', j.critical || [], 'email') +
      renderGroup('⚠️ WASPADA — Anyone with Link / Publik', 'var(--amber)', '⚠️', j.warning || [], 'type') +
      renderGroup('🔵 INFO — Dishare ke Domain Lain', 'var(--blue)', '🔵', j.info || [], 'domain');
  } catch(e) { el.innerHTML = `<div style="color:var(--red);padding:12px">❌ ${e.message}</div>`; }
}

// ── PANEL 4: Activity ─────────────────────────────────────────────────────────
async function daLoadActivity() {
  if (!_da.userEmail) { toast('Mulai dari panel Target dulu', 'error'); return; }
  daTab('activity');

  const el = document.getElementById('da-activity-content');
  el.innerHTML = `<div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--muted)">Mengambil activity log... (mungkin 30-60 detik)</span></div>`;

  const startDate = document.getElementById('da-start-date')?.value;
  const endDate   = document.getElementById('da-end-date')?.value;
  const events    = [...document.querySelectorAll('.da-event-cb:checked')].map(c => c.value);

  try {
    const r = await fetch('/api/drive-audit/activity', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: _da.userEmail, startDate, endDate, events }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    _da.activity = j;

    let html = '';

    // Bulk alerts
    if (j.bulkAlerts?.length) {
      html += `<div style="margin-bottom:16px">`;
      j.bulkAlerts.forEach(b => {
        html += `
          <div style="background:rgba(248,113,113,.08);border:1px solid var(--red);border-radius:8px;padding:12px 16px;margin-bottom:8px">
            <div style="font-weight:700;color:var(--red);margin-bottom:4px">
              ⚠️ Bulk Activity — ${b.count} file dalam satu sesi
            </div>
            <div style="font-size:12px;color:var(--muted)">
              ${b.startTime?.slice(0,19).replace('T',' ')} — ${b.endTime?.slice(0,19).replace('T',' ')} · IP: ${b.ip}
            </div>
            <div style="font-size:11px;color:var(--text);margin-top:6px">
              ${(b.files||[]).slice(0,5).map(f => `<span style="background:var(--surface2);padding:2px 6px;border-radius:3px;margin-right:4px">${esc(f)}</span>`).join('')}
              ${b.files?.length > 5 ? `<span style="color:var(--muted)">+${b.files.length-5} lagi</span>` : ''}
            </div>
          </div>`;
      });
      html += `</div>`;
    }

    // Timeline by day
    if (!j.total) {
      html += `<div style="color:var(--muted);padding:20px;text-align:center">Tidak ada activity di periode ini</div>`;
    } else {
      Object.entries(j.byDay || {}).sort((a,b) => b[0].localeCompare(a[0])).forEach(([day, acts]) => {
        const d = new Date(day + 'T00:00:00');
        const label = d.toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
        html += `
          <div style="margin-bottom:16px">
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;
              padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:8px">── ${label} (${acts.length} event)</div>
            ${acts.map(a => `
              <div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">
                <span style="font-family:monospace;color:var(--muted);white-space:nowrap;font-size:11px">${a.time?.slice(11,19) || ''}</span>
                <span style="font-size:14px">${a.icon}</span>
                <span style="font-weight:600;color:var(--text)">${a.event}</span>
                <span style="flex:1;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.docTitle)}</span>
                ${a.target ? `<span style="font-size:10px;color:var(--red);background:rgba(248,113,113,.1);padding:1px 6px;border-radius:3px">→ ${esc(a.target)}</span>` : ''}
                <span style="font-size:10px;color:var(--muted);white-space:nowrap">${a.ip}</span>
              </div>`).join('')}
          </div>`;
      });
    }

    el.innerHTML = `
      <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span style="font-size:13px;color:var(--muted)">Total: <strong style="color:var(--text)">${j.total}</strong> event</span>
        ${j.bulkAlerts?.length ? `<span class="badge badge-suspended">⚠️ ${j.bulkAlerts.length} Bulk Alert</span>` : ''}
      </div>
      ${html}`;
  } catch(e) { el.innerHTML = `<div style="color:var(--red);padding:12px">❌ ${e.message}</div>`; }
}

// ── PANEL 5: Trash ────────────────────────────────────────────────────────────
async function daLoadTrash() {
  if (!_da.userEmail) { toast('Mulai dari panel Target dulu', 'error'); return; }
  daTab('trash');

  const el = document.getElementById('da-trash-content');
  el.innerHTML = `<div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--muted)">Memeriksa trash...</span></div>`;

  try {
    const r = await fetch('/api/drive-audit/trash', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: _da.userEmail }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    _da.trash = j;

    if (!j.total) {
      el.innerHTML = `<div style="color:var(--green);padding:20px;text-align:center">✅ Trash kosong</div>`;
      return;
    }

    el.innerHTML = `
      <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <div class="da-stat"><div class="da-stat-num">${j.total}</div><div class="da-stat-lbl">Total di Trash</div></div>
        <div class="da-stat" style="border-color:${j.flagged > 0 ? 'var(--red)' : 'var(--border)'}">
          <div class="da-stat-num" style="color:${j.flagged > 0 ? 'var(--red)' : 'var(--text)'}">${j.flagged}</div>
          <div class="da-stat-lbl">Pernah Dishare ⚠️</div></div>
        <div class="da-stat"><div class="da-stat-num">${j.totalSizeMB} MB</div><div class="da-stat-lbl">Total Ukuran</div></div>
      </div>
      <div class="card" style="overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:var(--surface2)">
            <th style="padding:7px 12px;text-align:left;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Nama File</th>
            <th style="padding:7px 12px;text-align:right;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Ukuran</th>
            <th style="padding:7px 12px;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Waktu Dihapus</th>
            <th style="padding:7px 12px;text-align:center;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Pernah Dishare</th>
            <th style="padding:7px 12px;text-align:center;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Flag</th>
          </tr></thead>
          <tbody>
            ${(j.files || []).map(f => `
              <tr style="border-top:1px solid var(--border);${f.flag ? 'background:rgba(248,113,113,.05)' : ''}">
                <td style="padding:8px 12px;font-weight:${f.flag ? '700' : '400'}">${esc(f.name)}</td>
                <td style="padding:8px 12px;text-align:right;font-size:11px;color:var(--muted)">${f.sizeMB > 0 ? f.sizeMB + ' MB' : '—'}</td>
                <td style="padding:8px 12px;font-size:11px;color:var(--muted)">${f.trashedTime ? f.trashedTime.slice(0,19).replace('T',' ') : '—'}</td>
                <td style="padding:8px 12px;text-align:center">${f.wasShared ? '<span style="color:var(--amber)">✅ Ya</span>' : '<span style="color:var(--muted)">—</span>'}</td>
                <td style="padding:8px 12px;text-align:center">${f.flag ? '<span style="color:var(--red);font-weight:700">🚨 RED FLAG</span>' : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch(e) { el.innerHTML = `<div style="color:var(--red);padding:12px">❌ ${e.message}</div>`; }
}

// ── PANEL 6: Export ───────────────────────────────────────────────────────────
async function daExportReport() {
  if (!_da.userEmail) { toast('Mulai dari panel Target dulu', 'error'); return; }

  const btn = document.getElementById('da-btn-export');
  btn.disabled = true; btn.textContent = '⏳ Mengambil & menyusun laporan... (1-3 menit)';

  const el = document.getElementById('da-export-result');
  el.innerHTML = `<div class="spinner-wrap"><div class="spinner"></div>
    <span style="color:var(--muted)">Server sedang mengambil semua data dari Google API dan menyusun laporan...</span>
  </div>`;

  // Ambil date range dari panel activity jika ada
  const startDate = document.getElementById('da-start-date')?.value || '';
  const endDate   = document.getElementById('da-end-date')?.value   || '';

  try {
    const r = await fetch('/api/drive-audit/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: _da.userEmail, startDate, endDate }),
    });

    // Cek content-type sebelum parse JSON
    const contentType = r.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await r.text();
      throw new Error('Server error: ' + text.slice(0, 200));
    }

    const j = await r.json();
    if (j.error) throw new Error(j.error);

    const riskColors = { '🔴 TINGGI': 'var(--red)', '🟡 SEDANG': 'var(--amber)', '🟢 RENDAH': 'var(--green)' };
    const riskColor  = riskColors[j.riskLevel] || 'var(--muted)';

    el.innerHTML = `
      <div style="text-align:center;padding:20px">
        <div style="font-size:32px;margin-bottom:8px">📋</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:4px">Laporan Berhasil Dibuat</div>
        <div style="font-size:14px;color:${riskColor};font-weight:700;margin-bottom:8px">
          Tingkat Risiko: ${j.riskLevel}
        </div>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:16px">
          <div class="da-stat" style="min-width:90px"><div class="da-stat-num">${j.summary?.totalFiles||0}</div><div class="da-stat-lbl">Total File</div></div>
          <div class="da-stat" style="min-width:90px"><div class="da-stat-num" style="color:var(--red)">${j.summary?.sharingCritical||0}</div><div class="da-stat-lbl">Sharing Kritis</div></div>
          <div class="da-stat" style="min-width:90px"><div class="da-stat-num" style="color:var(--amber)">${j.summary?.bulkDownloadAlerts||0}</div><div class="da-stat-lbl">Bulk Alert</div></div>
          <div class="da-stat" style="min-width:90px"><div class="da-stat-num" style="color:var(--red)">${j.summary?.trashFlagged||0}</div><div class="da-stat-lbl">Trash Flagged</div></div>
        </div>
      </div>

      <div style="margin-bottom:16px">
        <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px">📌 Rekomendasi</div>
        ${(j.recommendations || []).map(r => `
          <div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12.5px">
            <span style="color:var(--amber)">•</span><span>${esc(r)}</span>
          </div>`).join('')}
      </div>

      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px">📥 Download Laporan</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${j.downloads?.json ? `
          <a href="${j.downloads.json.url}" download="${j.downloads.json.filename}" class="mcp-file-link">
            <span>📋</span><div><div style="font-weight:600">${j.downloads.json.filename}</div>
            <div style="font-size:11px;color:var(--muted)">Data mentah JSON — untuk arsip</div></div>
            <span style="margin-left:auto;font-size:20px">↓</span>
          </a>` : ''}
        ${j.downloads?.xlsx ? `
          <a href="${j.downloads.xlsx.url}" download="${j.downloads.xlsx.filename}" class="mcp-file-link">
            <span>📊</span><div><div style="font-weight:600">${j.downloads.xlsx.filename}</div>
            <div style="font-size:11px;color:var(--muted)">Spreadsheet XLSX — siap cetak &amp; presentasi</div></div>
            <span style="margin-left:auto;font-size:20px">↓</span>
          </a>` : ''}
      </div>`;
  } catch(e) {
    el.innerHTML = `<div style="color:var(--red);padding:12px">❌ ${e.message}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '📋 Buat Laporan Audit';
  }
}


// Update checklist di panel export
function daUpdateExportChecklist() {
  const chk = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = val
      ? `<span style="color:var(--green)">✅ Siap</span>`
      : `<span style="color:var(--muted)">—</span>`;
  };
  chk('da-chk-files',    !!_da.files);
  chk('da-chk-sharing',  !!_da.sharing);
  chk('da-chk-activity', !!_da.activity);
  chk('da-chk-trash',    !!_da.trash);
}