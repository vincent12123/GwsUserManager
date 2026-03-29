// ── USERS ─────────────────────────────────────────────────────────────────────

async function loadUsers() {
  document.getElementById('users-tbody').innerHTML = `<tr><td colspan="5"><div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--muted);font-size:13px">Memuat data user...</span></div></td></tr>`;
  try {
    const [rUsers, rOU] = await Promise.all([
      fetch('/api/users?fetchAll=true'),
      fetch('/api/orgunits')
    ]);
    const jUsers = await rUsers.json();
    if (!rUsers.ok) throw new Error(jUsers.error || 'Gagal memuat data');
    allUsers    = jUsers.users || [];
    allOrgUnits = await rOU.json() || [];
    populateOUDropdowns();
    renderUsers(applySortUsers(allUsers));
    updateStats(allUsers);
    updateUserCountInfo(allUsers.length, allUsers.length);
  } catch(e) { toast('Gagal memuat user: ' + e.message, 'error'); }
}

function populateOUDropdowns() {
  const sorted   = [...allOrgUnits].sort((a, b) => a.orgUnitPath.localeCompare(b.orgUnitPath));
  const ouOpts   = `<option value="">Semua Org Unit</option>` + sorted.map(o => `<option value="${esc(o.orgUnitPath)}">${esc(o.orgUnitPath)}</option>`).join('');
  const srcOpts  = `<option value="">-- Pilih Org Unit --</option>` + sorted.map(o => `<option value="${esc(o.orgUnitPath)}">${esc(o.orgUnitPath)}</option>`).join('');
  const tgtOpts  = `<option value="">-- Pilih Org Unit Tujuan --</option>` + sorted.map(o => `<option value="${esc(o.orgUnitPath)}">${esc(o.orgUnitPath)}</option>`).join('');

  const ouFilter = document.getElementById('ou-filter');
  if (ouFilter) ouFilter.innerHTML = ouOpts;

  const bmouSource = document.getElementById('bmou-ou-source');
  if (bmouSource) bmouSource.innerHTML = srcOpts;
  const bmouTarget = document.getElementById('bmou-target');
  if (bmouTarget) bmouTarget.innerHTML = tgtOpts;
  const blSource = document.getElementById('bl-ou-source');
  if (blSource) blSource.innerHTML = srcOpts;

  const editOU = document.getElementById('edit-ou');
  if (editOU) {
    const cur = editOU.value;
    editOU.innerHTML = `<option value="/">/ (Root)</option>` + sorted.map(o => `<option value="${esc(o.orgUnitPath)}">${esc(o.orgUnitPath)}</option>`).join('');
    if (cur) editOU.value = cur;
  }
  if (typeof populateImportOUDropdown === 'function') populateImportOUDropdown();
}

function updateUserCountInfo(shown, total) {
  const el = document.getElementById('user-count-info');
  if (el) el.textContent = shown === total ? `${total} user` : `${shown} dari ${total} user`;
}

function updateStats(users) {
  const total     = users.length;
  const suspended = users.filter(u => u.suspended).length;
  const elTotal   = document.getElementById('stat-users-total');
  const elActive  = document.getElementById('stat-users-active');
  const elSusp    = document.getElementById('stat-users-suspended');
  if (elTotal)  elTotal.textContent  = total;
  if (elActive) elActive.textContent = total - suspended;
  if (elSusp)   elSusp.textContent   = suspended;
}

function renderUsers(users) {
  if (!users.length) {
    document.getElementById('users-tbody').innerHTML = `<tr><td colspan="5" class="state-box"><div class="state-emoji">📭</div><div class="state-title">Tidak ada user</div></td></tr>`;
    return;
  }
  document.getElementById('users-tbody').innerHTML = users.map(u => `
    <tr>
      <td>
        <div class="user-name">${esc(u.name?.fullName || u.fullName || '-')}</div>
        <div class="user-email">${esc(u.primaryEmail || u.email || '-')}</div>
      </td>
      <td><span class="ou-path">${esc(u.orgUnitPath || '/')}</span></td>
      <td>
        <span class="badge ${u.archived ? 'badge-archived' : u.suspended ? 'badge-suspended' : 'badge-active'}">
          <span class="badge-dot"></span>${u.archived ? 'Archived' : u.suspended ? 'Suspended' : 'Aktif'}
        </span>
      </td>
      <td style="color:var(--muted);font-size:12px;font-family:var(--mono)">${fmtDate(u.creationTime)}</td>
      <td>
        <div class="action-group" style="justify-content:center">
          <button class="btn-icon" title="Edit" onclick="openEditUser('${esc(u.primaryEmail || u.email)}')">✏️</button>
          ${u.archived
            ? `<button class="btn-icon" title="Restore ke Aktif" onclick="restoreArchivedUser('${esc(u.primaryEmail || u.email)}')">♻️</button>`
            : `<button class="btn-icon ${u.suspended ? '' : 'danger'}" title="${u.suspended ? 'Aktifkan' : 'Suspend'}" onclick="toggleSuspend('${esc(u.primaryEmail || u.email)}', ${u.suspended})">${u.suspended ? '▶' : '⏸'}</button>`
          }
          <button class="btn-icon danger" title="Hapus" onclick="confirmDeleteUser('${esc(u.primaryEmail || u.email)}')">🗑</button>
        </div>
      </td>
    </tr>`).join('');
}

