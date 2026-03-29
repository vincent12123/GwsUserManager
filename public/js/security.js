// ── SECURITY: DEVICE AUDIT & LOGIN ACTIVITY ───────────────────────────────────

// ── DEVICE AUDIT ──────────────────────────────────────────────────────────────

async function loadDevices() {
  document.getElementById('devices-tbody').innerHTML =
    `<tr><td colspan="6"><div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--muted);font-size:13px">Memuat perangkat...</span></div></td></tr>`;
  try {
    const r = await fetch('/api/security/devices');
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    renderDevices(j.data);
  } catch(e) { toast('Gagal memuat perangkat: ' + e.message, 'error'); }
}

function renderDevices(devices) {
  if (!devices.length) {
    document.getElementById('devices-tbody').innerHTML =
      `<tr><td colspan="6" class="state-box"><div class="state-emoji">📱</div><div class="state-title">Tidak ada perangkat terdaftar</div></td></tr>`;
    return;
  }

  const syncBadge = {
    synced:   { cls: 'badge-active',    label: 'Synced' },
    stale:    { cls: 'badge-suspended', label: 'Stale' },
    inactive: { cls: 'badge-archived',  label: 'Tidak aktif' },
    unknown:  { cls: 'badge-archived',  label: 'Unknown' },
  };

  document.getElementById('devices-tbody').innerHTML = devices.map(d => {
    const badge   = syncBadge[d.syncStatus] || syncBadge.unknown;
    const isComp  = d.deviceCompromised === 'true';
    const daysAgo = d.daysSince !== null ? `${d.daysSince} hari lalu` : '-';

    return `<tr ${isComp ? 'style="background:rgba(220,38,38,.05)"' : ''}>
      <td>
        <div class="user-name">${esc(d.email)}</div>
        ${isComp ? '<div style="font-size:10px;color:var(--red);font-weight:700">⚠ COMPROMISED</div>' : ''}
      </td>
      <td>
        <div style="font-size:12.5px;font-weight:600">${esc(d.model)}</div>
        <div style="font-size:11px;color:var(--muted)">${esc(d.os)}</div>
      </td>
      <td style="font-size:12px">${esc(d.type)}</td>
      <td style="text-align:center;font-size:12px;font-family:var(--mono)">
        ${d.lastSync ? fmtDate(d.lastSync) : '-'}
        <div style="font-size:10.5px;color:var(--muted)">${daysAgo}</div>
      </td>
      <td style="text-align:center">
        <span class="badge ${badge.cls}"><span class="badge-dot"></span>${badge.label}</span>
      </td>
      <td style="text-align:center">
        <button class="btn btn-danger" style="padding:4px 10px;font-size:11px"
          onclick="openWipeModal('${esc(d.resourceId)}','${esc(d.model)}','${esc(d.email)}')">
          🗑 Wipe
        </button>
      </td>
    </tr>`;
  }).join('');
}

function openWipeModal(resourceId, deviceName, userEmail) {
  document.getElementById('wipe-resource-id').value           = resourceId;
  document.getElementById('wipe-device-name').textContent     = deviceName;
  document.getElementById('wipe-user-email').textContent      = userEmail;
  document.getElementById('wipe-confirm-input').value         = '';
  document.getElementById('wipe-submit-btn').disabled         = true;
  // Reset ke admin_account_wipe
  document.querySelector('input[name="wipe-type"][value="admin_account_wipe"]').checked = true;
  updateWipeUI();
  document.getElementById('modal-wipe').classList.add('open');
}

