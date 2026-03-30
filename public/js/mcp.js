/**
 * public/js/mcp.js — MCP Generator (DB-backed)
 * State review disimpan ke DB, tahan browser crash.
 */

// ── State aktif (hanya untuk sesi review yang sedang dibuka) ─────────────────
let _mcp = {
  activePackageId: null,
  soalList:        [],   // [{id, no, tipe, soal, opsi, kunci, bobot, pembahasan, reviewStatus}]
  activeIdx:       null,
};

// ── INIT ──────────────────────────────────────────────────────────────────────
async function initMCP() {
  await checkOllamaStatus();
  await loadCBTSessionsForMCP();
  await loadMCPPackages();
  mcpGoStep('setup');
}

async function checkOllamaStatus() {
  const el = document.getElementById('mcp-ollama-status');
  if (!el) return;
  el.innerHTML = `<span style="color:var(--muted)">⏳ Mengecek Ollama...</span>`;
  try {
    const r = await fetch('/api/mcp/health');
    const j = await r.json();
    el.innerHTML = j.status === 'ok'
      ? `<span style="color:var(--green)">✅ ${j.engine} — ${j.model}</span>`
      : `<span style="color:var(--red)">❌ ${j.message}</span>`;
  } catch {
    el.innerHTML = `<span style="color:var(--red)">❌ Ollama tidak terjangkau (port 11434)</span>`;
  }
}

async function loadCBTSessionsForMCP() {
  try {
    const r = await fetch('/api/cbt/sessions');
    const j = await r.json();
    const semua = j.data || j.sessions || [];
    const aktif = semua.filter(s => s.status !== 'ended');

    // Ada dua select: di review panel dan di done panel
    ['mcp-target-session-review', 'mcp-target-session-done'].forEach(selId => {
      const sel = document.getElementById(selId);
      if (!sel) return;
      sel.innerHTML = '<option value="">-- Pilih Sesi CBT --</option>';
      if (!aktif.length) {
        sel.innerHTML += '<option disabled>Tidak ada sesi aktif — buat sesi dulu di CBT Manager</option>';
        return;
      }
      aktif.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} (${s.mapel} · ${s.kelas})`;
        sel.appendChild(opt);
      });
    });
  } catch(e) { console.error('[MCP] loadCBT error:', e.message); }
}

// ── PACKAGES LIST ─────────────────────────────────────────────────────────────
async function loadMCPPackages() {
  const el = document.getElementById('mcp-packages-list');
  if (!el) return;
  try {
    const r = await fetch('/api/mcp/packages');
    const j = await r.json();
    const list = j.data || [];

    if (!list.length) {
      el.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:20px;text-align:center">Belum ada paket soal tersimpan</div>`;
      return;
    }

    const statusColor = { draft: 'var(--muted)', reviewed: 'var(--amber)', imported: 'var(--green)' };
    const statusLabel = { draft: 'Draft', reviewed: 'Reviewed', imported: 'Diimport ke CBT' };

    el.innerHTML = list.map(p => {
      const approved = p.approved_count || 0;
      const rejected = p.rejected_count || 0;
      const pending  = p.total_soal - approved - rejected;
      return `
        <div class="mcp-pkg-card" onclick="mcpOpenPackage('${p.id}')">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <div style="flex:1">
              <div style="font-weight:700;font-size:13px">${esc(p.name)}</div>
              <div style="font-size:11px;color:var(--muted)">${p.total_pg} PG · ${p.total_essay} Essay · ${p.total_soal} soal</div>
            </div>
            <span style="font-size:10px;font-weight:700;color:${statusColor[p.status] || 'var(--muted)'}">
              ● ${statusLabel[p.status] || p.status}
            </span>
            <button class="btn btn-ghost" style="padding:3px 8px;font-size:11px;color:var(--red)" 
              onclick="event.stopPropagation();mcpDeletePackage('${p.id}')">🗑</button>
          </div>
          <div style="display:flex;gap:8px;font-size:11px">
            <span style="color:var(--green)">✅ ${approved} disetujui</span>
            <span style="color:var(--muted)">⬜ ${pending} pending</span>
            <span style="color:var(--red)">❌ ${rejected} ditolak</span>
          </div>
        </div>`;
    }).join('');
  } catch(e) { toast('Gagal load packages: ' + e.message, 'error'); }
}

