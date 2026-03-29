// ── CLASSROOM ─────────────────────────────────────────────────────────────────

async function loadCourses() {
  document.getElementById('cls-tbody').innerHTML = `<tr><td colspan="4"><div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--muted);font-size:13px">Memuat kelas...</span></div></td></tr>`;
  try {
    const r = await fetch('/api/classroom/courses');
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    allCourses = j.data;
    renderCourses(allCourses);
  } catch(e) { toast('Gagal memuat kelas: ' + e.message, 'error'); }
}

function renderCourses(courses) {
  if (!courses.length) {
    document.getElementById('cls-tbody').innerHTML = `<tr><td colspan="4" class="state-box"><div class="state-emoji">📭</div><div class="state-title">Belum ada kelas</div></td></tr>`;
    return;
  }
  document.getElementById('cls-tbody').innerHTML = courses.map(c => `
    <tr>
      <td><div class="user-name">${esc(c.name)}</div><div class="user-email">${esc(c.section)}</div></td>
      <td><span class="ou-path">${esc(c.email)}</span></td>
      <td>
        <span class="badge ${c.state === 'ACTIVE' ? 'badge-active' : 'badge-archived'}">
          <span class="badge-dot"></span>${c.state === 'ACTIVE' ? 'Aktif' : 'Archived'}
        </span>
      </td>
      <td>
        <div class="action-group" style="justify-content:center">
          <button class="btn-icon" title="Edit kelas" onclick="openEditCourse('${esc(c.id)}','${esc(c.name)}','${esc(c.section)}','${esc(c.state)}')">✏️</button>
          <button class="btn-icon" title="Lihat siswa" onclick="loadStudents('${esc(c.id)}','${esc(c.name)}')">👩‍🎓</button>
          <button class="btn-icon" title="Kelola guru" onclick="loadTeachers('${esc(c.id)}','${esc(c.name)}')">👨‍🏫</button>
          <button class="btn-icon" title="Pengumuman" onclick="loadAnnouncements('${esc(c.id)}','${esc(c.name)}')">📢</button>
          <button class="btn-icon" title="Tugas" onclick="loadCoursework('${esc(c.id)}','${esc(c.name)}')">📝</button>
          <button class="btn-icon danger" title="Hapus kelas" onclick="confirmDeleteCourse('${esc(c.id)}','${esc(c.name)}')">🗑</button>
        </div>
      </td>
    </tr>`).join('');
}

function filterCourses() {
  const q = document.getElementById('cls-search').value.toLowerCase();
  renderCourses(allCourses.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)));
}

// ── Autocomplete shared ────────────────────────────────────────────────────────
let acTimer = null;

function acSearch(input, boxId) {
  const q   = input.value.trim();
  const box = document.getElementById(boxId);
  if (q.length < 3) { box.classList.remove('open'); return; }
  clearTimeout(acTimer);
  box.innerHTML = '<div class="ac-msg">Mencari...</div>';
  box.classList.add('open');
  acTimer = setTimeout(async () => {
    const r = await fetch(`/api/classroom/search-users?q=${encodeURIComponent(q)}`);
    const j = await r.json();
    const users = j.data || [];
    if (!users.length) { box.innerHTML = '<div class="ac-msg">Tidak ditemukan</div>'; return; }
    box.innerHTML = users.map(u => `
      <div class="ac-item" onclick="selectAcUser('${esc(u.email)}','${esc(u.name)}','${input.id}','${boxId}')">
        <div class="ac-name">${esc(u.name)}</div>
        <div class="ac-email">${esc(u.email)}</div>
      </div>`).join('');
  }, 300);
}

function selectAcUser(email, name, inputId, boxId) {
  document.getElementById(boxId).classList.remove('open');
  if (inputId === 'cls-teacher-search') {
    document.getElementById('cls-teacher-email').value   = email;
    document.getElementById('cls-teacher-search').value  = name;
    document.getElementById('cls-teacher-text').textContent = name + ' · ' + email;
    document.getElementById('cls-teacher-selected').classList.add('show');
  } else if (inputId === 'add-student-search') {
    if (!addStudentSelected[email]) {
      addStudentSelected[email] = name;
      const tag = document.createElement('div');
      tag.className = 'tag'; tag.dataset.email = email;
      tag.innerHTML = `<span>${esc(name)}</span><button class="tag-rm" onclick="removeAddStudent('${esc(email)}',this.parentElement)">×</button>`;
      document.getElementById('add-student-tags').appendChild(tag);
      document.getElementById('add-student-actions').style.display = Object.keys(addStudentSelected).length ? 'block' : 'none';
    }
    document.getElementById('add-student-search').value = '';
  } else {
    if (!chosenStudents.includes(email)) {
      chosenStudents.push(email);
      const tag = document.createElement('div');
      tag.className = 'tag'; tag.dataset.email = email;
      tag.innerHTML = `<span>${esc(name)}</span><button class="tag-rm" onclick="removeStudent('${esc(email)}',this.parentElement)">×</button>`;
      document.getElementById('cls-students-tags').appendChild(tag);
    }
    document.getElementById('cls-student-search').value = '';
  }
}

