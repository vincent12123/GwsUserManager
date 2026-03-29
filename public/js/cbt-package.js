// ═══════════════════════════════════════════════════════════════════════════════
// CBT PACKAGE — Multi-Ruang Frontend (Koordinator)
// ═══════════════════════════════════════════════════════════════════════════════

let _packages    = [];
let _activePackageId = null;
let _monitorItv  = null;

// ── Tab switching di dalam halaman package ────────────────────────────────────
function pkgTab(tab) {
  document.querySelectorAll('.pkg-tab-btn').forEach(b =>
    b.classList.toggle('act', b.dataset.tab === tab));
  document.querySelectorAll('.pkg-panel').forEach(p =>
    p.style.display = p.dataset.panel === tab ? 'block' : 'none');
  if (tab === 'monitor' && _activePackageId) startMonitor(_activePackageId);
  else stopMonitor();
}

// ── Load semua paket ──────────────────────────────────────────────────────────
async function loadPackages() {
  try {
    const r = await fetch('/api/cbt-package');
    const j = await r.json();
    _packages = j.data || [];
    renderPackageList();
  } catch(e) { toast('Gagal memuat paket ujian', 'error'); }
}

function renderPackageList() {
  const el = document.getElementById('pkg-list');
  if (!_packages.length) {
    el.innerHTML = `<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">
      Belum ada paket ujian. Klik "+ Paket Baru" untuk membuat.
    </div>`;
    return;
  }
  el.innerHTML = _packages.map(pkg => {
    const statusColor = pkg.status === 'active' ? 'var(--green)' : pkg.status === 'ended' ? 'var(--red)' : 'var(--muted)';
    const statusLabel = pkg.status === 'active' ? '🟢 Berjalan' : pkg.status === 'ended' ? '🔴 Selesai' : '⏳ Draft';
    return `
    <div class="pkg-card" style="cursor:default">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1;cursor:pointer" onclick="openPackage('${pkg.id}')">
          <div style="font-weight:700;font-size:14px;margin-bottom:3px">${esc(pkg.name)}</div>
          <div style="font-size:12px;color:var(--muted)">${esc(pkg.mapel)} · ${esc(pkg.kelas||'')} · ${pkg.duration} menit</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <span style="font-size:12px;color:${statusColor};font-weight:600">${statusLabel}</span>
          <button class="btn btn-ghost" style="padding:5px 10px;font-size:12px" onclick="openPackage('${pkg.id}')">Buka →</button>
          <button class="btn btn-ghost" style="padding:5px 10px;font-size:12px;color:var(--red)" onclick="deletePackage('${pkg.id}','${esc(pkg.name)}')">🗑</button>
        </div>
      </div>
      <div style="display:flex;gap:16px;margin-top:10px;font-size:12px;color:var(--muted)">
        <span>🚪 ${pkg.totalRooms} ruang</span>
        <span>👤 ${pkg.totalJoined} siswa join</span>
        <span>📅 ${pkg.created_at?.slice(0,10) || '-'}</span>
      </div>
    </div>`;
  }).join('');
}

// ── Buat paket baru ───────────────────────────────────────────────────────────
let _pkgSessions = [];

async function showCreatePackage() {
  document.getElementById('modal-create-package').classList.add('open');
  document.getElementById('pkg-name').value = '';
  resetPkgAutoFields();

  const sel    = document.getElementById('pkg-soal-source');
  sel.innerHTML = `<option value="">⏳ Memuat sesi CBT...</option>`;
  sel.disabled  = true;

  try {
    const r = await fetch('/api/cbt/sessions');
    const j = await r.json();
    _pkgSessions = j.data || [];

    if (!_pkgSessions.length) {
      sel.innerHTML = `<option value="">Belum ada sesi CBT — buat dulu di CBT Manager</option>`;
      return;
    }

    sel.innerHTML =
      `<option value="">-- Pilih sesi CBT sebagai sumber soal --</option>` +
      _pkgSessions.map(s => {
        const soalInfo = s.soal_count > 0 ? `${s.soal_count} soal` : 'belum ada soal';
        return `<option value="${s.id}">${esc(s.name)} · ${esc(s.mapel)} · ${soalInfo}</option>`;
      }).join('');
    sel.disabled = false;
  } catch(e) {
    sel.innerHTML = `<option value="">❌ Gagal memuat — coba refresh</option>`;
    sel.disabled  = false;
  }
}