async function mcpDeletePackage(id) {
  if (!confirm('Hapus paket soal ini? Semua data soal akan ikut terhapus.')) return;
  try {
    await fetch(`/api/mcp/packages/${id}`, { method: 'DELETE' });
    await loadMCPPackages();
    toast('Paket dihapus', 'success');
  } catch(e) { toast('Gagal hapus: ' + e.message, 'error'); }
}

// ── STEP NAVIGATION ───────────────────────────────────────────────────────────
function mcpGoStep(step) {
  ['setup', 'generate', 'review', 'done'].forEach(s => {
    const el = document.getElementById(`mcp-step-${s}`);
    if (el) el.style.display = s === step ? 'block' : 'none';
  });
  ['setup', 'generate', 'review', 'done'].forEach((s, i) => {
    const dot = document.getElementById(`mcp-dot-${s}`);
    if (!dot) return;
    const cur = ['setup','generate','review','done'].indexOf(step);
    dot.className = 'mcp-step-dot ' + (i < cur ? 'done' : i === cur ? 'active' : 'idle');
  });
}

// ── SETUP ─────────────────────────────────────────────────────────────────────
function mcpSetupCharCount() {
  const el = document.getElementById('mcp-teks-materi');
  const ct = document.getElementById('mcp-char-count');
  if (el && ct) {
    ct.textContent = el.value.length.toLocaleString() + ' karakter';
    document.getElementById('mcp-btn-generate').disabled = el.value.trim().length < 50;
  }
}

async function mcpUploadPDF() {
  const input = document.getElementById('mcp-pdf-input');
  input.click();
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const btn = document.getElementById('mcp-btn-pdf');
    btn.disabled = true; btn.textContent = '⏳ Mengekstrak...';
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/mcp/extract-pdf', { method: 'POST', body: fd });
      const j = await r.json();
      if (!j.success) throw new Error(j.error);
      document.getElementById('mcp-teks-materi').value = j.result.teks_gabung;
      mcpSetupCharCount();
      toast(`PDF diekstrak — ${j.result.total_halaman} hal, ${j.result.total_karakter.toLocaleString()} karakter`, 'success');
    } catch(e) { toast('Gagal ekstrak PDF: ' + e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '📄 Upload PDF'; input.value = ''; }
  };
}

// ── GENERATE (simpan ke DB) ───────────────────────────────────────────────────
async function mcpStartGenerate() {
  const teks  = document.getElementById('mcp-teks-materi')?.value?.trim();
  const mapel = document.getElementById('mcp-mapel')?.value?.trim();
  const kelas = document.getElementById('mcp-kelas')?.value?.trim();
  if (!teks || teks.length < 50) { toast('Teks materi minimal 50 karakter', 'error'); return; }
  if (!mapel) { toast('Mata pelajaran wajib diisi', 'error'); return; }
  if (!kelas) { toast('Kelas wajib diisi', 'error'); return; }

  mcpGoStep('generate');
  const statusEl = document.getElementById('mcp-gen-status');
  statusEl.innerHTML = `<div class="spinner-wrap"><div class="spinner"></div><span>Ollama sedang membuat soal... (30-120 detik)</span></div>`;

  try {
    const r = await fetch('/api/mcp/gen-soal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teks_materi: teks, mapel, kelas,
        num_pg: parseInt(document.getElementById('mcp-num-pg')?.value || 5),
        num_es: parseInt(document.getElementById('mcp-num-es')?.value || 3),
        level:  document.getElementById('mcp-level')?.value || 'sedang',
        nama_sekolah: document.getElementById('mcp-nama-sekolah')?.value || 'SMK Karya Bangsa',
        semester:     document.getElementById('mcp-semester')?.value || 'Ganjil',
        tahun_ajaran: document.getElementById('mcp-tahun')?.value || '2025/2026',
        waktu:        document.getElementById('mcp-waktu')?.value || '90 menit',
        pembuat:      document.getElementById('mcp-pembuat')?.value || 'Guru',
      }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);

    statusEl.innerHTML = `<div style="color:var(--green);text-align:center;padding:20px">
      ✅ ${j.data.soal.length} soal tersimpan ke database!<br>
      <small style="color:var(--muted)">Paket ID: ${j.data.id}</small>
    </div>`;

    // Load ke state review
    await mcpOpenPackage(j.data.id);
    setTimeout(() => mcpGoStep('review'), 600);
  } catch(e) {
    statusEl.innerHTML = `<div style="color:var(--red);padding:20px">❌ ${e.message}</div>
      <div style="text-align:center;margin-top:12px">
        <button class="btn btn-ghost" onclick="mcpGoStep('setup')">← Kembali ke Setup</button>
      </div>`;
  }
}