function removeStudent(email, el) { chosenStudents = chosenStudents.filter(e => e !== email); el.remove(); }

function clearTeacher() {
  document.getElementById('cls-teacher-email').value = '';
  document.getElementById('cls-teacher-search').value = '';
  document.getElementById('cls-teacher-selected').classList.remove('show');
}

function clearCourseForm() {
  document.getElementById('cls-name').value    = '';
  document.getElementById('cls-section').value = '';
  clearTeacher();
  document.getElementById('cls-students-tags').innerHTML = '';
  chosenStudents = [];
}

async function submitCourse() {
  const btn  = document.getElementById('cls-submit-btn');
  const data = {
    name:          document.getElementById('cls-name').value.trim(),
    section:       document.getElementById('cls-section').value.trim(),
    teacherEmail:  document.getElementById('cls-teacher-email').value,
    studentEmails: chosenStudents
  };
  if (!data.name || !data.teacherEmail) return toast('Nama kelas dan guru wajib diisi!', 'error');
  btn.disabled = true; btn.innerHTML = '<div class="spinner spin-sm"></div> Memproses...';
  try {
    const r = await fetch('/api/classroom/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast('Kelas berhasil dibuat!', 'success');
    clearCourseForm();
    loadCourses();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled  = false;
  btn.innerHTML = '🚀 Buat Kelas';
}

function confirmDeleteCourse(id, name) {
  document.getElementById('confirm-title').textContent = 'Hapus Kelas';
  document.getElementById('confirm-msg').innerHTML = `Yakin hapus kelas:<br><br><strong>${esc(name)}</strong><br><br>
    Kelas akan di-archive lalu dihapus dari Classroom.<br>
    <span style="color:var(--amber)">📁 Folder Drive kelas akan dipindahkan ke Trash (bisa dipulihkan 30 hari).</span>`;
  document.getElementById('confirm-ok').textContent = 'Hapus';
  document.getElementById('confirm-ok').onclick     = () => deleteCourse(id);
  document.getElementById('modal-confirm').classList.add('open');
}

async function deleteCourse(id) {
  closeModal('modal-confirm');
  try {
    const r = await fetch(`/api/classroom/courses/${id}`, { method: 'DELETE' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast(j.message || 'Kelas berhasil dihapus.', 'success');
    loadCourses();
    closeStudents();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

// ── Students ──────────────────────────────────────────────────────────────────

async function loadStudents(courseId, courseName) {
  currentCourseId = courseId;
  document.getElementById('students-course-name').textContent = courseName;
  document.getElementById('students-panel').style.display     = 'block';
  document.getElementById('students-tbody').innerHTML = `<tr><td colspan="3"><div class="spinner-wrap"><div class="spinner"></div></div></td></tr>`;
  try {
    const r        = await fetch(`/api/classroom/courses/${courseId}/students`);
    const j        = await r.json();
    if (!j.success) throw new Error(j.error);
    const students = j.data;
    document.getElementById('students-count').textContent = `${students.length} siswa terdaftar`;
    document.getElementById('students-tbody').innerHTML = students.length
      ? students.map(s => `
          <tr>
            <td><div class="user-name">${esc(s.name)}</div></td>
            <td><span class="ou-path">${esc(s.email)}</span></td>
            <td style="text-align:center">
              <button class="btn btn-danger" style="padding:4px 10px;font-size:12px" onclick="removeStudentFromCourse('${esc(courseId)}','${esc(s.userId)}','${esc(s.name)}')">✕ Keluarkan</button>
            </td>
          </tr>`).join('')
      : '<tr><td colspan="3" class="state-box"><div class="state-title">Belum ada siswa</div></td></tr>';
  } catch(e) { toast('Gagal memuat siswa: ' + e.message, 'error'); }
}

async function removeStudentFromCourse(courseId, userId, name) {
  if (!confirm(`Keluarkan ${name} dari kelas ini?`)) return;
  try {
    const r = await fetch(`/api/classroom/courses/${courseId}/students/${encodeURIComponent(userId)}`, { method: 'DELETE' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast(`${name} berhasil dikeluarkan.`, 'success');
    loadStudents(courseId, document.getElementById('students-course-name').textContent);
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

function closeStudents() {
  document.getElementById('students-panel').style.display = 'none';
  currentCourseId = null;
}

function toggleAddStudent() {
  const form   = document.getElementById('add-student-form');
  const isOpen = form.style.display !== 'none';
  if (isOpen) {
    form.style.display = 'none';
    addStudentSelected = {};
    document.getElementById('add-student-tags').innerHTML    = '';
    document.getElementById('add-student-search').value      = '';
    document.getElementById('add-student-suggest').classList.remove('open');
    document.getElementById('add-student-actions').style.display = 'none';
  } else {
    form.style.display = 'block';
    document.getElementById('add-student-search').focus();
  }
}

function removeAddStudent(email, el) {
  delete addStudentSelected[email];
  el.remove();
  document.getElementById('add-student-actions').style.display = Object.keys(addStudentSelected).length ? 'block' : 'none';
}

async function submitAddStudents() {
  if (!currentCourseId) return;
  const emails = Object.keys(addStudentSelected);
  if (!emails.length) return toast('Pilih siswa dulu!', 'error');
  const btn   = document.getElementById('add-student-submit-btn');
  btn.disabled = true; btn.innerHTML = `<div class="spinner spin-sm"></div> Menambahkan ${emails.length} siswa...`;
  const failed = [];
  for (const email of emails) {
    try {
      const r = await fetch(`/api/classroom/courses/${currentCourseId}/students`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentEmail: email }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Gagal');
    } catch(e) { failed.push({ email, error: e.message }); }
  }
  btn.disabled  = false;
  btn.innerHTML = '➕ Tambahkan ke Kelas';
  if (!failed.length) {
    toast(`✅ ${emails.length} siswa berhasil ditambahkan!`, 'success');
  } else {
    toast(`${emails.length - failed.length} berhasil, ${failed.length} gagal.`, 'warning');
  }
  toggleAddStudent();
  loadStudents(currentCourseId, document.getElementById('students-course-name').textContent);
}

// ── EDIT KELAS ────────────────────────────────────────────────────────────────

function openEditCourse(id, name, section, state) {
  document.getElementById('edit-course-id').value      = id;
  document.getElementById('edit-course-name').value    = name;
  document.getElementById('edit-course-section').value = section === '-' ? '' : section;
  document.getElementById('edit-course-state').value   = state;
  document.getElementById('modal-edit-course').classList.add('open');
}

async function saveEditCourse() {
  const btn   = document.getElementById('edit-course-submit');
  const id    = document.getElementById('edit-course-id').value;
  const body  = {
    name:        document.getElementById('edit-course-name').value.trim(),
    section:     document.getElementById('edit-course-section').value.trim(),
    courseState: document.getElementById('edit-course-state').value,
  };
  if (!body.name) return toast('Nama kelas tidak boleh kosong!', 'error');

  btn.disabled = true; btn.innerHTML = '<div class="spinner spin-sm"></div> Menyimpan...';
  try {
    const r = await fetch(`/api/classroom/courses/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast('Kelas berhasil diupdate!', 'success');
    closeModal('modal-edit-course');
    loadCourses();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled = false; btn.innerHTML = '💾 Simpan Perubahan';
}

// ── KELOLA GURU (CO-TEACHER) ──────────────────────────────────────────────────

let currentTeacherCourseId   = null;
let currentTeacherCourseName = '';

async function loadTeachers(courseId, courseName) {
  currentTeacherCourseId   = courseId;
  currentTeacherCourseName = courseName;
  document.getElementById('teacher-course-name').textContent = courseName;
  document.getElementById('teachers-tbody').innerHTML = `<tr><td colspan="3"><div class="spinner-wrap"><div class="spinner"></div></div></td></tr>`;
  document.getElementById('modal-teachers').classList.add('open');

  try {
    const r = await fetch(`/api/classroom/courses/${courseId}/teachers`);
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    renderTeachers(j.data);
  } catch(e) { toast('Gagal memuat guru: ' + e.message, 'error'); }
}

function renderTeachers(teachers) {
  if (!teachers.length) {
    document.getElementById('teachers-tbody').innerHTML = `<tr><td colspan="3" class="state-box"><div class="state-title">Belum ada guru</div></td></tr>`;
    return;
  }
  document.getElementById('teachers-tbody').innerHTML = teachers.map(t => `
    <tr>
      <td><div class="user-name">${esc(t.name)}</div></td>
      <td><span class="ou-path">${esc(t.email)}</span></td>
      <td style="text-align:center">
        <button class="btn btn-danger" style="padding:4px 10px;font-size:12px"
          onclick="removeTeacherFromCourse('${esc(t.userId)}','${esc(t.name)}')">
          ✕ Keluarkan
        </button>
      </td>
    </tr>`).join('');
}

async function addTeacherToCourse() {
  const email = document.getElementById('add-teacher-email-hidden').value;
  if (!email) return toast('Pilih guru dulu!', 'error');
  const btn   = document.getElementById('add-teacher-submit-btn');
  btn.disabled = true; btn.innerHTML = '<div class="spinner spin-sm"></div>';
  try {
    const r = await fetch(`/api/classroom/courses/${currentTeacherCourseId}/teachers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacherEmail: email })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Gagal');
    toast(`${email} berhasil ditambahkan sebagai guru.`, 'success');
    document.getElementById('add-teacher-search').value = '';
    document.getElementById('add-teacher-email-hidden').value = '';
    document.getElementById('add-teacher-selected').classList.remove('show');
    loadTeachers(currentTeacherCourseId, currentTeacherCourseName);
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled = false; btn.innerHTML = '➕ Tambah';
}

async function removeTeacherFromCourse(userId, name) {
  if (!confirm(`Keluarkan ${name} dari kelas ini?`)) return;
  try {
    const r = await fetch(`/api/classroom/courses/${currentTeacherCourseId}/teachers/${encodeURIComponent(userId)}`, { method: 'DELETE' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast(`${name} berhasil dikeluarkan.`, 'success');
    loadTeachers(currentTeacherCourseId, currentTeacherCourseName);
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

// ── IMPORT SISWA DARI OU ──────────────────────────────────────────────────────

let importOUCourseId   = null;
let importOUCourseName = '';
let importOUPreviewData = [];

function openImportFromOU(courseId, courseName) {
  importOUCourseId   = courseId;
  importOUCourseName = courseName;
  importOUPreviewData = [];
  document.getElementById('import-ou-course-name').textContent = courseName;
  document.getElementById('import-ou-select').value = '';
  document.getElementById('import-ou-preview').innerHTML = '';
  document.getElementById('import-ou-confirm-btn').disabled = true;
  document.getElementById('modal-import-ou').classList.add('open');
  // Isi dropdown OU — fetch otomatis kalau belum dimuat
  populateImportOUDropdown();
}

async function importOUPreview() {
  const ou = document.getElementById('import-ou-select').value;
  if (!ou) return toast('Pilih org unit dulu!', 'error');

  const btn = document.getElementById('import-ou-preview-btn');
  btn.disabled = true; btn.innerHTML = '<div class="spinner spin-sm"></div>';

  try {
    // Kalau allUsers belum dimuat (User Manager belum dibuka), fetch langsung dari API
    if (!allUsers.length) {
      const r = await fetch('/api/users');
      const j = await r.json();
      allUsers = j.users || j || [];
    }

    // Filter user berdasarkan OU yang dipilih
    const users = allUsers.filter(u => u.orgUnitPath === ou && !u.archived && !u.suspended);
    importOUPreviewData = users.map(u => u.primaryEmail);

    const preview = document.getElementById('import-ou-preview');
    if (!users.length) {
      preview.innerHTML = `<div style="padding:12px;color:var(--red);font-size:12px">Tidak ada user aktif di org unit ini.</div>`;
      document.getElementById('import-ou-confirm-btn').disabled = true;
    } else {
      preview.innerHTML = `
        <div style="padding:10px 12px;background:var(--accent-lt);border:1px solid rgba(26,110,250,.2);border-radius:8px;margin-bottom:10px;font-size:12px;color:var(--accent-dk)">
          ✓ <strong>${users.length} siswa</strong> dari <code>${esc(ou)}</code> akan di-enroll ke kelas ini.<br>
          <span style="color:var(--muted)">Siswa yang sudah terdaftar akan di-skip otomatis.</span>
        </div>
        <div style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;font-size:12px">
          ${users.map(u => `
            <div style="display:flex;gap:8px;padding:6px 12px;border-bottom:1px solid var(--border)">
              <span style="font-weight:600;flex:1">${esc(u.name?.fullName || '-')}</span>
              <span style="font-family:var(--mono);color:var(--muted)">${esc(u.primaryEmail)}</span>
            </div>`).join('')}
        </div>`;
      document.getElementById('import-ou-confirm-btn').disabled = false;
    }
  } catch(e) {
    toast('Gagal memuat data user: ' + e.message, 'error');
  }

  btn.disabled = false; btn.innerHTML = '🔍 Preview';
}

async function executeImportFromOU() {
  if (!importOUPreviewData.length) return;
  const btn = document.getElementById('import-ou-confirm-btn');
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner spin-sm"></div> Enrolling ${importOUPreviewData.length} siswa...`;

  try {
    const r = await fetch(`/api/classroom/courses/${importOUCourseId}/import-from-ou`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentEmails: importOUPreviewData })
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);

    const msg = `✅ ${j.totalSuccess} berhasil` +
      (j.totalSkipped ? `, ${j.totalSkipped} sudah terdaftar` : '') +
      (j.totalFailed  ? `, ${j.totalFailed} gagal` : '');
    toast(msg, j.totalFailed ? 'warning' : 'success');
    closeModal('modal-import-ou');
    if (importOUCourseId === currentCourseId) {
      loadStudents(currentCourseId, document.getElementById('students-course-name').textContent);
    }
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled = false;
  btn.innerHTML = '🚀 Import Sekarang';
}

// ── Teacher autocomplete ───────────────────────────────────────────────────────

let teacherSearchTimer = null;

function acSearchTeacher(input) {
  const q   = input.value.trim();
  const box = document.getElementById('add-teacher-suggest');
  if (q.length < 2) { box.classList.remove('open'); return; }
  clearTimeout(teacherSearchTimer);
  box.innerHTML = '<div class="ac-msg">Mencari...</div>';
  box.classList.add('open');
  teacherSearchTimer = setTimeout(async () => {
    const r = await fetch(`/api/classroom/search-users?q=${encodeURIComponent(q)}`);
    const j = await r.json();
    const users = j.data || [];
    if (!users.length) { box.innerHTML = '<div class="ac-msg">Tidak ditemukan</div>'; return; }
    box.innerHTML = users.map(u => `
      <div class="ac-item" onclick="selectTeacherAC('${esc(u.email)}','${esc(u.name)}')">
        <div class="ac-name">${esc(u.name)}</div>
        <div class="ac-email">${esc(u.email)}</div>
      </div>`).join('');
  }, 300);
}

function selectTeacherAC(email, name) {
  document.getElementById('add-teacher-suggest').classList.remove('open');
  document.getElementById('add-teacher-search').value      = name;
  document.getElementById('add-teacher-email-hidden').value = email;
  document.getElementById('add-teacher-text').textContent  = `${name} · ${email}`;
  document.getElementById('add-teacher-selected').classList.add('show');
}

function clearTeacherSearch() {
  document.getElementById('add-teacher-search').value       = '';
  document.getElementById('add-teacher-email-hidden').value = '';
  document.getElementById('add-teacher-selected').classList.remove('show');
  document.getElementById('add-teacher-text').textContent   = '';
}

// Populate import-ou dropdown — fetch dulu kalau allOrgUnits belum dimuat
async function populateImportOUDropdown() {
  const sel = document.getElementById('import-ou-select');
  if (!sel) return;

  // Kalau belum ada data OU, fetch sekarang (tidak perlu buka User Manager dulu)
  if (!allOrgUnits.length) {
    try {
      sel.innerHTML = `<option value="">⏳ Memuat Org Unit...</option>`;
      const r  = await fetch('/api/orgunits');
      const data = await r.json();
      allOrgUnits = data || [];
    } catch(e) {
      sel.innerHTML = `<option value="">❌ Gagal memuat OU</option>`;
      return;
    }
  }

  const sorted = [...allOrgUnits].sort((a, b) => a.orgUnitPath.localeCompare(b.orgUnitPath));
  sel.innerHTML = `<option value="">-- Pilih Org Unit --</option>` +
    sorted.map(o => `<option value="${esc(o.orgUnitPath)}">${esc(o.orgUnitPath)}</option>`).join('');
}