function updateWipeUI() {
  const type     = document.querySelector('input[name="wipe-type"]:checked')?.value;
  const isFull   = type === 'admin_remote_wipe';
  const warning  = document.getElementById('wipe-warning-box');
  const word     = document.getElementById('wipe-confirm-word');
  const btnLabel = document.getElementById('wipe-btn-label');
  const optFull  = document.getElementById('wipe-opt-full');
  const optAcct  = document.getElementById('wipe-opt-account');

  if (isFull) {
    warning.style.background    = 'rgba(220,38,38,.08)';
    warning.style.borderColor   = 'rgba(220,38,38,.3)';
    warning.style.color         = 'var(--red)';
    warning.innerHTML = '⚠️ <strong>PERINGATAN KERAS:</strong> Full Wipe akan menghapus SEMUA data perangkat termasuk foto, video, kontak, dan aplikasi pribadi siswa. Tindakan ini TIDAK BISA DIBATALKAN. Gunakan hanya untuk perangkat milik sekolah!';
    word.textContent    = 'RESET PABRIK';
    btnLabel.textContent = 'Full Wipe (Reset Pabrik)';
    optFull.style.borderColor = 'var(--red)';
    optAcct.style.borderColor = 'var(--border)';
  } else {
    warning.style.background    = 'var(--accent-lt)';
    warning.style.borderColor   = 'rgba(26,110,250,.2)';
    warning.style.color         = 'var(--accent-dk)';
    warning.innerHTML = 'Akun sekolah akan dihapus dari perangkat. Data pribadi siswa tidak tersentuh.';
    word.textContent    = 'HAPUS';
    btnLabel.textContent = 'Wipe Akun Sekolah';
    optAcct.style.borderColor = 'var(--accent)';
    optFull.style.borderColor = 'var(--border)';
  }

  // Reset konfirmasi input saat ganti tipe
  document.getElementById('wipe-confirm-input').value = '';
  document.getElementById('wipe-submit-btn').disabled = true;
}

function checkWipeConfirm() {
  const type  = document.querySelector('input[name="wipe-type"]:checked')?.value;
  const word  = type === 'admin_remote_wipe' ? 'RESET PABRIK' : 'HAPUS';
  const input = document.getElementById('wipe-confirm-input').value;
  document.getElementById('wipe-submit-btn').disabled = input !== word;
}

