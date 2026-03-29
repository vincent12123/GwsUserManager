// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN USERS — Kelola akun yang bisa login ke GWS Manager
// Hanya Super Admin yang bisa akses
// ═══════════════════════════════════════════════════════════════════════════════

let _adminUsers  = [];
let _editUserId  = null;
let _resetUserId = null;

const ROLE_LABELS = { super_admin: '🔴 Super Admin', operator: '🔵 Operator', guru: '🟢 Guru' };
const ROLE_COLORS = { super_admin: 'var(--red)', operator: 'var(--blue)', guru: 'var(--green)' };

// ── Load daftar user ──────────────────────────────────────────────────────────
async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  tbody.innerHTML = `<tr><td colspan="6"><div class="spinner-wrap"><div class="spinner"></div></div></td></tr>`;

  try {
    const r = await fetch('/api/auth/users', { credentials: 'include' });
    if (r.status === 403) {
      tbody.innerHTML = `<tr><td colspan="6" class="state-box">
        <div class="state-emoji">🔒</div>
        <div class="state-title">Hanya Super Admin yang bisa mengakses halaman ini</div>
      </td></tr>`;
      return;
    }
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    _adminUsers = j.data || [];
    renderAdminUsers();
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red);padding:16px">❌ ${e.message}</td></tr>`;
  }
}

function renderAdminUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  if (!_adminUsers.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="state-box">
      <div class="state-emoji">👥</div>
      <div class="state-title">Belum ada akun</div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = _adminUsers.map(u => `
    <tr>
      <td>
        <div style="font-weight:600;font-size:13px">${esc(u.name)}</div>
        ${u.force_change ? '<div style="font-size:10.5px;color:var(--amber)">⚠️ Wajib ganti password</div>' : ''}
      </td>
      <td style="font-family:var(--mono);font-size:12px;color:var(--muted)">${esc(u.email)}</td>
      <td>
        <span style="font-size:12px;font-weight:600;color:${ROLE_COLORS[u.role]||'var(--muted)'}">
          ${ROLE_LABELS[u.role] || u.role}
        </span>
      </td>
      <td style="text-align:center">
        ${u.is_active
          ? '<span class="badge badge-active"><span class="badge-dot"></span>Aktif</span>'
          : '<span class="badge badge-suspended"><span class="badge-dot"></span>Nonaktif</span>'}
      </td>
      <td style="font-size:12px;color:var(--muted)">
        ${u.last_login ? fmtDateTime(u.last_login) : '<span style="color:var(--muted)">Belum pernah</span>'}
      </td>
      <td style="text-align:center">
        <div style="display:flex;gap:4px;justify-content:center">
          <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px"
            onclick="showEditAdminUser('${u.id}')">✏️ Edit</button>
          <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px"
            onclick="showResetPassword('${u.id}','${esc(u.name)}')">🔑 Reset</button>
          <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;color:${u.is_active?'var(--amber)':'var(--green)'}"
            onclick="toggleActive('${u.id}',${u.is_active})">
            ${u.is_active ? '🚫 Nonaktif' : '✅ Aktifkan'}
          </button>
        </div>
      </td>
    </tr>`).join('');
}

// ── Tambah user baru ──────────────────────────────────────────────────────────
function showAddAdminUser() {
  _editUserId = null;
  document.getElementById('modal-admin-user-title').textContent = '+ Tambah Akun';
  document.getElementById('au-name').value     = '';
  document.getElementById('au-email').value    = '';
  document.getElementById('au-role').value     = 'guru';
  document.getElementById('au-password').value = '';
  document.getElementById('au-pass-group').style.display = 'block';
  document.getElementById('au-email').disabled = false;
  document.getElementById('modal-admin-user').classList.add('open');
}

// ── Edit user ─────────────────────────────────────────────────────────────────
function showEditAdminUser(id) {
  const u = _adminUsers.find(x => x.id === id);
  if (!u) return;
  _editUserId = id;
  document.getElementById('modal-admin-user-title').textContent = '✏️ Edit Akun';
  document.getElementById('au-name').value     = u.name;
  document.getElementById('au-email').value    = u.email;
  document.getElementById('au-role').value     = u.role;
  document.getElementById('au-password').value = '';
  // Saat edit, password tidak wajib diisi (pakai reset-password)
  document.getElementById('au-pass-group').style.display = 'none';
  document.getElementById('au-email').disabled = true; // email tidak bisa diubah saat edit
  document.getElementById('modal-admin-user').classList.add('open');
}

// ── Simpan (tambah atau edit) ─────────────────────────────────────────────────
async function saveAdminUser() {
  const name     = document.getElementById('au-name').value.trim();
  const email    = document.getElementById('au-email').value.trim();
  const role     = document.getElementById('au-role').value;
  const password = document.getElementById('au-password').value;
  const btn      = document.getElementById('btn-save-admin-user');

  if (!name || !role) return toast('Nama dan role wajib diisi', 'error');
  if (!_editUserId && !email) return toast('Email wajib diisi', 'error');
  if (!_editUserId && !password) return toast('Password wajib diisi', 'error');

  btn.disabled = true; btn.textContent = '⏳ Menyimpan...';

  try {
    let r, j;
    if (_editUserId) {
      r = await fetch(`/api/auth/users/${_editUserId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role }),
        credentials: 'include',
      });
    } else {
      r = await fetch('/api/auth/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, role, password }),
        credentials: 'include',
      });
    }
    j = await r.json();
    if (!j.success) throw new Error(j.error || r.statusText);

    closeModal('modal-admin-user');
    toast(_editUserId ? 'Akun berhasil diperbarui' : 'Akun berhasil dibuat', 'success');
    loadAdminUsers();
  } catch(e) {
    toast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Simpan';
  }
}

// ── Reset password ────────────────────────────────────────────────────────────
function showResetPassword(id, name) {
  _resetUserId = id;
  document.getElementById('reset-pass-name').textContent = name;
  document.getElementById('rp-password').value = '';
  document.getElementById('modal-reset-pass').classList.add('open');
}

async function doResetPassword() {
  const pass = document.getElementById('rp-password').value;
  if (!pass || pass.length < 6) return toast('Password minimal 6 karakter', 'error');
  try {
    const r = await fetch(`/api/auth/users/${_resetUserId}/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: pass }),
      credentials: 'include',
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    closeModal('modal-reset-pass');
    toast('Password berhasil direset — user wajib ganti saat login', 'success');
    loadAdminUsers();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

// ── Aktif/Nonaktif ────────────────────────────────────────────────────────────
async function toggleActive(id, currentActive) {
  const action = currentActive ? 'nonaktifkan' : 'aktifkan';
  if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} akun ini?`)) return;
  try {
    const r = await fetch(`/api/auth/users/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: currentActive ? 0 : 1 }),
      credentials: 'include',
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast(`Akun berhasil di${action}kan`, 'success');
    loadAdminUsers();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}