// ── BUKA PACKAGE DARI DAFTAR ──────────────────────────────────────────────────
async function mcpOpenPackage(id) {
  try {
    const r = await fetch(`/api/mcp/packages/${id}`);
    const j = await r.json();
    if (!j.success) throw new Error(j.error);

    _mcp.activePackageId = id;
    _mcp.soalList = j.data.soal || [];
    _mcp.activeIdx = 0;

    mcpRenderReview(j.data);
    mcpGoStep('review');
  } catch(e) { toast('Gagal buka paket: ' + e.message, 'error'); }
}

// ── REVIEW ────────────────────────────────────────────────────────────────────
function mcpRenderReview(pkg) {
  // Update header info
  const infoEl = document.getElementById('mcp-review-info');
  if (infoEl && pkg) {
    infoEl.textContent = `${pkg.mapel} · ${pkg.kelas} · ${pkg.total_soal} soal`;
  }
  mcpRenderSidebar();
  mcpUpdateProgress();
  if (_mcp.soalList.length) mcpOpenSoal(0);
}

function mcpRenderSidebar() {
  const el = document.getElementById('mcp-sidebar');
  if (!el) return;
  el.innerHTML = _mcp.soalList.map((s, i) => {
    const st  = s.reviewStatus || 'pending';
    const ico = st === 'approved' ? '✅' : st === 'rejected' ? '❌' : '⬜';
    const cls = `mcp-sb-item mcp-sb-${st} ${i === _mcp.activeIdx ? 'mcp-sb-active' : ''}`;
    return `<div class="${cls}" onclick="mcpOpenSoal(${i})">
      <span class="mcp-sb-ico">${ico}</span>
      <span class="mcp-sb-lbl">Soal ${s.no} <small>${s.tipe}</small></span>
    </div>`;
  }).join('');
}

