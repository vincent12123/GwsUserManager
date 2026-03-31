// ═══════════════════════════════════════════════════════════════════════════════
// BANK SOAL — Frontend
// ═══════════════════════════════════════════════════════════════════════════════

let _bankSoal   = [];
let _bankTotal  = 0;
let _bankFilter = { mapel:'', kelas:'', bab:'', tingkat:'', tipe:'', search:'' };
let _bankOffset = 0;
const _bankLimit = 50;
let _editSoalId = null;
let _bankMapel  = [];
let _bankBab    = [];

// ── Load utama ────────────────────────────────────────────────────────────────
async function loadBankSoal() {
  await Promise.all([loadBankMapelList(), loadBankStats()]);
  await loadBankList();
}

async function loadBankMapelList() {
  try {
    const r = await fetch('/api/bank/mapel');
    const j = await r.json();
    _bankMapel = j.data || [];
    renderBankFilterDropdowns();
  } catch(_) {}
}

async function loadBankBabList() {
  try {
    const mapel = _bankFilter.mapel;
    const r     = await fetch('/api/bank/bab' + (mapel ? `?mapel=${encodeURIComponent(mapel)}` : ''));
    const j     = await r.json();
    _bankBab = j.data || [];
    const sel  = document.getElementById('bank-filter-bab');
    if (!sel) return;
    sel.innerHTML = `<option value="">Semua Bab</option>` +
      _bankBab.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
  } catch(_) {}
}

function renderBankFilterDropdowns() {
  const selMapel = document.getElementById('bank-filter-mapel');
  if (selMapel) {
    selMapel.innerHTML = `<option value="">Semua Mapel</option>` +
      _bankMapel.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  }
}

async function loadBankList(reset = false) {
  if (reset) _bankOffset = 0;
  const tbody = document.getElementById('bank-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner-wrap"><div class="spinner"></div></div></td></tr>`;

  const params = new URLSearchParams({
    limit:  _bankLimit,
    offset: _bankOffset,
    ...Object.fromEntries(Object.entries(_bankFilter).filter(([,v]) => v)),
  });

  try {
    const r = await fetch('/api/bank?' + params);
    const j = await r.json();
    _bankSoal  = j.data || [];
    _bankTotal = j.total || 0;
    renderBankList();
    renderBankPagination();
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red);padding:16px">❌ ${e.message}</td></tr>`;
  }
}

