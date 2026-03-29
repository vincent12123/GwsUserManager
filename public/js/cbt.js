// ── CBT MANAGER ───────────────────────────────────────────────────────────────

let allSessions      = [];
let activeCBTSession = null;
let monitorInterval  = null;
let cbtTab           = 'sessions';

// ── TAB NAVIGATION ────────────────────────────────────────────────────────────

function switchCBTTab(tab) {
  cbtTab = tab;
  document.querySelectorAll('.cbt-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.cbt-tab-content').forEach(c => c.style.display = 'none');
  document.getElementById(`cbt-tab-${tab}`).classList.add('active');
  document.getElementById(`cbt-content-${tab}`).style.display = 'block';

  if (tab === 'sessions')  loadCBTSessions();
  if (tab === 'soal')      initCBTSoalTab();
  if (tab === 'monitor'  && activeCBTSession) startMonitor(activeCBTSession.id);
  if (tab === 'cheatlog' && activeCBTSession) loadCheatLog(activeCBTSession.id);
  if (tab === 'results') {
    if (activeCBTSession) {
      loadResults(activeCBTSession.id);
    } else {
      // Tampilkan pilihan sesi
      document.getElementById('cbt-results-area').innerHTML = `
        <div style="padding:20px">
          <label class="field-label" style="margin-bottom:8px;display:block">Pilih Sesi untuk Lihat Hasil</label>
          <select class="field-input" style="max-width:400px" onchange="if(this.value){activeCBTSession={id:this.value,name:this.options[this.selectedIndex].text};loadResults(this.value)}">
            <option value="">-- Pilih sesi --</option>
            ${allSessions.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} — ${esc(s.mapel)} (${s.status})</option>`).join('')}
          </select>
        </div>`;
    }
  }
}

// ── SOAL TAB ──────────────────────────────────────────────────────────────────

let cbtSoalData = null; // parsed JSON dari file

function initCBTSoalTab() {
  const sel = document.getElementById('cbt-soal-session');
  sel.innerHTML = `<option value="">-- Pilih sesi --</option>` +
    allSessions.map(s =>
      `<option value="${esc(s.id)}">${esc(s.name)} — ${esc(s.mapel)} (${s.status})</option>`
    ).join('');
  if (activeCBTSession) {
    sel.value = activeCBTSession.id;
    onCBTSoalSessionChange();
  }
}

async function onCBTSoalSessionChange() {
  const id      = document.getElementById('cbt-soal-session').value;
  const infoEl  = document.getElementById('cbt-soal-session-info');
  const exEl    = document.getElementById('cbt-soal-existing');
  const cntEl   = document.getElementById('cbt-soal-existing-count');

  if (!id) { infoEl.textContent = ''; exEl.style.display = 'none'; return; }

  try {
    const r = await fetch(`/api/cbt/sessions/${id}/soal`);
    const j = await r.json();
    if (j.count > 0) {
      infoEl.textContent = '';
      exEl.style.display = 'block';
      cntEl.textContent  = j.count;
    } else {
      infoEl.textContent = '⚠ Belum ada soal';
      exEl.style.display = 'none';
    }
  } catch(_) {}
  checkImportReady();
}

function onCBTSoalFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const json = JSON.parse(e.target.result);
      if (!json.soal || !Array.isArray(json.soal)) {
        toast('Format JSON tidak valid. Harus ada array "soal"!', 'error');
        return;
      }
      cbtSoalData = json;
      renderCBTSoalPreview(json.soal);
      checkImportReady();
    } catch(_) { toast('File bukan JSON yang valid!', 'error'); }
  };
  reader.readAsText(file);
}

function renderCBTSoalPreview(soal) {
  document.getElementById('cbt-soal-preview').style.display = 'block';
  document.getElementById('cbt-soal-preview-tbody').innerHTML = soal.map(s => `
    <tr>
      <td style="text-align:center;font-weight:600">${s.no}</td>
      <td><span class="badge ${s.tipe==='PG'?'badge-active':'badge-archived'}">
        <span class="badge-dot"></span>${s.tipe||'PG'}</span></td>
      <td style="font-size:12px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.soal)}</td>
      <td style="text-align:center">${s.bobot||1}</td>
      <td style="font-weight:700;color:var(--green)">${s.kunci||'-'}</td>
    </tr>`).join('');
}

function checkImportReady() {
  const sessionId = document.getElementById('cbt-soal-session').value;
  const btn       = document.getElementById('btn-cbt-import-soal');
  btn.disabled    = !(sessionId && cbtSoalData);
}

async function doImportSoalCBT() {
  const sessionId = document.getElementById('cbt-soal-session').value;
  if (!sessionId || !cbtSoalData) return;

  const btn = document.getElementById('btn-cbt-import-soal');
  btn.disabled = true; btn.innerHTML = '<div class="spinner spin-sm"></div> Mengimport...';

  try {
    const r = await fetch(`/api/cbt/sessions/${sessionId}/soal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ soal: cbtSoalData.soal })
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);

    document.getElementById('cbt-soal-result-info').style.display = 'flex';
    document.getElementById('cbt-soal-result-txt').textContent    = `${j.count} soal berhasil diimport ke sesi!`;
    document.getElementById('cbt-soal-existing').style.display    = 'block';
    document.getElementById('cbt-soal-existing-count').textContent = j.count;
    toast(`✅ ${j.count} soal berhasil diimport!`, 'success');
    loadCBTSessions();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled = false; btn.innerHTML = '💾 Import ke Sesi';
}

// ── SESSIONS ──────────────────────────────────────────────────────────────────