function resetPkgAutoFields() {
  const el = document.getElementById('pkg-auto-fields');
  if (el) el.innerHTML = `
    <div style="font-size:11px;color:var(--muted);text-align:center;padding:4px">
      Pilih sesi CBT di atas untuk mengisi detail otomatis
    </div>`;
}

function onPkgSessionChange(sel) {
  const sessionId = sel.value;
  if (!sessionId) { resetPkgAutoFields(); return; }
  const s = _pkgSessions.find(x => x.id === sessionId);
  if (!s) return;

  const soalBadge = s.soal_count > 0
    ? `<span style="color:var(--green);font-weight:700">${s.soal_count} soal siap</span>`
    : `<span style="color:var(--amber)">⚠️ Belum ada soal — import di CBT Manager dulu</span>`;

  const el = document.getElementById('pkg-auto-fields');
  if (el) el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12.5px">
      <div>
        <div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Nama Ujian</div>
        <div style="font-weight:600">${esc(s.name)}</div>
      </div>
      <div>
        <div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Mata Pelajaran</div>
        <div style="font-weight:600">${esc(s.mapel)}</div>
      </div>
      <div>
        <div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Kelas</div>
        <div style="font-weight:600">${esc(s.kelas || '—')}</div>
      </div>
      <div>
        <div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Durasi</div>
        <div style="font-weight:600">${s.duration} menit</div>
      </div>
      <div>
        <div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Soal</div>
        <div>${soalBadge}</div>
      </div>
      <div>
        <div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Status Sesi</div>
        <div style="font-weight:600">${s.status}</div>
      </div>
    </div>`;
}

async function submitCreatePackage() {
  const soalSource = document.getElementById('pkg-soal-source').value;
  if (!soalSource) return toast('Pilih sesi CBT terlebih dahulu', 'error');

  // Semua data diambil dari sesi — tidak perlu input ulang
  const s = _pkgSessions.find(x => x.id === soalSource);
  if (!s) return toast('Sesi tidak ditemukan', 'error');

  const overrideName = document.getElementById('pkg-name').value.trim();
  const name         = overrideName || s.name;

  try {
    const r = await fetch('/api/cbt-package', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mapel:      s.mapel,
        kelas:      s.kelas || '',
        duration:   s.duration,
        soalSource,
      }),
    });
    const j = await r.json();
    if (!j.success) return toast(j.error, 'error');
    closeModal('modal-create-package');
    toast('Paket ujian berhasil dibuat', 'success');
    await loadPackages();
    openPackage(j.data.id);
  } catch(e) { toast('Gagal membuat paket', 'error'); }
}

// ── Buka detail paket ─────────────────────────────────────────────────────────
async function openPackage(id) {
  _activePackageId = id;
  pkgTab('rooms');
  await refreshPackageDetail(id);
  document.getElementById('pkg-detail').style.display = 'block';
  document.getElementById('pkg-list-view').style.display = 'none';
}

function closePackageDetail() {
  stopMonitor();
  _activePackageId = null;
  document.getElementById('pkg-detail').style.display = 'none';
  document.getElementById('pkg-list-view').style.display = 'block';
}

async function refreshPackageDetail(id) {
  const pid = id || _activePackageId;
  if (!pid) return;
  const r = await fetch(`/api/cbt-package/${pid}`);
  const j = await r.json();
  if (!j.success) return;
  const pkg = j.data;

  // Header detail
  document.getElementById('pkg-detail-title').textContent = pkg.name;
  document.getElementById('pkg-detail-sub').textContent = `${pkg.mapel} · ${pkg.kelas||''} · ${pkg.duration} menit`;
  const statusBadge = document.getElementById('pkg-detail-status');
  statusBadge.textContent = pkg.status === 'active' ? '🟢 Berjalan' : pkg.status === 'ended' ? '🔴 Selesai' : '⏳ Draft';

  // Tombol aksi
  document.getElementById('btn-start-all').style.display = pkg.status === 'draft' ? 'inline-flex' : 'none';
  document.getElementById('btn-end-all').style.display   = pkg.status === 'active' ? 'inline-flex' : 'none';

  // Render daftar ruang
  renderRooms(pkg);
}

function renderRooms(pkg) {
  const el = document.getElementById('rooms-list');
  if (!pkg.rooms.length) {
    el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">
      Belum ada ruang. Klik "+ Tambah Ruang".
    </div>`;
    return;
  }
  el.innerHTML = pkg.rooms.map(room => {
    const sc = room.status === 'active' ? 'var(--green)' : room.status === 'ended' ? 'var(--red)' : 'var(--muted)';
    return `
    <div class="room-card" style="border-left:3px solid ${sc}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
        <div style="flex:1">
          <div style="font-weight:700;font-size:13.5px">${esc(room.room_name)}</div>
          <div style="font-size:11.5px;color:var(--muted);margin-top:2px">
            Pengawas: ${esc(room.pengawas_name||'-')} · Max: ${room.max_siswa} siswa
          </div>
          ${room.token ? `<div style="margin-top:6px">
            <span style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--gold);letter-spacing:6px">${room.token}</span>
            <span style="font-size:10px;color:var(--muted);margin-left:6px">token siswa</span>
          </div>` : ''}
          ${room.pengawas_token ? `
          <div style="margin-top:4px;font-size:11px;color:var(--muted)">
            Monitor pengawas: <code style="color:var(--teal)">/monitor-ruang?token=${room.pengawas_token}</code>
            <button onclick="copyPengawasLink('${room.pengawas_token}')" style="margin-left:6px;font-size:10px;background:rgba(45,212,191,.1);border:1px solid rgba(45,212,191,.2);color:var(--teal);border-radius:4px;padding:1px 6px;cursor:pointer">Salin Link</button>
          </div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0">
          <div style="display:flex;gap:10px;font-size:12px">
            <span style="color:var(--blue)">👤 ${room._joined||0}/${room.max_siswa}</span>
            <span style="color:var(--green)">✅ ${room._submitted||0}</span>
            <span style="color:var(--red)">⚠️ ${room._cheats||0}</span>
          </div>
          <div style="display:flex;gap:6px">
            ${room.status === 'draft'  ? `<button class="btn btn-primary" onclick="startRoom('${room.id}')">▶ Mulai</button>` : ''}
            ${room.status === 'active' ? `<button class="btn btn-ghost" onclick="rotateToken('${room.id}')">🔄 Token</button>` : ''}
            ${room.status === 'active' ? `<button class="btn btn-ghost" style="color:var(--red)" onclick="endRoom('${room.id}')">⏹ Akhiri</button>` : ''}
            <button class="btn btn-ghost" style="color:var(--red);font-size:12px" onclick="deleteRoom('${room.id}')">🗑 Hapus</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Room actions ──────────────────────────────────────────────────────────────
async function startRoom(roomId) {
  if (!confirm('Mulai ruang ini sekarang?')) return;
  await fetch(`/api/cbt-package/rooms/${roomId}/start`, { method: 'POST' });
  toast('Ruang dimulai', 'success');
  refreshPackageDetail();
}

async function endRoom(roomId) {
  if (!confirm('Akhiri ruang ini? Siswa tidak bisa masuk lagi.')) return;
  await fetch(`/api/cbt-package/rooms/${roomId}/end`, { method: 'POST' });
  toast('Ruang diakhiri', 'success');
  refreshPackageDetail();
}

async function rotateToken(roomId) {
  await fetch(`/api/cbt-package/rooms/${roomId}/rotate-token`, { method: 'POST' });
  toast('Token diperbarui', 'success');
  refreshPackageDetail();
}

async function deleteRoom(roomId) {
  if (!confirm('Hapus ruang ini? Data siswa di ruang ini juga akan terhapus.')) return;
  await fetch(`/api/cbt-package/rooms/${roomId}`, { method: 'DELETE' });
  toast('Ruang dihapus', 'success');
  refreshPackageDetail();
}

async function deletePackage(id, name) {
  if (!confirm(`Hapus paket "${name}"?\n\nSemua ruang di dalam paket ini akan ikut terhapus.\nData soal dan jawaban siswa TIDAK terhapus (tetap di sesi CBT asal).`)) return;
  try {
    const r = await fetch(`/api/cbt-package/${id}`, { method: 'DELETE' });
    const j = await r.json();
    if (!j.success) return toast(j.error || 'Gagal menghapus paket', 'error');
    toast('Paket berhasil dihapus', 'success');
    loadPackages();
  } catch(e) { toast('Gagal menghapus paket', 'error'); }
}

// ── Tambah ruang ──────────────────────────────────────────────────────────────
function showAddRoom() {
  document.getElementById('modal-add-room').classList.add('open');
}

async function submitAddRoom() {
  const roomName      = document.getElementById('room-name').value.trim();
  const pengawasName  = document.getElementById('room-pengawas-name').value.trim();
  const pengawasEmail = document.getElementById('room-pengawas-email').value.trim();
  const maxSiswa      = document.getElementById('room-max').value;
  const tokenInterval = document.getElementById('room-token-interval').value;
  if (!roomName) return toast('Nama ruang wajib diisi', 'error');
  try {
    const r = await fetch(`/api/cbt-package/${_activePackageId}/rooms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomName, pengawasName, pengawasEmail, maxSiswa, tokenInterval }),
    });
    const j = await r.json();
    if (!j.success) return toast(j.error, 'error');
    closeModal('modal-add-room');
    toast('Ruang berhasil ditambahkan', 'success');
    document.getElementById('room-name').value = '';
    document.getElementById('room-pengawas-name').value = '';
    document.getElementById('room-pengawas-email').value = '';
    refreshPackageDetail();
  } catch(e) { toast('Gagal menambah ruang', 'error'); }
}

// ── Start/End All ─────────────────────────────────────────────────────────────
async function startAllRooms() {
  if (!confirm('Mulai semua ruang sekaligus? Token akan digenerate untuk setiap ruang.')) return;
  const r = await fetch(`/api/cbt-package/${_activePackageId}/start-all`, { method: 'POST' });
  const j = await r.json();
  if (!j.success) return toast(j.error, 'error');
  toast('Semua ruang dimulai!', 'success');
  refreshPackageDetail();
}

async function endAllRooms() {
  if (!confirm('Akhiri semua ruang? Siswa tidak bisa masuk lagi.')) return;
  const r = await fetch(`/api/cbt-package/${_activePackageId}/end-all`, { method: 'POST' });
  const j = await r.json();
  if (!j.success) return toast(j.error, 'error');
  toast('Semua ruang diakhiri', 'success');
  stopMonitor();
  refreshPackageDetail();
}

// ── Monitor koordinator ───────────────────────────────────────────────────────
function startMonitor(id) {
  stopMonitor();
  loadMonitor(id);
  _monitorItv = setInterval(() => loadMonitor(id), 10000);
}

function stopMonitor() {
  if (_monitorItv) { clearInterval(_monitorItv); _monitorItv = null; }
}

async function loadMonitor(id) {
  const pid = id || _activePackageId;
  if (!pid) return;
  try {
    const r = await fetch(`/api/cbt-package/${pid}/monitor`);
    const j = await r.json();
    if (!j.success) return;
    renderMonitor(j.data);
    document.getElementById('monitor-last').textContent =
      'Update: ' + new Date().toLocaleTimeString('id-ID');
  } catch(_) {}
}

function renderMonitor(data) {
  const { pkg, rooms, summary } = data;
  const el = document.getElementById('monitor-content');

  const summaryHtml = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${[
        ['Siswa Join', summary.totalJoined + '/' + summary.totalMax, 'var(--blue)'],
        ['Selesai', summary.totalSubmitted, 'var(--green)'],
        ['Sedang Ujian', summary.totalJoined - summary.totalSubmitted, 'var(--amber)'],
        ['Total Cheat', summary.totalCheats, 'var(--red)'],
      ].map(([lbl, val, color]) => `
        <div class="card" style="padding:14px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:${color};font-family:var(--mono)">${val}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:3px">${lbl}</div>
        </div>`).join('')}
    </div>`;

  const tableHtml = `
    <div class="card" style="overflow:hidden">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead><tr style="background:var(--surface2)">
          <th style="padding:8px 14px;text-align:left;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Ruang</th>
          <th style="padding:8px 14px;text-align:left;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Pengawas</th>
          <th style="padding:8px 14px;text-align:center;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Join</th>
          <th style="padding:8px 14px;text-align:center;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Selesai</th>
          <th style="padding:8px 14px;text-align:center;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Cheat</th>
          <th style="padding:8px 14px;text-align:center;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Status</th>
          <th style="padding:8px 14px;text-align:left;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase">Token Siswa</th>
        </tr></thead>
        <tbody>
          ${rooms.map(room => {
            const sc = room.status === 'active' ? 'var(--green)' : room.status === 'ended' ? 'var(--red)' : 'var(--muted)';
            return `<tr style="border-top:1px solid var(--border)">
              <td style="padding:9px 14px;font-weight:700">${esc(room.room_name)}</td>
              <td style="padding:9px 14px;font-size:12px;color:var(--dim)">${esc(room.pengawas_name||'-')}</td>
              <td style="padding:9px 14px;text-align:center;font-family:var(--mono);font-weight:700;color:var(--blue)">${room._joined||0}/${room.max_siswa}</td>
              <td style="padding:9px 14px;text-align:center;font-family:var(--mono);color:var(--green)">${room._submitted||0}</td>
              <td style="padding:9px 14px;text-align:center;font-family:var(--mono);color:${(room._cheats||0)>0?'var(--red)':'var(--muted)'}">${room._cheats||0}</td>
              <td style="padding:9px 14px;text-align:center"><span style="color:${sc};font-size:11px;font-weight:600">${room.status}</span></td>
              <td style="padding:9px 14px;font-family:var(--mono);font-size:14px;letter-spacing:4px;color:var(--gold)">${room.token||'—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  el.innerHTML = summaryHtml + tableHtml;
}

// ── Export rekap ──────────────────────────────────────────────────────────────
async function exportRekap(toSheets = false) {
  if (!_activePackageId) return;
  const url = `/api/cbt-package/${_activePackageId}/export${toSheets ? '?sheets=1' : ''}`;
  const r   = await fetch(url);
  const j   = await r.json();
  if (!j.success) return toast('Gagal export', 'error');
  if (j.sheetsUrl) {
    window.open(j.sheetsUrl, '_blank');
    toast('Rekap berhasil dibuka di Google Sheets', 'success');
  } else {
    toast(`Rekap: ${j.rekap.length} siswa dari semua ruang`, 'success');
  }
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function copyPengawasLink(ptoken) {
  const url = `${location.origin}/monitor-ruang.html?token=${ptoken}`;
  navigator.clipboard.writeText(url).then(() => toast('Link pengawas disalin!', 'success'));
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Buka halaman nilai essay ──────────────────────────────────────────────────
function openNilaiEssay() {
  if (!_activePackageId) return toast('Buka paket dulu', 'error');
  const pkg = _packages.find(p => p.id === _activePackageId);
  if (!pkg?.soal_source) return toast('Paket belum punya sumber soal', 'error');
  window.open(`/nilai-essay.html?session=${pkg.soal_source}`, '_blank');
}