// ── BULK DELETE ───────────────────────────────────────────────────────────────

let bdSearchTimer = null;

function openBulkDelete() {
  bdSelected = {};
  bdRenderTags();
  document.getElementById('bd-search').value = '';
  document.getElementById('bd-suggest').classList.remove('open');
  document.getElementById('modal-bulk-delete').classList.add('open');
}

function bdSearch(input) {
  const q   = input.value.toLowerCase().trim();
  const box = document.getElementById('bd-suggest');
  if (q.length < 2) { box.classList.remove('open'); return; }
  clearTimeout(bdSearchTimer);
  bdSearchTimer = setTimeout(() => {
    const filtered = allUsers.filter(u => {
      const name  = (u.name?.fullName || '').toLowerCase();
      const email = (u.primaryEmail || '').toLowerCase();
      return (name.includes(q) || email.includes(q)) && !bdSelected[u.primaryEmail];
    }).slice(0, 10);
    if (!filtered.length) { box.innerHTML = '<div class="ac-msg">Tidak ditemukan</div>'; box.classList.add('open'); return; }
    box.innerHTML = filtered.map(u => `
      <div class="ac-item" onclick="bdSelectUser('${esc(u.primaryEmail)}','${esc(u.name?.fullName || u.primaryEmail)}')">
        <div class="ac-name">${esc(u.name?.fullName || '-')}</div>
        <div class="ac-email">${esc(u.primaryEmail)}</div>
      </div>`).join('');
    box.classList.add('open');
  }, 200);
}

function bdSelectUser(email, name) {
  document.getElementById('bd-suggest').classList.remove('open');
  document.getElementById('bd-search').value = '';
  if (bdSelected[email]) return;
  bdSelected[email] = name;
  bdRenderTags();
}

function bdRemoveUser(email) { delete bdSelected[email]; bdRenderTags(); }
function bdClearAll()        { bdSelected = {}; bdRenderTags(); document.getElementById('bd-search').value = ''; }

function bdRenderTags() {
  const wrap  = document.getElementById('bd-tags');
  const count = Object.keys(bdSelected).length;
  const btn   = document.getElementById('bd-confirm-btn');
  document.getElementById('bd-count-label').textContent = count ? ` (${count})` : '';
  document.getElementById('bd-btn-count').textContent   = count;
  btn.disabled = count === 0;
  if (count === 0) {
    wrap.innerHTML = '<span id="bd-empty-hint" style="color:var(--muted);font-size:12px;padding:4px">Belum ada user dipilih...</span>';
    return;
  }
  wrap.innerHTML = Object.entries(bdSelected).map(([email, name]) => `
    <div style="display:inline-flex;align-items:center;gap:6px;background:var(--red-lt);border:1px solid rgba(220,38,38,.25);color:var(--red);padding:5px 10px;border-radius:6px;font-size:11.5px;font-weight:600;max-width:100%">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px" title="${esc(email)}">${esc(name)}</span>
      <button onclick="bdRemoveUser('${esc(email)}')" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;line-height:1;padding:0;flex-shrink:0;opacity:.7">×</button>
    </div>`).join('');
}

function confirmBulkDelete() {
  const count = Object.keys(bdSelected).length;
  if (count === 0) return;
  document.getElementById('confirm-title').textContent = `⚠️ Konfirmasi Hapus ${count} User`;
  document.getElementById('confirm-msg').innerHTML = `
    Yakin ingin menghapus permanen <strong>${count} user</strong> berikut?<br><br>
    ${Object.entries(bdSelected).map(([email, name]) => `<span style="font-family:var(--mono);font-size:12px;display:block;padding:2px 0">• ${esc(name)} — ${esc(email)}</span>`).join('')}
    <br><span style="color:var(--red);font-weight:600">Tindakan ini tidak dapat dibatalkan!</span>`;
  document.getElementById('confirm-ok').textContent = 'Hapus';
  document.getElementById('confirm-ok').onclick = executeBulkDelete;
  closeModal('modal-bulk-delete');
  document.getElementById('modal-confirm').classList.add('open');
}