function mcpOpenSoal(idx) {
  _mcp.activeIdx = idx;
  const s  = _mcp.soalList[idx];
  const el = document.getElementById('mcp-editor');
  if (!el || !s) return;

  const isPG = s.tipe === 'PG';
  el.innerHTML = `
    <div class="mcp-editor-header">
      <span class="mcp-soal-badge">Soal ${s.no}</span>
      <span class="mcp-tipe-badge ${isPG ? 'pg' : 'es'}">${isPG ? 'Pilihan Ganda' : 'Essay'}</span>
      <span style="margin-left:auto;font-size:12px;color:var(--muted)">Bobot:
        <input id="ed-bobot" type="number" value="${s.bobot||1}" min="1" max="100"
          style="width:50px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:2px 6px;font-size:12px">
        poin
      </span>
    </div>

    <div style="margin-bottom:12px">
      <label class="field-label">Pertanyaan</label>
      <textarea id="ed-soal" rows="4" style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:10px;font-size:13px;resize:vertical">${esc(s.soal)}</textarea>
    </div>

    ${isPG ? `
    <div style="margin-bottom:12px">
      <label class="field-label">Pilihan Jawaban</label>
      ${['A','B','C','D','E'].map(h => `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="width:22px;height:22px;border-radius:50%;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${h}</span>
          <input id="ed-opsi-${h}" type="text" value="${esc(s.opsi?.[h]||'')}"
            style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:5px;color:var(--text);padding:6px 10px;font-size:12px">
          <label style="font-size:11px;color:var(--muted);white-space:nowrap">
            <input type="radio" name="ed-kunci" value="${h}" ${s.kunci===h?'checked':''}> Kunci
          </label>
        </div>`).join('')}
    </div>` : `
    <div style="margin-bottom:12px">
      <label class="field-label">Kunci Jawaban / Rubrik</label>
      <textarea id="ed-kunci-es" rows="3" style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:10px;font-size:13px;resize:vertical">${esc(s.kunci||'')}</textarea>
    </div>`}

    <div style="margin-bottom:16px">
      <label class="field-label">Pembahasan</label>
      <textarea id="ed-pembahasan" rows="2" style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:10px;font-size:12px;resize:vertical">${esc(s.pembahasan||'')}</textarea>
    </div>

    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
      <button class="btn" style="background:rgba(52,211,153,.15);color:var(--green);border:1px solid var(--green)" onclick="mcpSaveAndSetStatus(${idx},'approved')">✅ Setujui</button>
      <button class="btn" style="background:rgba(248,113,113,.15);color:var(--red);border:1px solid var(--red)" onclick="mcpSaveAndSetStatus(${idx},'rejected')">❌ Tolak</button>
      <button class="btn btn-ghost" onclick="mcpSaveSoal(${idx})">💾 Simpan Edit</button>
      ${idx > 0 ? `<button class="btn btn-ghost" onclick="mcpOpenSoal(${idx-1})">← Prev</button>` : ''}
      ${idx < _mcp.soalList.length-1 ? `<button class="btn btn-ghost" onclick="mcpOpenSoal(${idx+1})">Next →</button>` : ''}
    </div>`;

  mcpRenderSidebar();
}

// Kumpulkan nilai dari form editor
function mcpReadEditor(s) {
  const soal = document.getElementById('ed-soal')?.value || s.soal;
  const bobot = parseInt(document.getElementById('ed-bobot')?.value || s.bobot);
  const pembahasan = document.getElementById('ed-pembahasan')?.value || s.pembahasan || '';
  if (s.tipe === 'PG') {
    const kunciEl = document.querySelector('input[name="ed-kunci"]:checked');
    return {
      soal, bobot, pembahasan,
      opsiA: document.getElementById('ed-opsi-A')?.value || '',
      opsiB: document.getElementById('ed-opsi-B')?.value || '',
      opsiC: document.getElementById('ed-opsi-C')?.value || '',
      opsiD: document.getElementById('ed-opsi-D')?.value || '',
      opsiE: document.getElementById('ed-opsi-E')?.value || '',
      kunci: kunciEl?.value || s.kunci || '',
    };
  }
  return { soal, bobot, pembahasan, kunci: document.getElementById('ed-kunci-es')?.value || s.kunci || '' };
}