function filterUsers() {
  const q     = document.getElementById('user-search').value.toLowerCase();
  const ouVal = document.getElementById('ou-filter')?.value || '';
  const stVal = document.getElementById('status-filter')?.value || '';

  const filtered = allUsers.filter(u => {
    const name  = (u.name?.fullName || u.fullName || '').toLowerCase();
    const email = (u.primaryEmail || '').toLowerCase();
    const ou    = u.orgUnitPath || '/';
    const matchText   = !q    || name.includes(q) || email.includes(q);
    const matchOU     = !ouVal || ou === ouVal;
    const matchStatus = !stVal ||
      (stVal === 'active'    && !u.suspended && !u.archived) ||
      (stVal === 'suspended' &&  u.suspended && !u.archived) ||
      (stVal === 'archived'  &&  u.archived);
    return matchText && matchOU && matchStatus;
  });

  renderUsers(applySortUsers(filtered));
  updateUserCountInfo(filtered.length, allUsers.length);
}

function clearFilters() {
  document.getElementById('user-search').value = '';
  const ouF = document.getElementById('ou-filter');
  const stF = document.getElementById('status-filter');
  if (ouF) ouF.value = '';
  if (stF) stF.value = '';
  renderUsers(applySortUsers(allUsers));
  updateUserCountInfo(allUsers.length, allUsers.length);
}

function sortUsers(col) {
  if (sortState.col === col) {
    sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sortState.col = col;
    sortState.dir = 'asc';
  }
  ['name', 'ou', 'status', 'date'].forEach(c => {
    const el = document.getElementById('sort-' + c);
    if (!el) return;
    if (c === col) { el.textContent = sortState.dir === 'asc' ? '↑' : '↓'; el.style.opacity = '1'; el.style.color = 'var(--accent)'; }
    else           { el.textContent = '↕'; el.style.opacity = '.4'; el.style.color = ''; }
  });
  const q = document.getElementById('user-search').value.toLowerCase();
  const filtered = q ? allUsers.filter(u => (u.name?.fullName || '').toLowerCase().includes(q) || (u.primaryEmail || '').toLowerCase().includes(q)) : [...allUsers];
  renderUsers(applySortUsers(filtered));
}

function applySortUsers(users) {
  if (!sortState.col) return users;
  const dir = sortState.dir === 'asc' ? 1 : -1;
  return [...users].sort((a, b) => {
    let va, vb;
    switch (sortState.col) {
      case 'name':   va = (a.name?.fullName || a.primaryEmail || '').toLowerCase(); vb = (b.name?.fullName || b.primaryEmail || '').toLowerCase(); break;
      case 'ou':     va = (a.orgUnitPath || '/').toLowerCase(); vb = (b.orgUnitPath || '/').toLowerCase(); break;
      case 'status': va = a.archived ? 2 : a.suspended ? 1 : 0; vb = b.archived ? 2 : b.suspended ? 1 : 0; break;
      case 'date':   va = a.creationTime ? new Date(a.creationTime).getTime() : 0; vb = b.creationTime ? new Date(b.creationTime).getTime() : 0; break;
      default: return 0;
    }
    return va < vb ? -dir : va > vb ? dir : 0;
  });
}

// ── CRUD Modal ────────────────────────────────────────────────────────────────