async function executeWipe() {
  const resourceId  = document.getElementById('wipe-resource-id').value;
  const deviceName  = document.getElementById('wipe-device-name').textContent;
  const userEmail   = document.getElementById('wipe-user-email').textContent;
  const wipeType    = document.querySelector('input[name="wipe-type"]:checked')?.value;
  const confirmWord = wipeType === 'admin_remote_wipe' ? 'RESET PABRIK' : 'HAPUS AKUN';
  const inputText   = document.getElementById('wipe-confirm-input').value;

  if (inputText !== confirmWord) return toast(`Ketik "${confirmWord}" untuk konfirmasi!`, 'error');

  // Full wipe butuh konfirmasi sekali lagi
  if (wipeType === 'admin_remote_wipe') {
    if (!confirm(`KONFIRMASI TERAKHIR:\n\nFull Wipe akan menghapus SEMUA data di perangkat ${deviceName} milik ${userEmail}.\n\nLanjutkan?`)) return;
  }

  const btn = document.getElementById('wipe-submit-btn');
  btn.disabled = true; btn.innerHTML = '<div class="spinner spin-sm"></div> Mengirim...';

  try {
    const r = await fetch('/api/security/devices/wipe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceId, deviceName, userEmail, wipeType })
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast(j.message, 'success');
    closeModal('modal-wipe');
    loadDevices();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled = false;
  btn.innerHTML = `🗑 <span id="wipe-btn-label">${wipeType === 'admin_remote_wipe' ? 'Full Wipe (Reset Pabrik)' : 'Wipe Akun Sekolah'}</span>`;
}

// ── LOGIN ACTIVITY ─────────────────────────────────────────────────────────────

async function loadLoginActivity() {
  const hours = document.getElementById('activity-hours').value;
  document.getElementById('activity-tbody').innerHTML =
    `<tr><td colspan="5"><div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--muted);font-size:13px">Memuat aktivitas...</span></div></td></tr>`;

  try {
    const r = await fetch(`/api/security/login-activity?hours=${hours}`);
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    renderActivitySummary(j.summary);
    renderActivityTable(j.data);
  } catch(e) { toast('Gagal memuat aktivitas: ' + e.message, 'error'); }
}

async function loadSuspiciousOnly() {
  document.getElementById('activity-tbody').innerHTML =
    `<tr><td colspan="5"><div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--red);font-size:13px">Memuat aktivitas mencurigakan...</span></div></td></tr>`;
  try {
    const r = await fetch('/api/security/login-activity/suspicious');
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    document.getElementById('activity-summary').style.display = 'none';
    renderSuspiciousTable(j.data, j.total);
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

function renderActivitySummary(s) {
  const box = document.getElementById('activity-summary');
  box.style.display = 'flex';
  box.innerHTML = [
    { label: 'Total aktivitas',    val: s.total,         color: 'var(--color-text-primary)' },
    { label: 'Login berhasil',     val: s.loginSuccess,  color: 'var(--color-text-success)' },
    { label: 'Login gagal',        val: s.loginFailed,   color: 'var(--color-text-danger)' },
    { label: 'Mencurigakan',       val: s.suspicious,    color: 'var(--color-text-warning)' },
    { label: 'Luar negeri',        val: s.overseas || 0, color: 'var(--color-text-danger)' },
    { label: 'VPN/Proxy',          val: s.vpn || 0,      color: 'var(--color-text-danger)' },
    { label: 'Luar Kalbar',        val: s.outsideRegion || 0, color: 'var(--color-text-warning)' },
    { label: 'User unik',          val: s.uniqueUsers,   color: 'var(--color-text-info)' },
  ].map(i => `
    <div style="text-align:center;padding:8px 12px;background:var(--color-background-secondary);border:1px solid var(--color-border-tertiary);border-radius:8px;min-width:90px">
      <div style="font-size:18px;font-weight:500;color:${i.color}">${i.val}</div>
      <div style="font-size:11px;color:var(--color-text-secondary)">${i.label}</div>
    </div>`).join('');
}

function geoLocationText(geo) {
  if (!geo || geo.riskLevel === 'unknown') return '<span style="color:var(--color-text-secondary);font-size:11px">-</span>';
  if (geo.riskLevel === 'local') return '<span style="font-size:11px;color:var(--color-text-secondary)">Lokal/Private</span>';

  const flag = geo.countryCode && geo.countryCode !== '-'
    ? String.fromCodePoint(...[...geo.countryCode.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65))
    : '';

  const color = geo.riskLevel === 'safe'           ? 'var(--color-text-success)'
              : geo.riskLevel === 'outside_region' ? 'var(--color-text-warning)'
              : 'var(--color-text-danger)';

  const badge = geo.riskLevel === 'safe'           ? ''
              : geo.riskLevel === 'outside_region' ? ' ⚠'
              : geo.riskLevel === 'vpn'            ? ' 🔒VPN'
              : ' 🔴';

  return `<div style="font-size:11.5px;color:${color};line-height:1.4">
    ${flag} ${geo.city || ''}, ${geo.region || geo.country}${badge}
    <div style="font-size:10px;color:var(--color-text-secondary)">${geo.isp || ''}</div>
  </div>`;
}

function renderActivityTable(activities) {
  if (!activities.length) {
    document.getElementById('activity-tbody').innerHTML =
      `<tr><td colspan="6" class="state-box"><div class="state-title">Tidak ada aktivitas</div></td></tr>`;
    return;
  }

  // Update thead to add Lokasi column
  const thead = document.querySelector('#page-security table:last-of-type thead tr');
  if (thead && thead.children.length < 6) {
    const th = document.createElement('th');
    th.textContent = 'Lokasi';
    th.style.textAlign = 'center';
    thead.insertBefore(th, thead.children[3]);
  }

  const eventBadge = {
    login_success:   { cls: 'badge-active',    label: 'Berhasil' },
    login_failure:   { cls: 'badge-suspended', label: 'Gagal' },
    login_challenge: { cls: 'badge-archived',  label: 'Challenge' },
  };

  const riskRow = { high: 'rgba(220,38,38,.05)', medium: 'rgba(217,119,6,.05)', low: '', safe: '' };

  document.getElementById('activity-tbody').innerHTML = activities.slice(0, 100).map(a => {
    const badge = eventBadge[a.eventName] || { cls: 'badge-archived', label: a.eventName };
    const bg    = riskRow[a.riskLevel] || '';
    return `<tr ${bg ? `style="background:${bg}"` : ''}>
      <td style="font-size:11px;font-family:var(--mono);white-space:nowrap;color:var(--color-text-secondary)">${fmtDateTime(a.time)}</td>
      <td><div class="user-name" style="font-size:12.5px">${esc(a.user)}</div></td>
      <td style="font-family:var(--mono);font-size:11.5px">${esc(a.ipAddress)}</td>
      <td style="text-align:center">${geoLocationText(a.geo)}</td>
      <td style="font-size:12px">${esc(a.loginType || a.eventName)}</td>
      <td style="text-align:center">
        <span class="badge ${badge.cls}"><span class="badge-dot"></span>${badge.label}</span>
        ${a.isSuspicious ? `<div style="font-size:10px;color:var(--color-text-warning);margin-top:2px">${a.suspicionReasons.join(' · ')}</div>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function renderSuspiciousTable(activities, total) {
  if (!activities.length) {
    document.getElementById('activity-tbody').innerHTML =
      `<tr><td colspan="6" class="state-box"><div class="state-emoji">✅</div><div class="state-title">Tidak ada aktivitas mencurigakan dalam 24 jam terakhir</div></td></tr>`;
    return;
  }
  toast(`⚠ ${total} aktivitas mencurigakan ditemukan!`, 'warning');

  const riskColor = { high: 'rgba(220,38,38,.07)', medium: 'rgba(217,119,6,.06)', low: 'rgba(217,119,6,.03)' };
  const riskBadge = { high: 'badge-suspended', medium: 'badge-archived', low: 'badge-archived' };
  const riskLabel = { high: 'Risiko Tinggi', medium: 'Risiko Sedang', low: 'Risiko Rendah' };

  document.getElementById('activity-tbody').innerHTML = activities.map(a => `
    <tr style="background:${riskColor[a.riskLevel] || ''}">
      <td style="font-size:11px;font-family:var(--mono);white-space:nowrap;color:var(--color-text-secondary)">${fmtDateTime(a.time)}</td>
      <td><div class="user-name" style="font-size:12.5px">${esc(a.user)}</div></td>
      <td style="font-family:var(--mono);font-size:11.5px">${esc(a.ipAddress)}</td>
      <td style="text-align:center">${geoLocationText(a.geo)}</td>
      <td style="font-size:12px">${esc(a.events.join(', '))}</td>
      <td style="text-align:center">
        <span class="badge ${riskBadge[a.riskLevel] || 'badge-archived'}">
          <span class="badge-dot"></span>${riskLabel[a.riskLevel] || 'Mencurigakan'}
        </span>
        <div style="font-size:10px;color:var(--color-text-warning);margin-top:2px">${a.reasons.join(' · ')}</div>
      </td>
    </tr>`).join('');
}

// ── SECURITY TAB SWITCHER ─────────────────────────────────────────────────────
function switchSecTab(tab) {
  document.querySelectorAll('.sec-tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('[id^="sec-tab-"]').forEach(el => el.classList.remove('active'));
  document.getElementById(`sec-content-${tab}`).style.display = '';
  document.getElementById(`sec-tab-${tab}`).classList.add('active');
}

// ── DRIVE & STORAGE ───────────────────────────────────────────────────────────
let _storageData = [];

async function loadStorage() {
  const tbody = document.getElementById('storage-tbody');
  tbody.innerHTML = `<tr><td colspan="6"><div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--muted);font-size:13px">Memuat data storage... (mungkin 10-30 detik)</span></div></td></tr>`;
  try {
    const r = await fetch('/api/security/storage');
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    _storageData = j.users || [];

    // Sembunyikan summary dan filter
    document.getElementById('storage-summary').style.display = 'none';

    if (!_storageData.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="state-box">
        <div class="state-emoji">💾</div>
        <div class="state-title">Tidak ada data storage tersedia</div>
        <div class="state-sub">Pastikan scope <code>admin.reports.usage.readonly</code> sudah ditambahkan di DWD</div>
      </td></tr>`;
      return;
    }

    renderStorage();
    document.getElementById('storage-search').oninput = renderStorage;
  } catch(e) { toast('Gagal memuat storage: ' + e.message, 'error'); }
}

function renderStorage() {
  const search = (document.getElementById('storage-search')?.value || '').toLowerCase();
  const tbody  = document.getElementById('storage-tbody');

  let data = _storageData;
  if (search) data = data.filter(u => u.email.toLowerCase().includes(search) || u.name.toLowerCase().includes(search));

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="state-box"><div class="state-emoji">💾</div><div class="state-title">Tidak ada data</div></td></tr>`;
    return;
  }

  const barColor = pct => pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : 'var(--green)';

  tbody.innerHTML = data.map(u => `
    <tr>
      <td>
        <div style="font-weight:600;font-size:13px">${esc(u.name)}</div>
        <div style="font-size:11px;color:var(--muted)">${esc(u.email)}</div>
      </td>
      <td style="text-align:right;font-family:var(--mono);font-size:12px">${u.driveGB} GB</td>
      <td style="text-align:right;font-family:var(--mono);font-size:12px">${u.gmailGB} GB</td>
      <td style="text-align:right;font-family:var(--mono);font-size:12px">${u.photosGB ?? 0} GB</td>
      <td style="text-align:right;font-family:var(--mono);font-size:12px;font-weight:600">${u.totalGB} GB</td>
      <td style="min-width:140px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${u.pct}%;background:${barColor(u.pct)};border-radius:3px"></div>
          </div>
          <span style="font-size:11px;font-weight:600;min-width:32px">${u.pct}%</span>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">dari ${u.quotaGB} GB</div>
      </td>
    </tr>`).join('');
}

// ── RESOURCE USAGE ────────────────────────────────────────────────────────────
async function loadResourceUsage() {
  const setLoading = id => { document.getElementById(id).innerHTML = `<div style="color:var(--muted);font-size:12px;padding:8px">Memuat... (mungkin 15-30 detik)</div>`; };
  ['usage-drive-list','usage-meet-list','usage-email-list'].forEach(setLoading);

  try {
    const r = await fetch('/api/security/resource-usage');
    const j = await r.json();
    if (j.error) throw new Error(j.error);

    const d = j.domain;
    const statsEl = document.getElementById('usage-domain-stats');
    statsEl.style.display = 'flex';
    statsEl.innerHTML = [
      { num: d.activeUsers, lbl: 'User aktif', color: 'var(--blue)' },
      { num: d.driveItems.toLocaleString(), lbl: 'File dibuat', color: 'var(--teal)' },
      { num: d.emailExchanged.toLocaleString(), lbl: 'Email dikirim', color: 'var(--purple)' },
    ].map(c => `
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;text-align:center;min-width:110px">
        <div style="font-size:20px;font-weight:700;color:${c.color}">${c.num}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${c.lbl}</div>
      </div>`).join('') +
      `<div style="margin-left:auto;font-size:11px;color:var(--muted);align-self:center;text-align:right">
        Data per: <strong>${j.date || '-'}</strong><br>
        <span style="font-size:10px">(Reports API delay 3-7 hari)</span>
      </div>`;

    const makeList = (id, items, valFn, suffix) => {
      document.getElementById(id).innerHTML = items.map((u, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
          <div style="width:20px;text-align:right;font-size:11px;color:var(--muted)">${i+1}</div>
          <div style="width:28px;height:28px;border-radius:50%;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0">
            ${esc(u.email.substring(0,2).toUpperCase())}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.name)}</div>
          </div>
          <div style="font-size:12px;font-weight:600;color:var(--accent);flex-shrink:0">${valFn(u)} ${suffix}</div>
        </div>`).join('') || `<div style="color:var(--muted);font-size:12px;padding:8px">Tidak ada data</div>`;
    };

    makeList('usage-drive-list', j.topDrive, u => u.driveAksi + ' aksi', '');
    makeList('usage-email-list', j.topEmail, u => u.emailSent + ' email', '');

  } catch(e) { toast('Gagal memuat resource usage: ' + e.message, 'error'); }
}

// ── SHARING ALERTS ────────────────────────────────────────────────────────────
async function loadSharingAlerts() {
  const tbody = document.getElementById('sharing-tbody');
  tbody.innerHTML = `<tr><td colspan="5"><div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--muted);font-size:13px">Memuat sharing alerts... (mungkin 20-40 detik)</span></div></td></tr>`;

  try {
    const r = await fetch('/api/security/sharing-alerts');
    const j = await r.json();
    if (j.error) throw new Error(j.error);

    const strip = document.getElementById('sharing-alert-strip');
    if (j.total > 0) {
      strip.style.display = 'block';
      strip.innerHTML = `⚠️ Ditemukan <strong>${j.total} user</strong> yang share file ke luar domain (data per: ${j.date || '-'})`;
    } else {
      strip.style.display = 'none';
    }

    if (!j.alerts?.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="state-box"><div class="state-emoji">✅</div><div class="state-title">Tidak ada sharing ke luar domain</div></td></tr>`;
      return;
    }

    tbody.innerHTML = j.alerts.map(a => `
      <tr>
        <td>
          <div style="font-weight:600;font-size:13px">${esc(a.name)}</div>
          <div style="font-size:11px;color:var(--muted)">${esc(a.email)}</div>
        </td>
        <td style="text-align:center;font-size:13px;font-weight:600;color:${a.sharedExt > 0 ? 'var(--red)' : 'var(--muted)'}">${a.sharedExt}</td>
        <td style="text-align:center;font-size:13px;font-weight:600;color:${a.anyoneLink > 0 ? 'var(--amber)' : 'var(--muted)'}">${a.anyoneLink}</td>
        <td style="text-align:center;font-size:13px;font-weight:600;color:${a.publicItems > 0 ? 'var(--red)' : 'var(--muted)'}">${a.publicItems}</td>
        <td style="text-align:center">
          <span class="badge ${a.totalShared > 5 ? 'badge-suspended' : 'badge-archived'}">
            <span class="badge-dot"></span>${a.totalShared} file
          </span>
        </td>
      </tr>`).join('');
  } catch(e) { toast('Gagal memuat sharing alerts: ' + e.message, 'error'); }
}

// ── DRIVE ACTIVITY ────────────────────────────────────────────────────────────
async function loadDriveActivity() {
  const tbody = document.getElementById('driveact-tbody');
  tbody.innerHTML = `<tr><td colspan="5"><div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--muted);font-size:13px">Memuat drive activity...</span></div></td></tr>`;

  const event = document.getElementById('driveact-event')?.value || 'all';
  const date  = document.getElementById('driveact-date')?.value || '';
  let url     = `/api/security/drive-activity?limit=200`;
  if (event !== 'all') url += `&event=${event}`;
  if (date)  url += `&date=${date}`;

  try {
    const r = await fetch(url);
    const j = await r.json();
    if (j.error) throw new Error(j.error);

    if (!j.activities.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="state-box"><div class="state-emoji">📋</div><div class="state-title">Tidak ada aktivitas</div></td></tr>`;
      return;
    }

    const evBadge = ev => {
      const m = { Deleted:'badge-suspended', Shared:'badge-archived', Downloaded:'badge-archived' };
      return m[ev] || 'badge-active';
    };

    tbody.innerHTML = j.activities.map(a => `
      <tr style="background:${a.risk === 'high' ? 'rgba(220,38,38,.04)' : ''}">
        <td style="font-size:11px;font-family:var(--mono);white-space:nowrap;color:var(--muted)">${fmtDateTime(a.time)}</td>
        <td style="font-size:12px">${esc(a.actor)}</td>
        <td>
          <div style="font-size:12px;font-weight:600">${esc(a.docTitle)}</div>
          <div style="font-size:10px;color:var(--muted)">${esc(a.docType)}${a.target ? ' → ' + esc(a.target) : ''}</div>
        </td>
        <td style="text-align:center">
          <span class="badge ${evBadge(a.category)}"><span class="badge-dot"></span>${esc(a.category)}</span>
        </td>
        <td style="text-align:center">
          ${a.risk === 'high'
            ? `<span class="badge badge-suspended"><span class="badge-dot"></span>Tinggi</span>`
            : `<span style="font-size:11px;color:var(--muted)">—</span>`
          }
        </td>
      </tr>`).join('');
  } catch(e) { toast('Gagal memuat drive activity: ' + e.message, 'error'); }
}