// Simpan edit ke DB tanpa ubah status
async function mcpSaveSoal(idx) {
  const s = _mcp.soalList[idx];
  if (!s) return;
  const fields = { ...mcpReadEditor(s), reviewStatus: s.reviewStatus || 'pending' };
  try {
    await fetch(`/api/mcp/soal/${s.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    // Update state lokal
    Object.assign(s, fields, {
      opsi: s.tipe === 'PG'
        ? { A: fields.opsiA, B: fields.opsiB, C: fields.opsiC, D: fields.opsiD, E: fields.opsiE }
        : undefined,
    });
    toast('Soal disimpan', 'success');
  } catch(e) { toast('Gagal simpan: ' + e.message, 'error'); }
}

// Simpan edit DAN ubah review status ke DB
async function mcpSaveAndSetStatus(idx, status) {
  const s = _mcp.soalList[idx];
  if (!s) return;
  const fields = { ...mcpReadEditor(s), reviewStatus: status };
  try {
    await fetch(`/api/mcp/soal/${s.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    // Update state lokal
    s.reviewStatus = status;
    if (s.tipe === 'PG') s.opsi = { A: fields.opsiA, B: fields.opsiB, C: fields.opsiC, D: fields.opsiD, E: fields.opsiE };
    s.soal = fields.soal; s.bobot = fields.bobot; s.pembahasan = fields.pembahasan; s.kunci = fields.kunci;

    mcpRenderSidebar();
    mcpUpdateProgress();
    // Auto-advance
    const next = idx + 1;
    if (next < _mcp.soalList.length) mcpOpenSoal(next);
    else mcpOpenSoal(idx);
  } catch(e) { toast('Gagal simpan: ' + e.message, 'error'); }
}

async function mcpBulkStatus(st) {
  if (!_mcp.activePackageId) return;
  try {
    await fetch(`/api/mcp/packages/${_mcp.activePackageId}/bulk-status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: st }),
    });
    _mcp.soalList.forEach(s => { s.reviewStatus = st; });
    mcpRenderSidebar();
    mcpUpdateProgress();
    if (_mcp.activeIdx !== null) mcpOpenSoal(_mcp.activeIdx);
    toast(`Semua soal di${st === 'approved' ? 'setujui' : 'tolak'}`, 'success');
  } catch(e) { toast('Gagal bulk status: ' + e.message, 'error'); }
}

function mcpUpdateProgress() {
  const total    = _mcp.soalList.length;
  const approved = _mcp.soalList.filter(s => s.reviewStatus === 'approved').length;
  const pct      = total > 0 ? (approved / total * 100) : 0;
  const fill     = document.getElementById('mcp-prog-fill');
  const label    = document.getElementById('mcp-prog-label');
  const btnExp   = document.getElementById('mcp-btn-export');
  const btnImp   = document.getElementById('mcp-btn-import-review');
  if (fill)   fill.style.width   = pct + '%';
  if (label)  label.textContent  = `${approved} / ${total} disetujui`;
  if (btnExp) btnExp.disabled    = approved === 0;
  if (btnImp) btnImp.disabled    = approved === 0;
}

// ── EXPORT (dari review panel) ────────────────────────────────────────────────
async function mcpDoExport() {
  if (!_mcp.activePackageId) return;
  const btn = document.getElementById('mcp-btn-export');
  btn.disabled = true; btn.textContent = '⏳ Membuat file...';
  try {
    const r = await fetch(`/api/mcp/packages/${_mcp.activePackageId}/export-docx`, { method: 'POST' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    mcpShowDone(j.result, j.jumlah);
  } catch(e) {
    toast('Export gagal: ' + e.message, 'error');
    btn.disabled = false; btn.textContent = '↓ Export .docx + Arsip';
  }
}

function mcpShowDone(result, jumlah) {
  mcpGoStep('done');
  document.getElementById('mcp-done-sub').textContent = `${jumlah} soal berhasil diexport — ZIP siap download.`;
  document.getElementById('mcp-done-files').innerHTML = `
    <a class="mcp-file-link" href="${result.zip.download_url}" download="${result.zip.filename}">
      <span>📦</span><div><div style="font-weight:600">${result.zip.filename}</div><div style="font-size:11px;color:var(--muted)">ZIP — soal + kunci + JSON</div></div>
      <span style="margin-left:auto;font-size:20px">↓</span></a>
    <a class="mcp-file-link" href="${result.soal.download_url}" download="${result.soal.filename}">
      <span>📄</span><div><div style="font-weight:600">${result.soal.filename}</div><div style="font-size:11px;color:var(--muted)">Naskah soal siswa</div></div>
      <span style="margin-left:auto;font-size:20px">↓</span></a>
    <a class="mcp-file-link" href="${result.kunci.download_url}" download="${result.kunci.filename}">
      <span>🔑</span><div><div style="font-weight:600">${result.kunci.filename}</div><div style="font-size:11px;color:var(--muted)">Kunci jawaban &amp; rubrik</div></div>
      <span style="margin-left:auto;font-size:20px">↓</span></a>
    <a class="mcp-file-link" href="${result.json.download_url}" download="${result.json.filename}">
      <span>📋</span><div><div style="font-weight:600">${result.json.filename}</div><div style="font-size:11px;color:var(--muted)">Backup JSON</div></div>
      <span style="margin-left:auto;font-size:20px">↓</span></a>`;
  // Auto-download ZIP
  const a = document.createElement('a');
  a.href = result.zip.download_url; a.download = result.zip.filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ── IMPORT KE CBT ─────────────────────────────────────────────────────────────
// Bisa dari panel Review atau panel Done
async function mcpImportToCBT(fromStep) {
  const selId    = fromStep === 'review' ? 'mcp-target-session-review' : 'mcp-target-session-done';
  const sessionId = document.getElementById(selId)?.value;
  if (!sessionId) { toast('Pilih sesi CBT tujuan terlebih dahulu', 'error'); return; }
  if (!_mcp.activePackageId) { toast('Tidak ada paket aktif', 'error'); return; }

  const btnId = fromStep === 'review' ? 'mcp-btn-import-review' : 'mcp-btn-import-done';
  const btn   = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Mengimport...'; }

  try {
    const r = await fetch(`/api/mcp/packages/${_mcp.activePackageId}/import-to-cbt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast(j.message, 'success');
    if (btn) { btn.textContent = '✅ Berhasil!'; btn.style.background = 'rgba(52,211,153,.15)'; btn.style.color = 'var(--green)'; }
    await loadMCPPackages(); // refresh daftar paket
  } catch(e) {
    toast('Import gagal: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Import ke CBT'; }
  }
}

function mcpReset() {
  _mcp = { activePackageId: null, soalList: [], activeIdx: null };
  const ta = document.getElementById('mcp-teks-materi');
  if (ta) ta.value = '';
  mcpSetupCharCount();
  checkOllamaStatus();
  loadCBTSessionsForMCP();
  loadMCPPackages();
  mcpGoStep('setup');
}

// ── Simpan soal MCP ke Bank Soal ──────────────────────────────────────────────
async function mcpSimpanKeBank() {
  // Pakai state yang benar: _mcp.activePackageId dan _mcp.soalList
  if (!_mcp.activePackageId) return toast('Tidak ada soal yang siap disimpan', 'error');

  const allSoal = _mcp.soalList || [];
  if (!allSoal.length) return toast('Tidak ada soal — generate soal terlebih dahulu', 'error');

  // Ambil hanya soal yang disetujui, kalau tidak ada ambil semua
  const approved = allSoal.filter(s => s.reviewStatus === 'approved');
  const soalList = approved.length > 0 ? approved : allSoal;

  // Ambil mapel dari form setup MCP
  const mapelEl = document.getElementById('mcp-mapel') || document.getElementById('mcp-setup-mapel');
  const defaultMapel = mapelEl?.value || '';

  const mapel = prompt('Mata pelajaran:', defaultMapel);
  if (!mapel) return;
  const kelas = prompt('Kelas (X / XI / XII / Semua):', 'XI') || 'Semua';
  const bab   = prompt('Bab / Topik (kosongkan kalau tidak ada):', '') || null;

  try {
    const r = await fetch('/api/bank/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        soalList: soalList.map(s => ({
          tipe:   s.tipe   || 'PG',
          soal:   s.soal,
          opsi_a: s.opsi_a || s.a || (s.opsi?.A) || null,
          opsi_b: s.opsi_b || s.b || (s.opsi?.B) || null,
          opsi_c: s.opsi_c || s.c || (s.opsi?.C) || null,
          opsi_d: s.opsi_d || s.d || (s.opsi?.D) || null,
          opsi_e: s.opsi_e || s.e || (s.opsi?.E) || null,
          kunci:  s.kunci  || s.jawaban || null,
          bobot:  s.bobot  || s.poin || 1,
        })),
        mapel, kelas, bab,
        sumber: 'MCP Generator',
      }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast(`✅ ${j.inserted} soal berhasil disimpan ke Bank Soal`, 'success');
  } catch(e) {
    toast('Gagal simpan ke bank: ' + e.message, 'error');
  }
}