function renderBankList() {
  const tbody = document.getElementById('bank-tbody');
  document.getElementById('bank-count').textContent = `${_bankTotal} soal`;

  if (!_bankSoal.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="state-box">
      <div class="state-emoji">📚</div>
      <div class="state-title">Bank soal kosong</div>
      <div class="state-sub">Tambah soal manual atau import dari MCP Generator</div>
    </td></tr>`;
    return;
  }

  // Clear dulu
  tbody.innerHTML = _bankSoal.map(s => {
    const tingkatColor = { C1:'#60a5fa', C2:'#34d399', C3:'#a78bfa', C4:'#f0b429', C5:'#f87171', C6:'#f87171' };
    const preview = s.soal.length > 80 ? s.soal.slice(0, 80) + '…' : s.soal;
    const tags    = s.tags_str ? s.tags_str.split(', ').map(t =>
      `<span style="font-size:9px;padding:1px 5px;background:rgba(96,165,250,.1);color:var(--blue);border-radius:3px">${esc(t)}</span>`
    ).join(' ') : '';

    return `<tr>
      <td style="max-width:320px">
        <div style="font-size:12.5px;font-weight:500;margin-bottom:3px">
          ${s.teks_bacaan ? '<span style="font-size:10px;background:rgba(45,212,191,.15);color:var(--teal);border-radius:3px;padding:1px 5px;margin-right:5px">📖 Teks Bacaan</span>' : ''}${esc(preview)}
        </div>
        ${s.teks_bacaan ? `<div style="font-size:11px;color:var(--teal);margin-bottom:2px;font-style:italic">${esc(s.teks_bacaan.slice(0,60))}…</div>` : ''}
        ${s.tipe === 'PG' ? `<div style="font-size:11px;color:var(--muted)">
          A.${esc(s.opsi_a||'')} &nbsp; B.${esc(s.opsi_b||'')} &nbsp;
          C.${esc(s.opsi_c||'')} &nbsp; D.${esc(s.opsi_d||'')}${s.opsi_e?' &nbsp; E.'+esc(s.opsi_e):''}
          <span style="color:var(--green);font-weight:600;margin-left:6px">✓${esc(s.kunci||'')}</span>
        </div>` : `<div style="font-size:11px;color:var(--muted)">Essay — ${s.bobot} poin</div>`}
        ${tags ? `<div style="margin-top:3px">${tags}</div>` : ''}
      </td>
      <td style="font-size:12px">${esc(s.mapel)}</td>
      <td style="font-size:12px">${esc(s.kelas||'Semua')}</td>
      <td style="font-size:12px">${esc(s.bab||'—')}</td>
      <td style="text-align:center">
        <span style="font-size:11px;font-weight:700;color:${tingkatColor[s.tingkat]||'var(--dim)'}">${esc(s.tingkat)}</span>
      </td>
      <td style="text-align:center;font-size:12px;color:var(--muted)">${s.usage_count||0}×</td>
      <td style="text-align:center">
        <div style="display:flex;gap:4px;justify-content:center">
          <button class="btn btn-ghost" style="padding:3px 7px;font-size:11px" onclick="editBankSoal('${s.id}')">✏️</button>
          <button class="btn btn-ghost" style="padding:3px 7px;font-size:11px" onclick="dupBankSoal('${s.id}')">📋</button>
          <button class="btn btn-ghost" style="padding:3px 7px;font-size:11px;color:var(--red)" onclick="delBankSoal('${s.id}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Render KaTeX setelah DOM diupdate
  setTimeout(()=>{ if(typeof renderMath==='function') renderMath(document.getElementById('bank-tbody')); }, 50);
}

function renderBankPagination() {
  const el     = document.getElementById('bank-pagination');
  if (!el) return;
  const pages  = Math.ceil(_bankTotal / _bankLimit);
  const current = Math.floor(_bankOffset / _bankLimit) + 1;
  if (pages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button class="btn btn-ghost" style="font-size:12px" onclick="bankPage(${_bankOffset - _bankLimit})" ${_bankOffset === 0 ? 'disabled' : ''}>← Prev</button>
    <span style="font-size:12px;color:var(--muted);padding:0 10px">${current} / ${pages}</span>
    <button class="btn btn-ghost" style="font-size:12px" onclick="bankPage(${_bankOffset + _bankLimit})" ${current >= pages ? 'disabled' : ''}>Next →</button>`;
}

function bankPage(offset) {
  _bankOffset = Math.max(0, offset);
  loadBankList();
}

// ── Filter ────────────────────────────────────────────────────────────────────
function applyBankFilter() {
  _bankFilter = {
    mapel:   document.getElementById('bank-filter-mapel')?.value   || '',
    kelas:   document.getElementById('bank-filter-kelas')?.value   || '',
    bab:     document.getElementById('bank-filter-bab')?.value     || '',
    tingkat: document.getElementById('bank-filter-tingkat')?.value || '',
    tipe:    document.getElementById('bank-filter-tipe')?.value    || '',
    search:  document.getElementById('bank-filter-search')?.value  || '',
  };
  loadBankBabList();
  loadBankList(true);
}

function resetBankFilter() {
  ['bank-filter-mapel','bank-filter-kelas','bank-filter-bab','bank-filter-tingkat','bank-filter-tipe','bank-filter-search']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  _bankFilter = { mapel:'', kelas:'', bab:'', tingkat:'', tipe:'', search:'' };
  loadBankList(true);
}

// ── Statistik ─────────────────────────────────────────────────────────────────
async function loadBankStats() {
  try {
    const r = await fetch('/api/bank/stats');
    const j = await r.json();
    const d = j.data;
    const el = document.getElementById('bank-stats');
    if (!el) return;
    el.innerHTML = `
      <div class="stat-mini"><span class="stat-n-mini">${d.total}</span><span class="stat-l-mini">Total Soal</span></div>
      ${d.byMapel.slice(0,5).map(m => `<div class="stat-mini"><span class="stat-n-mini">${m.n}</span><span class="stat-l-mini">${esc(m.mapel)}</span></div>`).join('')}
      <div class="stat-mini"><span class="stat-n-mini">${d.byTipe.find(t=>t.tipe==='PG')?.n||0}</span><span class="stat-l-mini">PG</span></div>
      <div class="stat-mini"><span class="stat-n-mini">${(d.byTipe.find(t=>t.tipe==='ES')||d.byTipe.find(t=>t.tipe==='ESSAY'))?.n||0}</span><span class="stat-l-mini">Essay</span></div>`;
  } catch(_) {}
}

// ── Tambah / Edit Soal ────────────────────────────────────────────────────────
function showAddBankSoal() {
  _editSoalId = null;
  document.getElementById('modal-bank-soal-title').textContent = '+ Tambah Soal ke Bank';
  clearBankSoalForm();
  toggleBankOpsi('PG');
  document.getElementById('modal-bank-soal').classList.add('open');
}

async function editBankSoal(id) {
  try {
    const r = await fetch('/api/bank/' + id);
    const j = await r.json();
    if (!j.success) return toast('Soal tidak ditemukan', 'error');
    const s   = j.data;
    _editSoalId = id;
    document.getElementById('modal-bank-soal-title').textContent = '✏️ Edit Soal';
    document.getElementById('bs-mapel').value   = s.mapel  || '';
    document.getElementById('bs-kelas').value   = s.kelas  || 'Semua';
    document.getElementById('bs-bab').value     = s.bab    || '';
    document.getElementById('bs-tingkat').value = s.tingkat|| 'C2';
    document.getElementById('bs-tipe').value    = s.tipe   || 'PG';
    document.getElementById('bs-soal').value    = s.soal   || '';
    document.getElementById('bs-opsi-a').value  = s.opsi_a || '';
    document.getElementById('bs-opsi-b').value  = s.opsi_b || '';
    document.getElementById('bs-opsi-c').value  = s.opsi_c || '';
    document.getElementById('bs-opsi-d').value  = s.opsi_d || '';
    document.getElementById('bs-opsi-e').value  = s.opsi_e || '';
    document.getElementById('bs-kunci').value   = s.kunci  || '';
    document.getElementById('bs-bobot').value   = s.bobot  || 1;
    document.getElementById('bs-tags').value    = (s.tags||[]).join(', ');
    // Teks bacaan
    const tbEl = document.getElementById('bs-teks-bacaan');
    if (tbEl) tbEl.value = s.teks_bacaan || '';
    const tbIdEl = document.getElementById('bs-teks-bacaan-id');
    if (tbIdEl) tbIdEl.value = s.teks_bacaan_id || '';
    // Toggle tampilan teks bacaan
    const tbGroup = document.getElementById('bs-teks-bacaan-group');
    if (tbGroup) tbGroup.style.display = s.teks_bacaan ? 'block' : 'none';
    const tbCheck = document.getElementById('bs-with-teks-bacaan');
    if (tbCheck) tbCheck.checked = !!s.teks_bacaan;
    toggleBankOpsi(s.tipe);
    document.getElementById('modal-bank-soal').classList.add('open');
  } catch(e) { toast('Gagal memuat soal', 'error'); }
}

async function dupBankSoal(id) {
  try {
    const r = await fetch('/api/bank/' + id);
    const j = await r.json();
    if (!j.success) return;
    const s = { ...j.data };
    delete s.id; delete s.created_at; delete s.updated_at; delete s.usage_count;
    s.sumber = 'Duplikat';
    await fetch('/api/bank', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(s) });
    toast('Soal berhasil diduplikat', 'success');
    loadBankList();
  } catch(e) { toast('Gagal menduplikat', 'error'); }
}

async function delBankSoal(id) {
  if (!confirm('Hapus soal ini dari bank?')) return;
  await fetch('/api/bank/' + id, { method: 'DELETE' });
  toast('Soal dihapus', 'success');
  loadBankList();
  loadBankStats();
}

function toggleBankOpsi(tipe) {
  const isPG = tipe === 'PG';
  document.getElementById('bs-opsi-group').style.display  = isPG ? 'block' : 'none';
  document.getElementById('bs-kunci-group').style.display = isPG ? 'block' : 'none';
}

function clearBankSoalForm() {
  ['bs-mapel','bs-kelas','bs-bab','bs-tingkat','bs-tipe','bs-soal',
   'bs-opsi-a','bs-opsi-b','bs-opsi-c','bs-opsi-d','bs-opsi-e','bs-kunci','bs-tags','bs-teks-bacaan','bs-teks-bacaan-id']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const bobot = document.getElementById('bs-bobot');
  if (bobot) bobot.value = 1;
  const kelas = document.getElementById('bs-kelas');
  if (kelas) kelas.value = 'Semua';
  const tingkat = document.getElementById('bs-tingkat');
  if (tingkat) tingkat.value = 'C2';
  const tipe = document.getElementById('bs-tipe');
  if (tipe) tipe.value = 'PG';
}

async function saveBankSoal() {
  const mapel = document.getElementById('bs-mapel').value.trim();
  const soal  = document.getElementById('bs-soal').value.trim();
  const tipe  = document.getElementById('bs-tipe').value;
  const btn   = document.getElementById('btn-save-bank-soal');

  if (!mapel || !soal) return toast('Mapel dan soal wajib diisi', 'error');

  const payload = {
    mapel,
    kelas:   document.getElementById('bs-kelas').value   || 'Semua',
    bab:     document.getElementById('bs-bab').value     || null,
    tingkat: document.getElementById('bs-tingkat').value || 'C2',
    tipe,
    soal,
    opsi_a:  document.getElementById('bs-opsi-a').value  || null,
    opsi_b:  document.getElementById('bs-opsi-b').value  || null,
    opsi_c:  document.getElementById('bs-opsi-c').value  || null,
    opsi_d:       document.getElementById('bs-opsi-d').value  || null,
    opsi_e:       document.getElementById('bs-opsi-e')?.value || null,
    teks_bacaan:  document.getElementById('bs-teks-bacaan')?.value?.trim() || null,
    teks_bacaan_id: document.getElementById('bs-teks-bacaan-id')?.value?.trim() || null,
    kunci:   document.getElementById('bs-kunci').value   || null,
    bobot:   parseInt(document.getElementById('bs-bobot').value) || 1,
    tags:    document.getElementById('bs-tags').value.split(',').map(t=>t.trim()).filter(Boolean),
    sumber:  'Manual',
  };

  btn.disabled = true; btn.textContent = '⏳ Menyimpan...';
  try {
    const url    = _editSoalId ? `/api/bank/${_editSoalId}` : '/api/bank';
    const method = _editSoalId ? 'PUT' : 'POST';
    const r      = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const j      = await r.json();
    if (!j.success) throw new Error(j.error);
    closeModal('modal-bank-soal');
    toast(_editSoalId ? 'Soal diperbarui' : 'Soal ditambahkan ke bank', 'success');
    loadBankList(); loadBankStats(); loadBankMapelList();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Simpan'; }
}

// ── Export / Import ───────────────────────────────────────────────────────────
function exportBankSoal() {
  const mapel  = _bankFilter.mapel;
  const url    = '/api/bank/export' + (mapel ? `?mapel=${encodeURIComponent(mapel)}` : '');
  window.open(url, '_blank');
}

async function importBankSoal(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    // Support berbagai format JSON
    const soal = data.soal || data.data || (Array.isArray(data) ? data : null);
    if (!soal || !Array.isArray(soal)) throw new Error('Format tidak valid — harus ada array "soal"');

    // Kalau soal tidak punya field mapel, minta default
    const hasMapel = soal.some(s => s.mapel || s.mata_pelajaran);
    let defaultMapel = '';
    if (!hasMapel) {
      defaultMapel = prompt('Soal tidak punya field mapel.\nMasukkan mata pelajaran untuk semua soal:', '') || '';
    }

    const r = await fetch('/api/bank/import', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ soal, mapel: defaultMapel }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast(`✅ Berhasil import ${j.inserted} soal${j.skipped ? ' (' + j.skipped + ' dilewati)' : ''}`, 'success');
    loadBankList(true); loadBankStats(); loadBankMapelList();
  } catch(e) { toast('Import gagal: ' + e.message, 'error'); }
  input.value = '';
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Hapus semua soal per mapel — via modal ────────────────────────────────────
async function deleteBankByMapel() {
  await loadBankMapelList();
  if (!_bankMapel.length) return toast('Bank soal masih kosong', 'error');

  const sel = document.getElementById('hapus-mapel-select');
  if (sel) {
    sel.innerHTML = '<option value="">-- Pilih mapel --</option>' +
      _bankMapel.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  }

  // Reset state
  const info = document.getElementById('hapus-mapel-info');
  const btn  = document.getElementById('btn-hapus-mapel-confirm');
  if (info) info.style.display = 'none';
  if (btn)  btn.disabled = true;

  document.getElementById('modal-hapus-mapel').classList.add('open');
}

async function onHapusMapelChange() {
  const mapel = document.getElementById('hapus-mapel-select')?.value;
  const info  = document.getElementById('hapus-mapel-info');
  const btn   = document.getElementById('btn-hapus-mapel-confirm');

  if (!mapel) {
    if (info) info.style.display = 'none';
    if (btn)  btn.disabled = true;
    return;
  }

  // Hitung jumlah soal mapel ini
  try {
    const r = await fetch(`/api/bank?mapel=${encodeURIComponent(mapel)}&limit=1`);
    const j = await r.json();
    const count = j.total || 0;

    document.getElementById('hapus-mapel-count').textContent = count;
    document.getElementById('hapus-mapel-name').textContent  = mapel;
    if (info) info.style.display = 'block';
    if (btn)  btn.disabled = count === 0;
  } catch(_) {}
}

async function confirmHapusMapel() {
  const mapel = document.getElementById('hapus-mapel-select')?.value;
  if (!mapel) return;

  const btn = document.getElementById('btn-hapus-mapel-confirm');
  btn.disabled  = true;
  btn.innerHTML = '⏳ Menghapus...';

  try {
    const r = await fetch(`/api/bank?mapel=${encodeURIComponent(mapel)}`, { method: 'DELETE' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);

    closeModal('modal-hapus-mapel');
    toast(`✅ ${j.deleted} soal mapel "${mapel}" berhasil dihapus dari bank`, 'success');
    loadBankList(true);
    loadBankStats();
    loadBankMapelList();
  } catch(e) {
    toast('Gagal menghapus: ' + e.message, 'error');
    btn.disabled  = false;
    btn.innerHTML = '🗑 Hapus Semua Soal';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MARKDOWN EDITOR — Bank Soal
// ═══════════════════════════════════════════════════════════════════════════════

let _mdMode = 'edit';

function mdSetMode(mode) {
  _mdMode = mode;
  const ta      = document.getElementById('bs-soal');
  const preview = document.getElementById('bs-soal-preview');
  const toolbar = document.getElementById('md-toolbar');
  const btnEdit = document.getElementById('btn-md-edit');
  const btnPrev = document.getElementById('btn-md-preview');

  if (mode === 'edit') {
    ta?.style.setProperty('display','block');
    if (preview) preview.style.display = 'none';
    if (toolbar) toolbar.style.display = 'flex';
    if (btnEdit) { btnEdit.style.borderColor='var(--blue)'; btnEdit.style.color='var(--blue)'; }
    if (btnPrev) { btnPrev.style.borderColor=''; btnPrev.style.color=''; }
  } else {
    mdUpdatePreview();
    ta?.style.setProperty('display','none');
    if (preview) preview.style.display = 'block';
    if (toolbar) toolbar.style.display = 'none';
    if (btnPrev) { btnPrev.style.borderColor='var(--blue)'; btnPrev.style.color='var(--blue)'; }
    if (btnEdit) { btnEdit.style.borderColor=''; btnEdit.style.color=''; }
  }
}

function mdUpdatePreview() {
  const ta      = document.getElementById('bs-soal');
  const preview = document.getElementById('bs-soal-preview');
  if (!ta || !preview) return;
  if (_mdMode !== 'preview') return;

  // Simple markdown → HTML (bold, italic, gambar, newline)
  let html = esc(ta.value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
      '<img src="$2" alt="$1" style="max-width:100%;border-radius:6px;margin:4px 0">')
    .replace(/\n/g, '<br>');

  preview.innerHTML = html;

  // Render KaTeX
  if (typeof renderMathInElement !== 'undefined') {
    try {
      renderMathInElement(preview, {
        delimiters: [
          { left: '$$', right: '$$', display: true  },
          { left: '$',  right: '$',  display: false },
        ],
        throwOnError: false,
      });
    } catch(_) {}
  }
}

function mdInsert(before, after) {
  const ta = document.getElementById('bs-soal');
  if (!ta) return;
  ta.focus();
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const sel   = ta.value.substring(start, end) || 'teks';
  const newVal = ta.value.substring(0, start) + before + sel + after + ta.value.substring(end);
  ta.value = newVal;
  ta.selectionStart = start + before.length;
  ta.selectionEnd   = start + before.length + sel.length;
  mdUpdatePreview();
}

async function mdUploadImage(input) {
  const file = input.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('image', file);
  try {
    const r = await fetch('/api/bank/upload-image', { method: 'POST', body: formData });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    mdInsert(`![${file.name}](${j.url})`, '');
    toast('Gambar berhasil diupload', 'success');
  } catch(e) {
    toast('Upload gagal: ' + e.message, 'error');
  }
  input.value = '';
}