async function executeBulkDelete() {
  closeModal('modal-confirm');
  const emails = Object.keys(bdSelected);
  if (!emails.length) return;
  toast(`Menghapus ${emails.length} user...`, '');
  const results = { success: [], failed: [] };
  for (const email of emails) {
    try {
      const r = await fetch(`/api/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Gagal');
      results.success.push(email);
    } catch(e) { results.failed.push({ email, error: e.message }); }
  }
  if (!results.failed.length) {
    toast(`✅ ${results.success.length} user berhasil dihapus.`, 'success');
  } else {
    toast(`Selesai: ${results.success.length} berhasil, ${results.failed.length} gagal.`, 'warning');
  }
  bdSelected = {};
  loadUsers();
}

// ── BULK PINDAH ORG UNIT ──────────────────────────────────────────────────────

let bmouSearchTimer = null;
let bmouMode = 'ou';

function openBulkMoveOU() {
  if (!allUsers.length) return toast('Muat data user dulu (klik Refresh)', 'error');
  bmouSelected = {};
  bmouRenderTags();
  document.getElementById('bmou-search').value          = '';
  document.getElementById('bmou-ou-source').value       = '';
  document.getElementById('bmou-ou-preview').textContent = '';
  document.getElementById('bmou-suggest').classList.remove('open');
  bmouSetMode('ou');
  document.getElementById('modal-bulk-move-ou').classList.add('open');
}

function bmouSetMode(mode) {
  bmouMode = mode;
  document.getElementById('bmou-panel-ou').style.display  = mode === 'ou'  ? 'block' : 'none';
  document.getElementById('bmou-panel-tag').style.display = mode === 'tag' ? 'block' : 'none';
  document.getElementById('bmou-mode-ou').className  = 'btn ' + (mode === 'ou'  ? 'btn-primary' : 'btn-ghost');
  document.getElementById('bmou-mode-tag').className = 'btn ' + (mode === 'tag' ? 'btn-primary' : 'btn-ghost');
  document.getElementById('bmou-mode-ou').style.justifyContent  = 'center';
  document.getElementById('bmou-mode-tag').style.justifyContent = 'center';
}

function bmouLoadFromOU() {
  const ou = document.getElementById('bmou-ou-source').value;
  if (!ou) { bmouSelected = {}; bmouRenderTags(); document.getElementById('bmou-ou-preview').textContent = ''; return; }
  const users = allUsers.filter(u => u.orgUnitPath === ou);
  bmouSelected = {};
  users.forEach(u => { bmouSelected[u.primaryEmail] = { name: u.name?.fullName || u.primaryEmail, currentOU: u.orgUnitPath || '/' }; });
  document.getElementById('bmou-ou-preview').innerHTML = users.length
    ? `<span style="color:var(--green);font-weight:600">✓ ${users.length} user ditemukan di ${esc(ou)}</span>`
    : `<span style="color:var(--red)">Tidak ada user di org unit ini</span>`;
  bmouRenderTags();
}

function bmouSearch(input) {
  const q   = input.value.toLowerCase().trim();
  const box = document.getElementById('bmou-suggest');
  if (q.length < 2) { box.classList.remove('open'); return; }
  clearTimeout(bmouSearchTimer);
  bmouSearchTimer = setTimeout(() => {
    const filtered = allUsers.filter(u => {
      const name  = (u.name?.fullName || '').toLowerCase();
      const email = (u.primaryEmail || '').toLowerCase();
      return (name.includes(q) || email.includes(q)) && !bmouSelected[u.primaryEmail];
    }).slice(0, 10);
    if (!filtered.length) { box.innerHTML = '<div class="ac-msg">Tidak ditemukan</div>'; box.classList.add('open'); return; }
    box.innerHTML = filtered.map(u => `
      <div class="ac-item" onclick="bmouSelectUser('${esc(u.primaryEmail)}','${esc(u.name?.fullName || u.primaryEmail)}','${esc(u.orgUnitPath || '/')}')">
        <div class="ac-name">${esc(u.name?.fullName || '-')}</div>
        <div class="ac-email">${esc(u.primaryEmail)} &nbsp;·&nbsp; <span style="color:var(--muted)">${esc(u.orgUnitPath || '/')}</span></div>
      </div>`).join('');
    box.classList.add('open');
  }, 200);
}

function bmouSelectUser(email, name, currentOU) {
  document.getElementById('bmou-suggest').classList.remove('open');
  document.getElementById('bmou-search').value = '';
  if (bmouSelected[email]) return;
  bmouSelected[email] = { name, currentOU };
  bmouRenderTags();
}

function bmouRemoveUser(email) { delete bmouSelected[email]; bmouRenderTags(); }

function bmouClearAll() {
  bmouSelected = {};
  bmouRenderTags();
  document.getElementById('bmou-search').value          = '';
  document.getElementById('bmou-ou-source').value       = '';
  document.getElementById('bmou-ou-preview').textContent = '';
}

function bmouRenderTags() {
  const count = Object.keys(bmouSelected).length;
  const wrap  = document.getElementById('bmou-tags');
  document.getElementById('bmou-count-label').textContent = count ? ` (${count})` : '';
  document.getElementById('bmou-btn-count').textContent   = count;
  document.getElementById('bmou-confirm-btn').disabled    = count === 0;
  if (!count) { wrap.innerHTML = '<span style="color:var(--muted);font-size:12px;padding:4px">Belum ada user dipilih...</span>'; return; }
  if (count > 10) {
    const ous = [...new Set(Object.values(bmouSelected).map(d => d.currentOU))];
    wrap.innerHTML = `<div style="width:100%;padding:6px 4px;font-size:12.5px;color:var(--amber);font-weight:600">${count} user dari: ${ous.map(o => `<span style="font-family:var(--mono);font-size:11px">${esc(o)}</span>`).join(', ')}</div>`;
    return;
  }
  wrap.innerHTML = Object.entries(bmouSelected).map(([email, d]) => `
    <div style="display:inline-flex;align-items:center;gap:6px;background:var(--amber-lt);border:1px solid rgba(217,119,6,.25);color:var(--amber);padding:5px 10px;border-radius:6px;font-size:11.5px;font-weight:600">
      <div><div>${esc(d.name)}</div><div style="font-size:10px;font-family:var(--mono);opacity:.7">${esc(d.currentOU)}</div></div>
      <button onclick="bmouRemoveUser('${esc(email)}')" style="background:none;border:none;cursor:pointer;color:var(--amber);font-size:14px;line-height:1;padding:0;opacity:.7">×</button>
    </div>`).join('');
}

async function executeBulkMoveOU() {
  const target = document.getElementById('bmou-target').value;
  if (!target) return toast('Pilih org unit tujuan dulu!', 'error');
  const emails = Object.keys(bmouSelected);
  if (!emails.length) return toast('Pilih user dulu!', 'error');
  const btn   = document.getElementById('bmou-confirm-btn');
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner spin-sm"></div> Memindahkan ${emails.length} user...`;
  const results = { success: [], failed: [] };
  for (const email of emails) {
    try {
      const r = await fetch(`/api/users/${encodeURIComponent(email)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgUnit: target }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Gagal');
      results.success.push(email);
    } catch(e) { results.failed.push({ email, error: e.message }); }
  }
  btn.disabled  = false;
  btn.innerHTML = `📂 Pindah <span id="bmou-btn-count">0</span> User`;
  if (!results.failed.length) {
    toast(`✅ ${results.success.length} user berhasil dipindah ke ${target}`, 'success');
    closeModal('modal-bulk-move-ou');
  } else {
    toast(`${results.success.length} berhasil, ${results.failed.length} gagal.`, 'warning');
  }
  bmouSelected = {};
  loadUsers();
}

// ── BULK GANTI LISENSI ────────────────────────────────────────────────────────

let blSearchTimer = null;
let blMode = 'ou';

function openBulkLicense() {
  if (!allUsers.length) return toast('Muat data user dulu (klik Refresh)', 'error');
  blSelected = {};
  blRenderTags();
  document.getElementById('bl-search').value          = '';
  document.getElementById('bl-ou-source').value       = '';
  document.getElementById('bl-ou-preview').textContent = '';
  document.getElementById('bl-suggest').classList.remove('open');
  blSetMode('ou');
  document.getElementById('modal-bulk-license').classList.add('open');
}

function blSetMode(mode) {
  blMode = mode;
  document.getElementById('bl-panel-ou').style.display  = mode === 'ou'  ? 'block' : 'none';
  document.getElementById('bl-panel-tag').style.display = mode === 'tag' ? 'block' : 'none';
  document.getElementById('bl-mode-ou').className  = 'btn ' + (mode === 'ou'  ? 'btn-primary' : 'btn-ghost');
  document.getElementById('bl-mode-tag').className = 'btn ' + (mode === 'tag' ? 'btn-primary' : 'btn-ghost');
  document.getElementById('bl-mode-ou').style.justifyContent  = 'center';
  document.getElementById('bl-mode-tag').style.justifyContent = 'center';
}

function blLoadFromOU() {
  const ou = document.getElementById('bl-ou-source').value;
  if (!ou) { blSelected = {}; blRenderTags(); document.getElementById('bl-ou-preview').textContent = ''; return; }
  const users = allUsers.filter(u => u.orgUnitPath === ou);
  blSelected  = {};
  users.forEach(u => { blSelected[u.primaryEmail] = u.name?.fullName || u.primaryEmail; });
  document.getElementById('bl-ou-preview').innerHTML = users.length
    ? `<span style="color:var(--green);font-weight:600">✓ ${users.length} user ditemukan di ${esc(ou)}</span>`
    : `<span style="color:var(--red)">Tidak ada user di org unit ini</span>`;
  blRenderTags();
}

function blSearch(input) {
  const q   = input.value.toLowerCase().trim();
  const box = document.getElementById('bl-suggest');
  if (q.length < 2) { box.classList.remove('open'); return; }
  clearTimeout(blSearchTimer);
  blSearchTimer = setTimeout(() => {
    const filtered = allUsers.filter(u => {
      const name  = (u.name?.fullName || '').toLowerCase();
      const email = (u.primaryEmail || '').toLowerCase();
      return (name.includes(q) || email.includes(q)) && !blSelected[u.primaryEmail];
    }).slice(0, 10);
    if (!filtered.length) { box.innerHTML = '<div class="ac-msg">Tidak ditemukan</div>'; box.classList.add('open'); return; }
    box.innerHTML = filtered.map(u => `
      <div class="ac-item" onclick="blSelectUser('${esc(u.primaryEmail)}','${esc(u.name?.fullName || u.primaryEmail)}')">
        <div class="ac-name">${esc(u.name?.fullName || '-')}</div>
        <div class="ac-email">${esc(u.primaryEmail)}</div>
      </div>`).join('');
    box.classList.add('open');
  }, 200);
}

function blSelectUser(email, name) {
  document.getElementById('bl-suggest').classList.remove('open');
  document.getElementById('bl-search').value = '';
  if (blSelected[email]) return;
  blSelected[email] = name;
  blRenderTags();
}

function blRemoveUser(email) { delete blSelected[email]; blRenderTags(); }

function blClearAll() {
  blSelected = {};
  blRenderTags();
  document.getElementById('bl-search').value          = '';
  document.getElementById('bl-ou-source').value       = '';
  document.getElementById('bl-ou-preview').textContent = '';
}

function blRenderTags() {
  const count = Object.keys(blSelected).length;
  const wrap  = document.getElementById('bl-tags');
  document.getElementById('bl-count-label').textContent = count ? ` (${count})` : '';
  document.getElementById('bl-btn-count').textContent   = count;
  document.getElementById('bl-confirm-btn').disabled    = count === 0;
  if (!count) { wrap.innerHTML = '<span style="color:var(--muted);font-size:12px;padding:4px">Belum ada user dipilih...</span>'; return; }
  if (count > 10) { wrap.innerHTML = `<div style="width:100%;padding:6px 4px;font-size:12.5px;color:var(--accent-dk);font-weight:600">${count} user siap diproses</div>`; return; }
  wrap.innerHTML = Object.entries(blSelected).map(([email, name]) => `
    <div style="display:inline-flex;align-items:center;gap:6px;background:var(--accent-lt);border:1px solid rgba(26,110,250,.25);color:var(--accent-dk);padding:5px 10px;border-radius:6px;font-size:11.5px;font-weight:600">
      <span>${esc(name)}</span>
      <button onclick="blRemoveUser('${esc(email)}')" style="background:none;border:none;cursor:pointer;color:var(--accent);font-size:14px;line-height:1;padding:0;opacity:.7">×</button>
    </div>`).join('');
}

function confirmBulkLicense() {
  const target      = document.getElementById('bl-target').value;
  const targetLabel = document.getElementById('bl-target').selectedOptions[0]?.text || '';
  if (!target) return toast('Pilih lisensi tujuan dulu!', 'error');
  const emails = Object.keys(blSelected);
  if (!emails.length) return toast('Pilih user dulu!', 'error');
  document.getElementById('confirm-title').textContent = '🔖 Konfirmasi Ganti Lisensi';
  document.getElementById('confirm-msg').innerHTML = `
    Ganti lisensi <strong>${emails.length} user</strong> ke:<br><br>
    <strong style="color:var(--accent)">${esc(targetLabel)}</strong><br><br>
    ${emails.length <= 10
      ? emails.map(e => `<span style="font-family:var(--mono);font-size:12px;display:block;padding:1px 0">• ${esc(blSelected[e])} — ${esc(e)}</span>`).join('')
      : `<span style="color:var(--muted);font-size:12px">${emails.length} user akan diproses...</span>`}`;
  document.getElementById('confirm-ok').textContent = 'Ya, Ganti Lisensi';
  document.getElementById('confirm-ok').onclick     = () => executeBulkLicense(target);
  closeModal('modal-bulk-license');
  document.getElementById('modal-confirm').classList.add('open');
}

async function executeBulkLicense(licenseType) {
  closeModal('modal-confirm');
  const emails = Object.keys(blSelected);
  toast(`Mengganti lisensi ${emails.length} user...`, '');
  const results = { success: [], failed: [] };
  for (const email of emails) {
    try {
      const r = await fetch('/api/users/license', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, licenseType }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Gagal');
      results.success.push(email);
    } catch(e) { results.failed.push({ email, error: e.message }); }
  }
  if (!results.failed.length) {
    toast(`✅ ${results.success.length} user berhasil diganti lisensinya.`, 'success');
  } else {
    toast(`${results.success.length} berhasil, ${results.failed.length} gagal.`, 'warning');
    results.failed.forEach(f => console.warn('Gagal ganti lisensi:', f.email, f.error));
  }
  blSelected = {};
  loadUsers();
}