function openUserModal() {
  ['u-firstname', 'u-lastname', 'u-email', 'u-password', 'u-ou'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('modal-user-title').textContent = 'Tambah User Baru';
  document.getElementById('modal-user').classList.add('open');
}

async function submitUser() {
  const btn  = document.getElementById('modal-user-submit');
  const data = {
    firstName: document.getElementById('u-firstname').value.trim(),
    lastName:  document.getElementById('u-lastname').value.trim(),
    email:     document.getElementById('u-email').value.trim(),
    password:  document.getElementById('u-password').value.trim(),
    orgUnit:   document.getElementById('u-ou').value.trim() || '/'
  };
  if (!data.firstName || !data.lastName || !data.email || !data.password)
    return toast('Semua field wajib diisi!', 'error');

  btn.disabled = true; btn.innerHTML = '<div class="spinner spin-sm"></div> Menyimpan...';
  try {
    const r = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Gagal membuat user');
    toast(`User ${j.user?.primaryEmail || data.email} berhasil dibuat!`, 'success');
    closeModal('modal-user');
    loadUsers();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled = false; btn.innerHTML = 'Simpan';
}

async function openEditUser(email) {
  try {
    const [rUser, rOU] = await Promise.all([
      fetch(`/api/users/${encodeURIComponent(email)}`),
      fetch('/api/orgunits')
    ]);
    if (!rUser.ok) throw new Error('Gagal memuat data user');
    const u  = await rUser.json();
    const ou = await rOU.json();

    document.getElementById('edit-original-email').value = email;
    document.getElementById('edit-firstname').value = u.name?.givenName  || '';
    document.getElementById('edit-lastname').value  = u.name?.familyName || '';
    document.getElementById('edit-email').value     = '';
    document.getElementById('edit-password').value  = '';

    const select    = document.getElementById('edit-ou');
    const currentOU = u.orgUnitPath || '/';
    const sorted    = (ou || []).sort((a, b) => a.orgUnitPath.localeCompare(b.orgUnitPath));
    select.innerHTML = `<option value="/">/ (Root)</option>` +
      sorted.map(o => `<option value="${esc(o.orgUnitPath)}" ${o.orgUnitPath === currentOU ? 'selected' : ''}>${esc(o.orgUnitPath)}</option>`).join('');
    if (currentOU === '/') select.value = '/';

    document.getElementById('modal-edit-user').classList.add('open');
  } catch(e) { toast('Gagal buka edit: ' + e.message, 'error'); }
}

async function saveEditUser() {
  const btn           = document.getElementById('edit-user-submit');
  const originalEmail = document.getElementById('edit-original-email').value;
  const body = {
    firstName: document.getElementById('edit-firstname').value.trim(),
    lastName:  document.getElementById('edit-lastname').value.trim(),
    orgUnit:   document.getElementById('edit-ou').value || '/',
  };
  const newEmail = document.getElementById('edit-email').value.trim();
  const newPass  = document.getElementById('edit-password').value.trim();
  if (newEmail) body.newEmail  = newEmail;
  if (newPass)  body.password  = newPass;

  btn.disabled = true; btn.innerHTML = '<div class="spinner spin-sm"></div> Menyimpan...';
  try {
    const r = await fetch(`/api/users/${encodeURIComponent(originalEmail)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Gagal menyimpan');
    toast(`User ${newEmail || originalEmail} berhasil diupdate.`, 'success');
    closeModal('modal-edit-user');
    loadUsers();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled = false; btn.innerHTML = '💾 Simpan Perubahan';
}

async function restoreArchivedUser(email) {
  if (!confirm(`Restore ${email} ke aktif?`)) return;
  try {
    const r = await fetch('/api/users/license', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, licenseType: 'active' }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Gagal restore');
    toast(`${email} berhasil di-restore ke aktif.`, 'success');
    loadUsers();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

async function toggleSuspend(email, isSuspended) {
  try {
    const r = await fetch(`/api/users/${encodeURIComponent(email)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ suspended: !isSuspended }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Gagal update status');
    toast(`User ${isSuspended ? 'diaktifkan' : 'di-suspend'}.`, 'success');
    loadUsers();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

function confirmDeleteUser(email) {
  document.getElementById('confirm-title').textContent = 'Hapus User';
  document.getElementById('confirm-msg').innerHTML = `Yakin ingin menghapus akun:<br><br><strong style="font-family:var(--mono)">${esc(email)}</strong><br><br>Tindakan ini tidak dapat dibatalkan.`;
  document.getElementById('confirm-ok').onclick    = () => deleteUser(email);
  document.getElementById('modal-confirm').classList.add('open');
}

async function deleteUser(email) {
  closeModal('modal-confirm');
  try {
    const r = await fetch(`/api/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Gagal menghapus user');
    toast(`${email} berhasil dihapus.`, 'success');
    loadUsers();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

// ── MODAL helper ──────────────────────────────────────────────────────────────

function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
  ['cls-teacher-suggest', 'cls-student-suggest', 'bd-suggest', 'add-student-suggest',
   'bmou-suggest', 'bl-suggest', 'dt-teacher-suggest', 'dt-target-suggest', 'add-teacher-suggest'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.contains(e.target)) el.classList.remove('open');
  });
});