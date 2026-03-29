// ═══════════════════════════════════════════════════════════════════════════════
// SSPR — Log & Admin Panel
// ═══════════════════════════════════════════════════════════════════════════════

const SSPR_STATUS = {
  'success':          { label: '✅ Berhasil',       color: 'var(--green)' },
  'failed_notfound':  { label: '❌ Email Tidak Ada', color: 'var(--red)' },
  'failed_suspended': { label: '🚫 Akun Diblokir',  color: 'var(--amber)' },
  'failed_password':  { label: '❌ Password Salah',  color: 'var(--red)' },
  'failed_gws':       { label: '❌ Error Server',    color: 'var(--red)' },
  'blocked':          { label: '🛑 Rate Limited',    color: '#F97316' },
};

async function loadSSPRLog() {
  // Set URL SSPR
  const url = window.location.protocol + '//' + window.location.hostname +
    (window.location.port ? ':' + window.location.port : '') + '/reset';
  const urlEl = document.getElementById('sspr-url');
  if (urlEl) urlEl.textContent = url;

  // Generate QR (pakai API publik - tidak kirim data sensitif)
  generateSSPRQR(url);

  const search = document.getElementById('sspr-search')?.value || '';
  const params = new URLSearchParams({ limit: 100 });
  if (search) params.set('email', search);

  try {
    const r = await fetch('/api/sspr/log?' + params);
    const j = await r.json();

    // Stats
    const s = j.stats || {};
    const statsGrid = document.getElementById('sspr-stats-grid');
    if (statsGrid) {
      statsGrid.innerHTML = [
        { label: 'Reset Hari Ini', value: s.totalToday || 0, color: 'var(--accent)' },
        { label: 'Berhasil Hari Ini', value: s.successToday || 0, color: 'var(--green)' },
        { label: 'Gagal Hari Ini', value: s.failedToday || 0, color: 'var(--red)' },
        { label: 'Total Semua', value: s.totalAll || 0, color: 'var(--muted)' },
      ].map(st => `
        <div class="stat-card">
          <div class="stat-icon" style="background:${st.color}20;color:${st.color}">🔑</div>
          <div>
            <div class="stat-val" style="color:${st.color}">${st.value}</div>
            <div class="stat-label">${st.label}</div>
          </div>
        </div>`).join('');
    }

    // Table
    const tbody = document.getElementById('sspr-tbody');
    if (!tbody) return;
    const logs = j.data || [];
    if (!logs.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="state-box">
        <div class="state-emoji">🔑</div>
        <div class="state-title">Belum ada aktivitas reset</div>
      </td></tr>`;
      return;
    }
    tbody.innerHTML = logs.map(l => {
      const st = SSPR_STATUS[l.status] || { label: l.status, color: 'var(--muted)' };
      return `<tr>
        <td style="font-size:12px;white-space:nowrap">${fmtDateTime(l.logged_at)}</td>
        <td style="font-family:var(--mono);font-size:12px">${esc(l.email || '—')}</td>
        <td><span style="font-size:12px;font-weight:600;color:${st.color}">${st.label}</span></td>
        <td style="font-family:var(--mono);font-size:11px;color:var(--muted)">${esc(l.ip_address || '—')}</td>
      </tr>`;
    }).join('');
  } catch(e) {
    const tbody = document.getElementById('sspr-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="color:var(--red);padding:16px">❌ ${e.message}</td></tr>`;
  }
}

function generateSSPRQR(url) {
  const container = document.getElementById('sspr-qr')?.parentElement;
  if (!container) return;

  // Load qrcode.js dari CDN kalau belum ada
  if (typeof QRCode === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    script.onload = () => renderQR(container, url);
    script.onerror = () => {
      container.innerHTML = '<div style="font-size:10px;color:#888;text-align:center;padding:12px;width:120px">QR tidak tersedia<br>offline</div>';
    };
    document.head.appendChild(script);
  } else {
    renderQR(container, url);
  }
}

function renderQR(container, url) {
  container.innerHTML = '';
  try {
    new QRCode(container, {
      text:          url,
      width:         120,
      height:        120,
      colorDark:     '#000000',
      colorLight:    '#ffffff',
      correctLevel:  QRCode.CorrectLevel.M,
    });
    container.querySelector('img,canvas').style.borderRadius = '6px';
  } catch(e) {
    container.innerHTML = '<div style="font-size:10px;color:#888;text-align:center;padding:12px">QR error</div>';
  }
}

function getSSPRUrl() {
  return window.location.protocol + '//' + window.location.hostname +
    (window.location.port ? ':' + window.location.port : '') + '/reset';
}

function copySSPRLink() {
  const url = getSSPRUrl();
  navigator.clipboard.writeText(url).then(() => toast('Link disalin: ' + url, 'success'));
}

function openSSPRPage() {
  window.open(getSSPRUrl(), '_blank');
}

async function clearSSPRLog() {
  const days = prompt('Hapus log lebih dari berapa hari yang lalu?', '30');
  if (!days) return;
  const r = await fetch(`/api/sspr/log?days=${days}`, { method: 'DELETE' });
  const j = await r.json();
  if (j.success) {
    toast(`${j.deleted} log berhasil dihapus`, 'success');
    loadSSPRLog();
  }
}