async function loadCBTSessions() {
  document.getElementById('cbt-sessions-tbody').innerHTML =
    `<tr><td colspan="7"><div class="spinner-wrap"><div class="spinner"></div></div></td></tr>`;
  try {
    const r = await fetch('/api/cbt/sessions');
    const j = await r.json();
    allSessions = j.data || [];
    renderCBTSessions(allSessions);
  } catch(e) { toast('Gagal memuat sesi: ' + e.message, 'error'); }
}

// Timer map untuk countdown token di tabel
const tokenCountdowns = new Map();

function renderCBTSessions(sessions) {
  // Bersihkan semua countdown timer lama
  tokenCountdowns.forEach(t => clearInterval(t));
  tokenCountdowns.clear();

  if (!sessions.length) {
    document.getElementById('cbt-sessions-tbody').innerHTML =
      `<tr><td colspan="7" class="state-box"><div class="state-emoji">📋</div><div class="state-title">Belum ada sesi ujian</div></td></tr>`;
    return;
  }

  const statusBadge = {
    draft:  { cls: 'badge-archived',  label: 'Draft' },
    active: { cls: 'badge-active',    label: 'Aktif' },
    ended:  { cls: 'badge-suspended', label: 'Selesai' },
  };

  document.getElementById('cbt-sessions-tbody').innerHTML = sessions.map(s => {
    const b          = statusBadge[s.status] || statusBadge.draft;
    const isRotating = s.token_interval > 0;
    const intervalLabel = isRotating ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">rotasi tiap ${s.token_interval} mnt</div>` : '';
    const countdownEl   = isRotating && s.status === 'active'
      ? `<div id="tkcd-${s.id}" style="font-size:10px;font-family:var(--mono);color:var(--amber);margin-top:2px">menghitung...</div>` : '';

    return `<tr>
      <td>
        <div class="user-name">${esc(s.name)}</div>
        <div class="user-email">${esc(s.mapel)} · ${esc(s.kelas)}</div>
      </td>
      <td style="text-align:center">
        <span id="token-display-${s.id}" style="font-family:var(--mono);font-size:20px;font-weight:700;letter-spacing:4px;color:var(--accent)">${esc(s.token)}</span>
        ${intervalLabel}
        ${countdownEl}
        <div style="font-size:9.5px;color:var(--muted);margin-top:3px;letter-spacing:.3px">
          ⚠️ Satu token untuk semua siswa
        </div>
      </td>
      <td style="text-align:center;font-size:13px">${s.duration} mnt</td>
      <td style="text-align:center">
        <span class="badge ${b.cls}"><span class="badge-dot"></span>${b.label}</span>
      </td>
      <td style="font-size:11px;color:var(--muted);font-family:var(--mono)">${fmtDateTime(s.created_at)}</td>
      <td style="text-align:center">
        <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">
          ${s.status === 'draft'  ? `<button class="btn btn-primary" style="padding:4px 10px;font-size:11px" onclick="startCBT('${esc(s.id)}')">▶ Mulai</button>` : ''}
          ${s.status === 'active' ? `<button class="btn" style="padding:4px 10px;font-size:11px;background:var(--red);color:#fff;border-color:var(--red)" onclick="endCBT('${esc(s.id)}')">⏹ Selesai</button>` : ''}
          ${s.status === 'active' ? `<button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" title="Rotate token sekarang" onclick="manualRotate('${esc(s.id)}')">🔄</button>` : ''}
          <button class="btn-icon" title="Monitor" onclick="openMonitor('${esc(s.id)}','${esc(s.name)}')">📊</button>
          <button class="btn-icon" title="Edit" onclick="openEditCBT('${esc(s.id)}')">✏️</button>
          <button class="btn-icon danger" title="Hapus" onclick="deleteCBT('${esc(s.id)}','${esc(s.name)}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Mulai countdown untuk sesi aktif dengan rotating token
  sessions.filter(s => s.status === 'active' && s.token_interval > 0).forEach(s => {
    startTokenCountdown(s.id);
  });
}

// ── TOKEN COUNTDOWN ───────────────────────────────────────────────────────────

async function startTokenCountdown(sessionId) {
  // Ambil status token dari server
  try {
    const r = await fetch(`/api/cbt/sessions/${sessionId}/token-status`);
    const j = await r.json();
    if (!j.success || !j.isRotating) return;

    let secondsLeft = j.secondsLeft ?? (j.interval * 60);

    // Update token display kalau beda
    const tokenEl = document.getElementById(`token-display-${sessionId}`);
    if (tokenEl && tokenEl.textContent !== j.token) {
      tokenEl.textContent = j.token;
      // Flash animasi token berubah
      tokenEl.style.transition = 'color .3s';
      tokenEl.style.color = 'var(--green)';
      setTimeout(() => { if(tokenEl) tokenEl.style.color = 'var(--accent)'; }, 1000);
    }

    const cdEl = document.getElementById(`tkcd-${sessionId}`);

    // Clear timer lama
    if (tokenCountdowns.has(sessionId)) clearInterval(tokenCountdowns.get(sessionId));

    const timer = setInterval(async () => {
      secondsLeft--;
      if (cdEl) {
        const m = Math.floor(secondsLeft / 60);
        const s = secondsLeft % 60;
        if (secondsLeft <= 0) {
          cdEl.textContent = 'Token diperbarui...';
          cdEl.style.color = 'var(--green)';
          clearInterval(timer);
          // Tunggu 2 detik lalu refresh dari server
          setTimeout(() => startTokenCountdown(sessionId), 2000);
        } else {
          cdEl.textContent = `berubah dalam ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
          cdEl.style.color = secondsLeft <= 30 ? 'var(--red)' : secondsLeft <= 60 ? 'var(--amber)' : 'var(--muted)';
        }
      }
    }, 1000);

    tokenCountdowns.set(sessionId, timer);
  } catch(e) { console.warn('Token countdown error:', e.message); }
}

async function manualRotate(sessionId) {
  try {
    const r = await fetch(`/api/cbt/sessions/${sessionId}/regenerate-token`, { method: 'POST' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast(`🔄 Token baru: ${j.token}`, 'success');
    loadCBTSessions();
  } catch(e) { toast('Gagal rotate token: ' + e.message, 'error'); }
}

async function openCreateCBT() {
  document.getElementById('cbt-form-title').textContent = 'Buat Sesi Ujian Baru';
  document.getElementById('cbt-session-id').value       = '';
  ['cbt-name','cbt-mapel','cbt-kelas','cbt-scheduled'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('cbt-duration').value         = '90';
  document.getElementById('cbt-token-interval').value   = '0';
  document.getElementById('cbt-course-select').value    = '';

  // Load kelas kalau belum ada
  if (!allCourses || allCourses.length === 0) await loadCourses();
  populateCBTCourseSelect();
  document.getElementById('modal-cbt-session').classList.add('open');
}

function populateCBTCourseSelect(selectedId = '') {
  const sel = document.getElementById('cbt-course-select');
  sel.innerHTML = `<option value="">-- Tidak terhubung ke kelas --</option>` +
    (allCourses || []).filter(c => c.state === 'ACTIVE').map(c =>
      `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}${c.section && c.section !== '-' ? ' — ' + esc(c.section) : ''}</option>`
    ).join('');
}

async function saveCBTSession() {
  const btn = document.getElementById('cbt-session-save-btn');
  const id  = document.getElementById('cbt-session-id').value;
  const body = {
    name:          document.getElementById('cbt-name').value.trim(),
    mapel:         document.getElementById('cbt-mapel').value.trim(),
    kelas:         document.getElementById('cbt-kelas').value.trim(),
    duration:      parseInt(document.getElementById('cbt-duration').value) || 90,
    courseId:      document.getElementById('cbt-course-select').value || null,
    scheduledAt:   document.getElementById('cbt-scheduled').value || null,
    tokenInterval: parseInt(document.getElementById('cbt-token-interval').value) || 0,
  };
  if (!body.name || !body.mapel || !body.kelas) return toast('Nama, mapel, dan kelas wajib diisi!', 'error');

  btn.disabled = true; btn.innerHTML = '<div class="spinner spin-sm"></div>';
  try {
    const r = await fetch(id ? `/api/cbt/sessions/${id}` : '/api/cbt/sessions', {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast(id ? 'Sesi diperbarui!' : 'Sesi berhasil dibuat!', 'success');
    closeModal('modal-cbt-session');
    loadCBTSessions();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled = false; btn.innerHTML = '💾 Simpan';
}

function openEditCBT(id) {
  const s = allSessions.find(s => s.id === id);
  if (!s) return;
  document.getElementById('cbt-form-title').textContent    = 'Edit Sesi Ujian';
  document.getElementById('cbt-session-id').value          = s.id;
  document.getElementById('cbt-name').value                = s.name;
  document.getElementById('cbt-mapel').value               = s.mapel;
  document.getElementById('cbt-kelas').value               = s.kelas;
  document.getElementById('cbt-duration').value            = s.duration;
  document.getElementById('cbt-scheduled').value           = s.scheduled_at || '';
  document.getElementById('cbt-token-interval').value      = s.token_interval || '0';
  populateCBTCourseSelect(s.course_id || '');
  document.getElementById('modal-cbt-session').classList.add('open');
}

async function startCBT(id) {
  if (!confirm('Mulai sesi ujian? Siswa yang sudah punya token bisa langsung masuk.')) return;
  try {
    const r = await fetch(`/api/cbt/sessions/${id}/start`, { method: 'POST' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast('✅ Sesi ujian dimulai!', 'success');
    loadCBTSessions();
    openMonitor(id, j.data.name);
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

async function endCBT(id) {
  if (!confirm('Akhiri sesi ujian? Siswa tidak bisa mengakses lagi.')) return;
  try {
    const r = await fetch(`/api/cbt/sessions/${id}/end`, { method: 'POST' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast('Sesi ujian diakhiri.', 'success');
    clearInterval(monitorInterval);
    loadCBTSessions();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

async function deleteCBT(id, name) {
  if (!confirm(`Hapus sesi "${name}"?\n\nData peserta, jawaban, dan log juga akan dihapus.`)) return;
  try {
    const r = await fetch(`/api/cbt/sessions/${id}`, { method: 'DELETE' });
    const j = await r.json();

    // Ditolak karena ada essay belum dinilai
    if (j.blocked) {
      const d     = j.detail;
      const names = d.siswaList?.length
        ? '\n\nSiswa yang belum dinilai:\n• ' + d.siswaList.join('\n• ')
        : '';

      const msg = `❌ Tidak dapat menghapus sesi ini.\n\n`
        + `Masih ada ${d.ungradedCount} jawaban essay belum dinilai `
        + `(${d.gradedCount}/${d.totalEssay} sudah selesai).`
        + names
        + `\n\nSelesaikan penilaian essay terlebih dahulu di halaman Nilai Essay,`
        + ` atau klik OK untuk tetap menghapus (nilai essay akan ikut terhapus).`;

      if (!confirm(msg)) return;

      // Force delete
      const r2 = await fetch(`/api/cbt/sessions/${id}?force=true`, { method: 'DELETE' });
      const j2 = await r2.json();
      if (!j2.success) throw new Error(j2.error);
      toast('Sesi dihapus.', 'success');
      loadCBTSessions();
      return;
    }

    if (!j.success) throw new Error(j.error);
    toast('Sesi dihapus.', 'success');
    loadCBTSessions();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

// ── MONITOR ───────────────────────────────────────────────────────────────────

function openMonitor(id, name) {
  activeCBTSession = { id, name };
  switchCBTTab('monitor');
  document.getElementById('cbt-monitor-title').textContent = name;
}

function startMonitor(id) {
  loadMonitorData(id);
  clearInterval(monitorInterval);
  monitorInterval = setInterval(() => loadMonitorData(id), 10000); // refresh tiap 10 detik
}

async function loadMonitorData(id) {
  try {
    const r = await fetch(`/api/cbt/sessions/${id}/participants`);
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    renderMonitor(j.data, j.stats);
  } catch(e) { console.error('Monitor error:', e.message); }
}

function renderMonitor(participants, stats) {
  // Stats cards
  document.getElementById('mon-total').textContent     = stats.total;
  document.getElementById('mon-active').textContent    = stats.active;
  document.getElementById('mon-submitted').textContent = stats.submitted;
  document.getElementById('mon-notjoin').textContent   = stats.notJoined;
  document.getElementById('mon-risky').textContent     = stats.risky;
  document.getElementById('mon-cheats').textContent    = stats.cheats;

  if (!participants.length) {
    document.getElementById('cbt-monitor-tbody').innerHTML =
      `<tr><td colspan="6" class="state-box"><div class="state-title">Belum ada peserta bergabung</div></td></tr>`;
    return;
  }

  const statusBadge = {
    enrolled:  { cls: 'badge-archived',  label: 'Terdaftar' },
    active:    { cls: 'badge-active',    label: 'Sedang ujian' },
    submitted: { cls: 'badge-suspended', label: 'Sudah kumpul' },
  };

  const riskColor = { safe: '', outside_region: 'rgba(217,119,6,.05)', overseas: 'rgba(220,38,38,.05)', vpn: 'rgba(220,38,38,.08)', unknown: '' };

  document.getElementById('cbt-monitor-tbody').innerHTML = participants.map(p => {
    const b   = statusBadge[p.status] || statusBadge.enrolled;
    const bg  = riskColor[p.risk_level] || '';
    const geo = p.geo_city ? `${p.geo_city}, ${p.geo_region}` : (p.geo_country || '-');
    const riskBadge = p.risk_level === 'safe' || !p.risk_level ? ''
      : `<span style="font-size:10px;color:var(--red)"> ⚠ ${p.risk_level.replace('_',' ')}</span>`;
    return `<tr ${bg ? `style="background:${bg}"` : ''}>
      <td><div class="user-name" style="font-size:12.5px">${esc(p.user_name || '-')}</div>
          <div class="user-email">${esc(p.user_email)}</div></td>
      <td style="text-align:center"><span class="badge ${b.cls}"><span class="badge-dot"></span>${b.label}</span></td>
      <td style="font-size:11.5px;font-family:var(--mono)">${esc(p.ip_address || '-')}</td>
      <td style="font-size:11.5px">${esc(geo)}${riskBadge}</td>
      <td style="font-size:11px;color:var(--muted);font-family:var(--mono)">${p.joined_at ? fmtDateTime(p.joined_at) : '-'}</td>
      <td style="font-size:11px;color:var(--muted);font-family:var(--mono)">${p.submitted_at ? fmtDateTime(p.submitted_at) : '-'}</td>
    </tr>`;
  }).join('');
}

// ── CHEAT LOG ─────────────────────────────────────────────────────────────────

async function loadCheatLog(id) {
  document.getElementById('cbt-cheat-tbody').innerHTML =
    `<tr><td colspan="4"><div class="spinner-wrap"><div class="spinner"></div></div></td></tr>`;
  try {
    const r = await fetch(`/api/cbt/sessions/${id}/cheat-log`);
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    document.getElementById('cbt-cheat-count').textContent = j.total;
    document.getElementById('cbt-cheat-tbody').innerHTML = j.data.length
      ? j.data.map(l => `<tr>
          <td style="font-size:11px;font-family:var(--mono);white-space:nowrap;color:var(--muted)">${fmtDateTime(l.logged_at)}</td>
          <td style="font-size:12px">${esc(l.user_email || '-')}</td>
          <td><span class="badge badge-suspended"><span class="badge-dot"></span>${esc(l.event_type)}</span></td>
          <td style="font-size:12px;color:var(--muted)">${esc(l.detail || '-')}</td>
        </tr>`).join('')
      : `<tr><td colspan="4" class="state-box"><div class="state-emoji">✅</div><div class="state-title">Tidak ada kejadian mencurigakan</div></td></tr>`;
  } catch(e) { toast('Gagal memuat log: ' + e.message, 'error'); }
}

// ── RESULTS ───────────────────────────────────────────────────────────────────

async function loadResults(id) {
  const resultArea = document.getElementById('cbt-results-area');
  resultArea.innerHTML = `<div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--muted);font-size:13px">Memuat hasil...</span></div>`;

  try {
    // Ambil rekap nilai dari SQLite
    const [rekR, soalR, partR] = await Promise.all([
      fetch(`/api/cbt/sessions/${id}/rekap`),
      fetch(`/api/cbt/sessions/${id}/soal`),
      fetch(`/api/cbt/sessions/${id}/participants`),
    ]);
    const rekJ  = await rekR.json();
    const soalJ = await soalR.json();
    const partJ = await partR.json();

    if (!rekJ.success) throw new Error(rekJ.error);

    const rekap      = rekJ.data || [];
    const soal       = soalJ.data || [];
    const parts      = partJ.data || [];
    const maxPoints  = rekJ.maxPoints || 100;
    const totalSoal  = soal.length;
    const soalES     = soal.filter(s => s.tipe === 'ES');

    if (!rekap.length && !parts.length) {
      resultArea.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">
        Belum ada siswa yang mengumpulkan jawaban.</div>`;
      return;
    }

    // Gabungkan rekap dengan data peserta
    const rows = parts.map(p => {
      const r = rekap.find(r => r.user_email === p.user_email) || {};
      return { ...p, ...r };
    });

    // Tabel rekap
    const hasEssay = soalES.length > 0;
    resultArea.innerHTML = `
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="font-size:13px;color:var(--muted)">
          ${rows.length} siswa · ${totalSoal} soal · Maks ${maxPoints} poin
          ${hasEssay ? `<span style="color:var(--amber)"> · ${soalES.length} soal essay perlu dinilai manual</span>` : ''}
        </div>
        <div style="margin-left:auto;display:flex;gap:8px">
          ${hasEssay ? `<button class="btn btn-ghost" onclick="openEssayReview('${esc(id)}')" style="font-size:12px;color:var(--amber);border-color:var(--amber)">✏️ Nilai Essay (inline)</button>` : ''}
          ${hasEssay ? `<a href="/nilai-essay.html?session=${esc(id)}" target="_blank" style="text-decoration:none"><button class="btn btn-ghost" style="font-size:12px;color:var(--teal);border-color:rgba(45,212,191,.3)">📝 Halaman Guru</button></a>` : ''}
          <button class="btn btn-ghost" onclick="exportRekapSheets('${esc(id)}')" style="font-size:12px">📊 Export Sheets</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Siswa</th>
            <th style="text-align:center">Status</th>
            <th style="text-align:center">Dijawab</th>
            <th style="text-align:center">PG Benar</th>
            <th style="text-align:center">Total Nilai</th>
            <th style="text-align:center">Persentase</th>
          </tr></thead>
          <tbody>
            ${rows.map(p => {
              const pct     = maxPoints > 0 ? Math.round((p.total_nilai||0) / maxPoints * 100) : 0;
              const pctColor = pct >= 75 ? 'var(--green)' : pct >= 60 ? 'var(--amber)' : 'var(--red)';
              const submitted = p.status === 'submitted';
              return `<tr>
                <td>
                  <div class="user-name" style="font-size:12.5px">${esc(p.user_name||'-')}</div>
                  <div class="user-email">${esc(p.user_email)}</div>
                </td>
                <td style="text-align:center">
                  <span class="badge ${submitted?'badge-active':'badge-archived'}">
                    <span class="badge-dot"></span>${submitted?'Sudah kumpul':'Belum kumpul'}
                  </span>
                </td>
                <td style="text-align:center;font-size:13px">${p.total_dijawab||0} / ${totalSoal}</td>
                <td style="text-align:center;font-size:13px">${p.pg_benar||0}</td>
                <td style="text-align:center;font-size:16px;font-weight:700;color:${pctColor}">${p.total_nilai||0}</td>
                <td style="text-align:center">
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden">
                      <div style="height:100%;width:${pct}%;background:${pctColor};border-radius:4px"></div>
                    </div>
                    <span style="font-size:12px;font-weight:600;color:${pctColor};min-width:36px">${pct}%</span>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } catch(e) {
    resultArea.innerHTML = `<div style="padding:40px;text-align:center;color:var(--red)">
      Gagal memuat hasil: ${esc(e.message)}</div>`;
  }
}

async function exportRekapSheets(sessionId) {
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner spin-sm"></div> Mengexport...'; }

  try {
    const r = await fetch(`/api/cbt/sessions/${sessionId}/export-sheets`, { method: 'POST' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);

    toast(`✅ Export berhasil! ${j.rows} baris data.`, 'success');
    // Buka Sheets di tab baru
    if (j.url) window.open(j.url, '_blank');
  } catch(e) {
    toast('Export gagal: ' + e.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '📊 Export Sheets'; }
}

// ── ESSAY REVIEW MODE A (per soal) ───────────────────────────────────────────

let _essayData = { soal: [], jawaban: [], sessionId: null };

async function openEssayReview(sessionId) {
  const session = allSessions.find(s => s.id === sessionId);
  if (!session) return;

  window._essaySessionId = sessionId;
  document.getElementById('modal-essay-title').textContent =
    `Nilai Essay — ${session.name} (${session.mapel})`;

  await loadEssayData(sessionId);
  document.getElementById('modal-essay-review').classList.add('open');
}

async function loadEssayData(sessionId) {
  const body = document.getElementById('essay-review-body');
  body.innerHTML = `<div class="spinner-wrap"><div class="spinner"></div></div>`;

  try {
    const [jaR, soalR] = await Promise.all([
      fetch(`/api/cbt/sessions/${sessionId}/jawaban-semua`),
      fetch(`/api/cbt/sessions/${sessionId}/soal`),
    ]);
    const jaJ  = await jaR.json();
    const soalJ = await soalR.json();

    const allJawaban = jaJ.data || [];
    const soalEssay  = (soalJ.data || []).filter(s => s.tipe === 'ES');

    if (!soalEssay.length) {
      body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">Tidak ada soal essay di sesi ini.</div>`;
      return;
    }

    // Simpan ke state global
    _essayData = { soal: soalEssay, jawaban: allJawaban, sessionId };

    // Render soal pertama
    renderEssaySoal(0);

  } catch(e) {
    body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--red)">Gagal memuat: ${esc(e.message)}</div>`;
  }
}

function renderEssaySoal(soalIdx) {
  const { soal, jawaban, sessionId } = _essayData;
  const body = document.getElementById('essay-review-body');
  const s    = soal[soalIdx];
  if (!s) return;

  // Jawaban siswa untuk soal ini
  const jawabanSoal = jawaban.filter(j => j.nomor === s.nomor && j.tipe === 'ES');

  // Hitung progress — berapa sudah dinilai (nilai > 0 atau nilai = 0 tapi ada input)
  const totalSudahDinilai = jawabanSoal.filter(j => j.nilai !== null && j.nilai !== undefined && j.nilai >= 0 && j.jawaban).length;

  // Tab soal
  const tabs = soal.map((q, i) => {
    const jawabanQ  = jawaban.filter(j => j.nomor === q.nomor && j.tipe === 'ES' && j.jawaban);
    const dinilaiQ  = jawabanQ.filter(j => j.nilai !== null && j.nilai >= 0).length;
    const selesai   = jawabanQ.length > 0 && dinilaiQ === jawabanQ.length;
    return `<button onclick="renderEssaySoal(${i})"
      style="padding:5px 12px;border-radius:6px;font-size:12px;border:1px solid var(--border);
      cursor:pointer;${i === soalIdx
        ? 'background:var(--accent);color:#fff;border-color:var(--accent)'
        : selesai
          ? 'background:rgba(14,159,110,.1);color:var(--green);border-color:rgba(14,159,110,.3)'
          : 'background:var(--surface);color:var(--text)'
      }">
      Soal ${q.nomor} ${selesai ? '✓' : ''}
    </button>`;
  }).join('');

  // Progress bar
  const total   = jawabanSoal.filter(j => j.jawaban).length;
  const pct     = total > 0 ? Math.round(totalSudahDinilai / total * 100) : 0;

  // Baris per siswa
  const rows = jawabanSoal.length === 0
    ? `<div style="padding:30px;text-align:center;color:var(--muted)">Belum ada siswa yang menjawab soal ini.</div>`
    : jawabanSoal.map((j, idx) => {
        const sudahDinilai = j.nilai !== null && j.nilai >= 0 && j.jawaban;
        const initVal      = j.nilai !== null && j.nilai !== undefined ? j.nilai : '';
        return `
        <div id="essay-row-${s.nomor}-${encodeURIComponent(j.user_email)}"
          style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;
          border-bottom:1px solid var(--border);
          background:${sudahDinilai ? 'rgba(14,159,110,.04)' : ''}">

          <!-- Avatar + nama -->
          <div style="flex-shrink:0;text-align:center;min-width:56px">
            <div style="width:36px;height:36px;border-radius:50%;
              background:var(--surface2);border:1px solid var(--border);
              display:flex;align-items:center;justify-content:center;
              font-size:13px;font-weight:600;margin:0 auto 4px">
              ${esc(j.user_email.substring(0,2).toUpperCase())}
            </div>
            <div style="font-size:10px;color:var(--muted);max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${esc(j.user_email.split('@')[0])}
            </div>
          </div>

          <!-- Jawaban -->
          <div style="flex:1;min-width:0">
            ${j.jawaban
              ? `<div style="font-size:13px;line-height:1.6;background:var(--surface2);border-radius:6px;
                  padding:10px 12px;color:var(--text);word-break:break-word">${esc(j.jawaban)}</div>`
              : `<div style="font-size:13px;color:var(--muted);font-style:italic;padding:10px 0">(tidak menjawab)</div>`
            }
          </div>

          <!-- Input nilai -->
          <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:90px">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Nilai</div>
            <input type="number"
              id="essay-nilai-${s.nomor}-${encodeURIComponent(j.user_email)}"
              class="field-input"
              style="width:68px;text-align:center;padding:6px;font-size:18px;font-weight:700;
                ${sudahDinilai ? 'color:var(--green);border-color:rgba(14,159,110,.4)' : ''}"
              min="0" max="${s.bobot}" step="0.5"
              value="${initVal}"
              oninput="onEssayInput(this, ${s.nomor}, '${esc(j.user_email)}', ${s.bobot})">
            <div style="font-size:11px;color:var(--muted)">dari ${s.bobot}</div>
          </div>

        </div>`;
      }).join('');

  body.innerHTML = `
    <!-- Tab navigasi soal -->
    <div style="padding:10px 16px;border-bottom:1px solid var(--border);background:var(--surface2);
      display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <span style="font-size:11px;color:var(--muted);margin-right:4px">Soal:</span>
      ${tabs}
    </div>

    <!-- Info soal aktif + progress -->
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);background:var(--surface)">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">
        Soal ${s.nomor} — ${esc(s.soal)}
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:8px">
        <span style="font-size:11px;color:var(--muted)">Progress: ${totalSudahDinilai}/${total} dinilai</span>
        <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--green);border-radius:3px;transition:width .3s"></div>
        </div>
        <span style="font-size:12px;font-weight:600;color:${pct===100?'var(--green)':'var(--muted)'}">${pct}%</span>
        <span style="font-size:11px;color:var(--muted)">Maks: ${s.bobot} poin</span>
      </div>
    </div>

    <!-- Daftar siswa -->
    <div style="overflow-y:auto;max-height:480px">
      ${rows}
    </div>

    <!-- Footer: simpan semua + navigasi -->
    <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px;background:var(--surface2)">
      <button class="btn btn-primary" onclick="saveAllEssaySoal(${soalIdx})" style="flex:1">
        💾 Simpan Semua Nilai Soal ${s.nomor}
      </button>
      ${soalIdx > 0
        ? `<button class="btn btn-ghost" onclick="renderEssaySoal(${soalIdx-1})">← Sebelumnya</button>`
        : ''}
      ${soalIdx < soal.length-1
        ? `<button class="btn btn-ghost" onclick="renderEssaySoal(${soalIdx+1})">Soal berikutnya →</button>`
        : ''}
    </div>`;
}

// Update warna input saat diubah
function onEssayInput(input, nomor, email, maxBobot) {
  const v = parseFloat(input.value);
  if (!isNaN(v) && v >= 0 && v <= maxBobot) {
    input.style.color = 'var(--accent)';
    input.style.borderColor = 'rgba(26,110,250,.4)';
  } else {
    input.style.color = 'var(--red)';
    input.style.borderColor = 'rgba(220,38,38,.4)';
  }
}

// Simpan semua nilai untuk satu soal sekaligus
async function saveAllEssaySoal(soalIdx) {
  const { soal, jawaban, sessionId } = _essayData;
  const s          = soal[soalIdx];
  if (!s) return;

  const jawabanSoal = jawaban.filter(j => j.nomor === s.nomor && j.tipe === 'ES' && j.jawaban);
  const btn         = event.target;
  btn.disabled      = true;
  btn.innerHTML     = '<div class="spinner spin-sm"></div> Menyimpan...';

  let saved = 0, errors = 0;
  for (const j of jawabanSoal) {
    const inputId = `essay-nilai-${s.nomor}-${encodeURIComponent(j.user_email)}`;
    const input   = document.getElementById(inputId);
    if (!input) continue;
    const nilai   = parseFloat(input.value);
    if (isNaN(nilai) || nilai < 0 || nilai > s.bobot) continue;

    try {
      const r = await fetch(
        `/api/cbt/sessions/${sessionId}/jawaban/${encodeURIComponent(j.user_email)}/${s.nomor}/nilai`,
        { method: 'PATCH', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ nilai }) }
      );
      const res = await r.json();
      if (res.success) {
        saved++;
        // Update state lokal
        const idx = _essayData.jawaban.findIndex(jj => jj.nomor === s.nomor && jj.user_email === j.user_email);
        if (idx >= 0) _essayData.jawaban[idx].nilai = nilai;
        // Highlight baris hijau
        const row = document.getElementById(`essay-row-${s.nomor}-${encodeURIComponent(j.user_email)}`);
        if (row) {
          row.style.background = 'rgba(14,159,110,.08)';
          input.style.color    = 'var(--green)';
          input.style.borderColor = 'rgba(14,159,110,.4)';
        }
      } else { errors++; }
    } catch(_) { errors++; }
  }

  const msg = `✅ ${saved} nilai disimpan${errors ? ` · ${errors} gagal` : ''}`;
  toast(msg, saved > 0 ? 'success' : 'error');
  btn.disabled = false;
  btn.innerHTML = `💾 Simpan Semua Nilai Soal ${s.nomor}`;

  // Re-render tab progress
  renderEssaySoal(soalIdx);

  // Refresh hasil di tab utama
  if (cbtTab === 'results' && activeCBTSession?.id === sessionId) loadResults(sessionId);
}

// Simpan semua soal sekaligus (dari header modal)
async function saveAllEssay() {
  const { soal, sessionId } = _essayData;
  if (!soal.length) return;
  for (let i = 0; i < soal.length; i++) {
    await saveAllEssaySoal(i);
  }
}

// ── DEPLOY SOAL (reuse dari forms.js) ─────────────────────────────────────────

async function deploySoalToCBT() {
  const sessionId = document.getElementById('cbt-deploy-session').value;
  if (!sessionId) return toast('Pilih sesi ujian dulu!', 'error');
  const session = allSessions.find(s => s.id === sessionId);
  if (!session) return;

  // Set current session as active for forms.js
  if (!session.course_id) return toast('Sesi belum dihubungkan ke kelas Classroom!', 'error');

  // Buka modal import soal
  openImportSoal();
  // Override courseId di modal
  setTimeout(() => {
    const sel = document.getElementById('soal-course-id');
    if (sel) sel.value = session.course_id;
  }, 300);
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRASI BANK SOAL di CBT Manager
// ═══════════════════════════════════════════════════════════════════════════════

let _cbtBankSoal = [];
let _cbtBankSelected = new Set();

function switchCBTImportTab(tab) {
  document.getElementById('cbt-import-panel-json').style.display  = tab === 'json'  ? 'block' : 'none';
  document.getElementById('cbt-import-panel-bank').style.display  = tab === 'bank'  ? 'block' : 'none';

  const btnJson = document.getElementById('cbt-import-tab-json');
  const btnBank = document.getElementById('cbt-import-tab-bank');
  if (btnJson) {
    btnJson.style.borderBottomColor = tab === 'json' ? 'var(--blue)' : 'transparent';
    btnJson.style.color = tab === 'json' ? 'var(--blue)' : '';
  }
  if (btnBank) {
    btnBank.style.borderBottomColor = tab === 'bank' ? 'var(--blue)' : 'transparent';
    btnBank.style.color = tab === 'bank' ? 'var(--blue)' : '';
  }

  if (tab === 'bank') {
    loadCBTBankMapel();
    loadCBTBankSoal(true);
  }
}

async function loadCBTBankMapel() {
  try {
    const r = await fetch('/api/bank/mapel');
    const j = await r.json();
    const sel = document.getElementById('cbt-bank-mapel');
    if (!sel) return;
    sel.innerHTML = `<option value="">Semua Mapel</option>` +
      (j.data || []).map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  } catch(_) {}
}

async function loadCBTBankSoal(reset = false) {
  if (reset) _cbtBankSelected.clear();
  const tbody   = document.getElementById('cbt-bank-tbody');
  const mapel   = document.getElementById('cbt-bank-mapel')?.value   || '';
  const kelas   = document.getElementById('cbt-bank-kelas')?.value   || '';
  const tipe    = document.getElementById('cbt-bank-tipe')?.value    || '';
  const search  = document.getElementById('cbt-bank-search')?.value  || '';

  const params  = new URLSearchParams({ limit: 200 });
  if (mapel)  params.set('mapel',  mapel);
  if (kelas)  params.set('kelas',  kelas);
  if (tipe)   params.set('tipe',   tipe);
  if (search) params.set('search', search);

  try {
    const r = await fetch('/api/bank?' + params);
    const j = await r.json();
    _cbtBankSoal = j.data || [];
    document.getElementById('cbt-bank-count').textContent = `${j.total || 0} soal`;
    renderCBTBankList();
    updateCBTBankSelectedCount();
  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red);padding:12px">❌ ${e.message}</td></tr>`;
  }
}

function renderCBTBankList() {
  const tbody = document.getElementById('cbt-bank-tbody');
  if (!tbody) return;
  if (!_cbtBankSoal.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="state-box">
      <div class="state-emoji">📭</div><div class="state-title">Tidak ada soal ditemukan</div>
    </td></tr>`;
    return;
  }
  tbody.innerHTML = _cbtBankSoal.map(s => {
    const checked  = _cbtBankSelected.has(s.id) ? 'checked' : '';
    const preview  = s.soal.length > 70 ? s.soal.slice(0, 70) + '…' : s.soal;
    return `<tr style="${checked ? 'background:rgba(96,165,250,.06)' : ''}">
      <td><input type="checkbox" ${checked} onchange="toggleCBTBankRow(this,'${s.id}')"></td>
      <td style="font-size:12px">${esc(preview)}</td>
      <td style="font-size:11px;color:var(--muted)">${esc(s.mapel)}</td>
      <td style="text-align:center;font-size:11px">${s.tipe==='PG'?'<span style="color:var(--blue)">PG</span>':'<span style="color:var(--amber)">Essay</span>'}</td>
      <td style="text-align:center;font-size:11px;color:var(--muted)">${esc(s.tingkat)}</td>
      <td style="text-align:center;font-size:11px">${s.bobot}</td>
    </tr>`;
  }).join('');
}

function toggleCBTBankRow(cb, id) {
  if (cb.checked) _cbtBankSelected.add(id);
  else _cbtBankSelected.delete(id);
  updateCBTBankSelectedCount();
  // Update row background
  const tr = cb.closest('tr');
  if (tr) tr.style.background = cb.checked ? 'rgba(96,165,250,.06)' : '';
}

function toggleAllCBTBank(cb) {
  _cbtBankSoal.forEach(s => {
    if (cb.checked) _cbtBankSelected.add(s.id);
    else _cbtBankSelected.delete(s.id);
  });
  renderCBTBankList();
  updateCBTBankSelectedCount();
}

function selectAllCBTBank() {
  _cbtBankSoal.forEach(s => _cbtBankSelected.add(s.id));
  renderCBTBankList();
  updateCBTBankSelectedCount();
}

function selectRandomCBTBank() {
  const n = parseInt(prompt('Pilih berapa soal secara acak?', '30') || '0');
  if (!n || n <= 0) return;
  _cbtBankSelected.clear();
  const shuffled = [..._cbtBankSoal].sort(() => Math.random() - 0.5);
  shuffled.slice(0, n).forEach(s => _cbtBankSelected.add(s.id));
  renderCBTBankList();
  updateCBTBankSelectedCount();
}

function updateCBTBankSelectedCount() {
  const n   = _cbtBankSelected.size;
  const el  = document.getElementById('cbt-bank-selected-count');
  const btn = document.getElementById('btn-cbt-from-bank');
  if (el)  el.textContent = n > 0 ? `${n} soal dipilih` : '0 dipilih';
  if (btn) btn.disabled = n === 0;
}

async function importDariBankToCBT() {
  const sessionId = document.getElementById('cbt-soal-session')?.value;
  if (!sessionId) return toast('Pilih sesi CBT terlebih dahulu', 'error');
  if (_cbtBankSelected.size === 0) return toast('Pilih minimal 1 soal', 'error');

  const btn = document.getElementById('btn-cbt-from-bank');
  btn.disabled = true; btn.textContent = '⏳ Menambahkan...';

  try {
    const r = await fetch(`/api/bank/to-session/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ soalIds: [..._cbtBankSelected] }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);

    const el = document.getElementById('cbt-bank-result');
    if (el) {
      el.textContent = `✅ ${j.inserted} soal berhasil ditambahkan — total ${j.total} soal di sesi ini`;
      el.style.display = 'block';
    }
    _cbtBankSelected.clear();
    renderCBTBankList();
    updateCBTBankSelectedCount();
    toast(`${j.inserted} soal dari bank berhasil ditambahkan ke sesi`, 'success');
    onCBTSoalSessionChange(); // refresh info soal existing
  } catch(e) {
    toast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '➕ Tambahkan ke Sesi';
  }
}