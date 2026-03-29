// ── 4B: ANNOUNCEMENTS ─────────────────────────────────────────────────────────

let annCourseId = null, annCourseName = '';

async function loadAnnouncements(courseId, courseName) {
  annCourseId   = courseId;
  annCourseName = courseName;
  document.getElementById('ann-course-name').textContent = courseName;
  document.getElementById('announcements-panel').style.display = 'block';
  document.getElementById('coursework-panel').style.display    = 'none';
  document.getElementById('students-panel').style.display      = 'none';
  document.getElementById('ann-tbody').innerHTML = `<tr><td colspan="4"><div class="spinner-wrap"><div class="spinner"></div></div></td></tr>`;

  try {
    const r = await fetch(`/api/classroom/courses/${courseId}/announcements`);
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    const anns = j.data;
    document.getElementById('ann-count').textContent = `${anns.length} pengumuman`;
    document.getElementById('ann-tbody').innerHTML = anns.length
      ? anns.map(a => `
          <tr>
            <td style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(a.text || '')}">
              ${esc((a.text || '').substring(0, 80))}${(a.text || '').length > 80 ? '...' : ''}
            </td>
            <td>
              <span class="badge ${a.state === 'PUBLISHED' ? 'badge-active' : a.state === 'DRAFT' ? 'badge-archived' : 'badge-suspended'}">
                <span class="badge-dot"></span>${a.state === 'PUBLISHED' ? 'Terkirim' : a.state === 'DRAFT' ? 'Draft' : 'Terjadwal'}
              </span>
            </td>
            <td style="font-size:11px;color:var(--muted);font-family:var(--mono)">${fmtDate(a.updateTime)}</td>
            <td style="text-align:center">
              <button class="btn btn-danger" style="padding:4px 10px;font-size:12px"
                onclick="deleteAnnouncement('${esc(courseId)}','${esc(a.id)}')">✕ Hapus</button>
            </td>
          </tr>`).join('')
      : '<tr><td colspan="4" class="state-box"><div class="state-title">Belum ada pengumuman</div></td></tr>';
  } catch(e) { toast('Gagal memuat pengumuman: ' + e.message, 'error'); }
}

function closeAnnouncements() {
  document.getElementById('announcements-panel').style.display = 'none';
  annCourseId = null;
}

function openNewAnnouncement() {
  document.getElementById('ann-modal-course-name').textContent = annCourseName;
  document.getElementById('ann-text').value         = '';
  document.getElementById('ann-state').value        = 'PUBLISHED';
  document.getElementById('ann-schedule-wrap').style.display = 'none';
  document.getElementById('modal-new-announcement').classList.add('open');
}

document.addEventListener('change', e => {
  if (e.target.id === 'ann-state') {
    document.getElementById('ann-schedule-wrap').style.display = e.target.value === 'SCHEDULED' ? 'block' : 'none';
  }
  if (e.target.id === 'bc-state') {
    document.getElementById('bc-schedule-wrap').style.display = e.target.value === 'SCHEDULED' ? 'block' : 'none';
  }
});

async function submitAnnouncement() {
  const btn  = document.getElementById('ann-submit-btn');
  const text  = document.getElementById('ann-text').value.trim();
  const state = document.getElementById('ann-state').value;
  const schedTime = document.getElementById('ann-schedule-time').value;
  if (!text) return toast('Teks pengumuman tidak boleh kosong!', 'error');

  btn.disabled = true; btn.innerHTML = '<div class="spinner spin-sm"></div> Mengirim...';
  try {
    const body = { text, state };
    if (state === 'SCHEDULED' && schedTime) {
      body.scheduledTime = new Date(schedTime).toISOString();
    }
    const r = await fetch(`/api/classroom/courses/${annCourseId}/announcements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast('Pengumuman berhasil dikirim!', 'success');
    closeModal('modal-new-announcement');
    loadAnnouncements(annCourseId, annCourseName);
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled = false; btn.innerHTML = '📢 Kirim';
}

async function deleteAnnouncement(courseId, annId) {
  if (!confirm('Hapus pengumuman ini?')) return;
  try {
    const r = await fetch(`/api/classroom/courses/${courseId}/announcements/${annId}`, { method: 'DELETE' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast('Pengumuman dihapus.', 'success');
    loadAnnouncements(courseId, annCourseName);
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

// ── BROADCAST ─────────────────────────────────────────────────────────────────

function openBroadcast() {
  if (!allCourses.length) return toast('Muat data kelas dulu (klik Refresh)', 'error');
  document.getElementById('bc-text').value  = '';
  document.getElementById('bc-state').value = 'PUBLISHED';
  document.getElementById('bc-schedule-wrap').style.display = 'none';

  // Render daftar kelas dengan checkbox
  document.getElementById('bc-course-list').innerHTML = allCourses
    .filter(c => c.state === 'ACTIVE')
    .map(c => `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12.5px">
        <input type="checkbox" class="bc-course-cb" value="${esc(c.id)}" onchange="bcUpdateCount()">
        <span style="font-weight:600;flex:1">${esc(c.name)}</span>
        <span style="color:var(--muted);font-family:var(--mono);font-size:11px">${esc(c.email)}</span>
      </label>`).join('');
  bcUpdateCount();
  document.getElementById('modal-broadcast').classList.add('open');
}

function bcSelectAll() {
  document.querySelectorAll('.bc-course-cb').forEach(cb => cb.checked = true);
  bcUpdateCount();
}
function bcClearAll() {
  document.querySelectorAll('.bc-course-cb').forEach(cb => cb.checked = false);
  bcUpdateCount();
}
function bcUpdateCount() {
  const count = document.querySelectorAll('.bc-course-cb:checked').length;
  document.getElementById('bc-selected-count').textContent = `${count} kelas dipilih`;
}

async function submitBroadcast() {
  const btn       = document.getElementById('bc-submit-btn');
  const text      = document.getElementById('bc-text').value.trim();
  const state     = document.getElementById('bc-state').value;
  const schedTime = document.getElementById('bc-schedule-time').value;
  const courseIds = [...document.querySelectorAll('.bc-course-cb:checked')].map(cb => cb.value);

  if (!text)            return toast('Teks pengumuman tidak boleh kosong!', 'error');
  if (!courseIds.length) return toast('Pilih minimal 1 kelas!', 'error');

  btn.disabled = true; btn.innerHTML = `<div class="spinner spin-sm"></div> Mengirim ke ${courseIds.length} kelas...`;
  try {
    const body = { text, courseIds, state };
    if (state === 'SCHEDULED' && schedTime) body.scheduledTime = new Date(schedTime).toISOString();

    const r = await fetch('/api/classroom/announcements/broadcast', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);

    const msg = `✅ ${j.totalSuccess} kelas berhasil` + (j.totalFailed ? `, ${j.totalFailed} gagal` : '');
    toast(msg, j.totalFailed ? 'warning' : 'success');
    closeModal('modal-broadcast');
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled = false; btn.innerHTML = '📡 Broadcast';
}

// ── COURSEWORK ────────────────────────────────────────────────────────────────

let cwCourseId = null, cwCourseName = '';

async function loadCoursework(courseId, courseName) {
  cwCourseId   = courseId;
  cwCourseName = courseName;
  document.getElementById('cw-course-name').textContent   = courseName;
  document.getElementById('coursework-panel').style.display    = 'block';
  document.getElementById('announcements-panel').style.display = 'none';
  document.getElementById('students-panel').style.display      = 'none';

  // Tampilkan tombol Topik di toolbar, simpan courseId aktif
  const btnTopics = document.getElementById('btn-topics');
  if (btnTopics) { btnTopics.style.display = ''; btnTopics.dataset.courseId = courseId; btnTopics.dataset.courseName = courseName; }

  document.getElementById('cw-tbody').innerHTML = `<tr><td colspan="5"><div class="spinner-wrap"><div class="spinner"></div></div></td></tr>`;

  // Load topics dulu untuk dropdown di modal buat tugas
  await loadTopicsForDropdown(courseId);

  try {
    const r = await fetch(`/api/classroom/courses/${courseId}/coursework`);
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    const works = j.data;
    document.getElementById('cw-count').textContent = `${works.length} tugas`;

    const typeLabel = { ASSIGNMENT: 'Tugas', SHORT_ANSWER_QUESTION: 'Jawaban Singkat', MULTIPLE_CHOICE_QUESTION: 'Pilihan Ganda' };

    document.getElementById('cw-tbody').innerHTML = works.length
      ? works.map(w => {
          const due = w.dueDate
            ? `${w.dueDate.day}/${w.dueDate.month}/${w.dueDate.year}`
            : '-';
          return `<tr>
            <td><div class="user-name">${esc(w.title)}</div>
              ${w.state === 'DRAFT' ? '<span class="badge badge-archived" style="margin-top:4px"><span class="badge-dot"></span>Draft</span>' : ''}
              ${w.topicId ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">🏷️ <span class="topic-label-${esc(w.topicId)}">-</span></div>` : ''}
            </td>
            <td style="font-size:12px">${typeLabel[w.workType] || w.workType}</td>
            <td style="font-size:12px;font-family:var(--mono)">${due}</td>
            <td style="font-size:12px">${w.maxPoints ?? '-'}</td>
            <td style="text-align:center">
              <div style="display:flex;gap:6px;justify-content:center">
                <button class="btn-icon" title="Lihat submissions" onclick="openSubmissions('${esc(courseId)}','${esc(w.id)}','${esc(w.title)}',${w.maxPoints||100})">📋</button>
                <button class="btn-icon" title="Export nilai" onclick="openGradesView('${esc(courseId)}','${esc(w.id)}','${esc(w.title)}')">📊</button>
                <button class="btn-icon danger" title="Hapus tugas" onclick="deleteCoursework('${esc(courseId)}','${esc(w.id)}')">🗑</button>
              </div>
            </td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="5" class="state-box"><div class="state-title">Belum ada tugas</div></td></tr>';

    // Render nama topik di label
    renderTopicLabels();
  } catch(e) { toast('Gagal memuat tugas: ' + e.message, 'error'); }
}

function closeCoursework() {
  document.getElementById('coursework-panel').style.display = 'none';
  cwCourseId = null;
}

function openNewCoursework() {
  document.getElementById('cw-modal-course-name').textContent = cwCourseName;
  ['cw-title', 'cw-desc', 'cw-drive-id'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('cw-maxpoints').value = '100';
  document.getElementById('cw-type').value      = 'ASSIGNMENT';
  document.getElementById('cw-state').value     = 'PUBLISHED';
  document.getElementById('cw-due-date').value  = '';
  document.getElementById('cw-due-time').value  = '23:59';
  document.getElementById('cw-drive-wrap').style.display   = 'block';
  document.getElementById('cw-choices-wrap').style.display = 'none';
  // Reset choices ke 2 pilihan kosong
  document.getElementById('cw-choices-list').innerHTML = `
    <div class="cw-choice-row" style="display:flex;gap:8px;margin-bottom:6px">
      <input type="text" class="field-input cw-choice-input" placeholder="Pilihan A...">
      <button onclick="removeCWChoice(this)" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:18px;padding:0 4px">×</button>
    </div>
    <div class="cw-choice-row" style="display:flex;gap:8px;margin-bottom:6px">
      <input type="text" class="field-input cw-choice-input" placeholder="Pilihan B...">
      <button onclick="removeCWChoice(this)" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:18px;padding:0 4px">×</button>
    </div>`;
  document.getElementById('modal-new-coursework').classList.add('open');
}

function toggleQuizFields() {
  const type = document.getElementById('cw-type').value;
  document.getElementById('cw-drive-wrap').style.display   = type === 'ASSIGNMENT' ? 'block' : 'none';
  document.getElementById('cw-choices-wrap').style.display = type === 'MULTIPLE_CHOICE_QUESTION' ? 'block' : 'none';
}

function addCWChoice() {
  const row = document.createElement('div');
  row.className = 'cw-choice-row';
  row.style.cssText = 'display:flex;gap:8px;margin-bottom:6px';
  const idx = document.querySelectorAll('.cw-choice-input').length;
  const labels = ['A','B','C','D','E','F'];
  row.innerHTML = `
    <input type="text" class="field-input cw-choice-input" placeholder="Pilihan ${labels[idx] || (idx+1)}...">
    <button onclick="removeCWChoice(this)" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:18px;padding:0 4px">×</button>`;
  document.getElementById('cw-choices-list').appendChild(row);
}

function removeCWChoice(btn) {
  const rows = document.querySelectorAll('.cw-choice-row');
  if (rows.length <= 2) return toast('Minimal harus ada 2 pilihan!', 'error');
  btn.parentElement.remove();
}

async function submitCoursework() {
  const btn  = document.getElementById('cw-submit-btn');
  const type = document.getElementById('cw-type').value;

  // Kumpulkan choices untuk pilihan ganda
  const choices = [...document.querySelectorAll('.cw-choice-input')]
    .map(i => i.value.trim()).filter(Boolean);

  if (type === 'MULTIPLE_CHOICE_QUESTION' && choices.length < 2) {
    return toast('Isi minimal 2 pilihan jawaban!', 'error');
  }

  const body = {
    title:       document.getElementById('cw-title').value.trim(),
    description: document.getElementById('cw-desc').value.trim(),
    workType:    type,
    maxPoints:   parseInt(document.getElementById('cw-maxpoints').value) || 100,
    state:       document.getElementById('cw-state').value,
    dueDate:     document.getElementById('cw-due-date').value || null,
    dueTime:     document.getElementById('cw-due-time').value || '23:59',
    driveFileId: document.getElementById('cw-drive-id').value.trim() || null,
    topicId:     document.getElementById('cw-topic').value || null,
    choices,
  };
  if (!body.title) return toast('Judul tugas tidak boleh kosong!', 'error');

  btn.disabled = true; btn.innerHTML = '<div class="spinner spin-sm"></div> Membuat...';
  try {
    const r = await fetch(`/api/classroom/courses/${cwCourseId}/coursework`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast('Tugas berhasil dibuat!', 'success');
    closeModal('modal-new-coursework');
    loadCoursework(cwCourseId, cwCourseName);
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled = false; btn.innerHTML = '📝 Buat Tugas';
}

async function deleteCoursework(courseId, workId) {
  if (!confirm('Hapus tugas ini? Semua pengumpulan siswa juga akan terhapus.')) return;
  try {
    const r = await fetch(`/api/classroom/courses/${courseId}/coursework/${workId}`, { method: 'DELETE' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast('Tugas dihapus.', 'success');
    loadCoursework(courseId, cwCourseName);
  } catch(e) { toast(e.message, 'error'); }
}

// ── GRADES ────────────────────────────────────────────────────────────────────

async function openGradesView(courseId, workId, workTitle) {
  if (!confirm(`Export rekap nilai semua tugas di kelas ini ke Google Sheets?\n\nJika sudah pernah diexport, file lama akan diperbarui (bukan dibuat baru).`)) return;
  toast('Mengambil data nilai...', '');
  try {
    const r = await fetch(`/api/classroom/courses/${courseId}/grades/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    const msg = j.isNew
      ? `✅ Spreadsheet baru dibuat! ${j.totalStudents} siswa × ${j.totalWorks} tugas`
      : `✅ Spreadsheet diperbarui! ${j.totalStudents} siswa × ${j.totalWorks} tugas`;
    toast(msg, 'success');
    window.open(j.url, '_blank');
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

// ── SUBMISSIONS ───────────────────────────────────────────────────────────────

let currentSubCourseId = null, currentSubWorkId = null, currentSubMaxPoints = 100;

async function openSubmissions(courseId, workId, workTitle, maxPoints) {
  currentSubCourseId  = courseId;
  currentSubWorkId    = workId;
  currentSubMaxPoints = maxPoints;
  document.getElementById('sub-work-title').textContent = workTitle;
  document.getElementById('sub-stats').textContent      = 'Memuat...';
  document.getElementById('sub-tbody').innerHTML = `<tr><td colspan="5"><div class="spinner-wrap"><div class="spinner"></div></div></td></tr>`;
  document.getElementById('modal-submissions').classList.add('open');

  try {
    const r = await fetch(`/api/classroom/courses/${courseId}/coursework/${workId}/submissions`);
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    renderSubmissions(j.data, maxPoints);
  } catch(e) { toast('Gagal memuat submissions: ' + e.message, 'error'); }
}

function renderSubmissions(subs, maxPoints) {
  const total      = subs.length;
  const turnedIn   = subs.filter(s => s.state === 'TURNED_IN' || s.state === 'RETURNED').length;
  const graded     = subs.filter(s => s.assignedGrade !== null).length;
  const notYet     = total - turnedIn;

  document.getElementById('sub-stats').innerHTML =
    `Total: <strong>${total}</strong> &nbsp;·&nbsp; ` +
    `<span style="color:var(--green)">Sudah kumpul: <strong>${turnedIn}</strong></span> &nbsp;·&nbsp; ` +
    `<span style="color:var(--red)">Belum: <strong>${notYet}</strong></span> &nbsp;·&nbsp; ` +
    `Sudah dinilai: <strong>${graded}</strong>`;

  const stateLabel = { CREATED: 'Belum kumpul', TURNED_IN: 'Sudah kumpul', RETURNED: 'Dikembalikan', RECLAIMED_BY_STUDENT: 'Ditarik siswa' };
  const stateBadge = { CREATED: 'badge-suspended', TURNED_IN: 'badge-active', RETURNED: 'badge-archived', RECLAIMED_BY_STUDENT: 'badge-suspended' };

  // Sort: sudah kumpul dulu, lalu belum
  const sorted = [...subs].sort((a, b) => {
    const order = { TURNED_IN: 0, RETURNED: 1, RECLAIMED_BY_STUDENT: 2, CREATED: 3 };
    return (order[a.state] ?? 9) - (order[b.state] ?? 9);
  });

  document.getElementById('sub-tbody').innerHTML = sorted.length
    ? sorted.map(s => `
        <tr>
          <td>
            <div class="user-name">${esc(s.name)}</div>
            <div class="user-email">${esc(s.email)}</div>
          </td>
          <td style="text-align:center">
            <span class="badge ${stateBadge[s.state] || 'badge-suspended'}">
              <span class="badge-dot"></span>${stateLabel[s.state] || s.state}
            </span>
            ${s.late ? '<div style="font-size:10px;color:var(--red);margin-top:2px">⚠ Terlambat</div>' : ''}
          </td>
          <td style="text-align:center;font-size:12px;color:var(--muted)">${s.late ? '⚠ Ya' : '-'}</td>
          <td style="text-align:center;font-weight:600;font-size:13px">
            ${s.assignedGrade !== null
              ? `<span style="color:var(--green)">${s.assignedGrade}/${maxPoints}</span>`
              : '<span style="color:var(--muted)">-</span>'}
          </td>
          <td style="text-align:center">
            <div style="display:flex;gap:6px;justify-content:center">
              <button class="btn btn-ghost" style="padding:3px 8px;font-size:11px"
                onclick="openGradeInput('${esc(s.id)}','${esc(s.name)}',${s.assignedGrade ?? ''})">
                ✏️ Nilai
              </button>
              ${s.state === 'TURNED_IN' ? `
              <button class="btn btn-ghost" style="padding:3px 8px;font-size:11px"
                onclick="returnSubmission('${esc(s.id)}','${esc(s.name)}')">
                ↩ Return
              </button>` : ''}
            </div>
          </td>
        </tr>`).join('')
    : '<tr><td colspan="5" class="state-box"><div class="state-title">Belum ada submission</div></td></tr>';
}

function openGradeInput(subId, studentName, currentGrade) {
  document.getElementById('grade-sub-id').value       = subId;
  document.getElementById('grade-course-id').value    = currentSubCourseId;
  document.getElementById('grade-work-id').value      = currentSubWorkId;
  document.getElementById('grade-student-name').textContent = studentName;
  document.getElementById('grade-max-label').textContent    = `(maks. ${currentSubMaxPoints})`;
  document.getElementById('grade-value').value        = currentGrade !== undefined ? currentGrade : '';
  document.getElementById('grade-value').max          = currentSubMaxPoints;
  document.getElementById('grade-return').checked     = true;
  document.getElementById('modal-grade-input').classList.add('open');
}

async function submitGrade() {
  const btn        = document.getElementById('grade-submit-btn');
  const subId      = document.getElementById('grade-sub-id').value;
  const courseId   = document.getElementById('grade-course-id').value;
  const workId     = document.getElementById('grade-work-id').value;
  const grade      = document.getElementById('grade-value').value;
  const doReturn   = document.getElementById('grade-return').checked;

  if (grade === '' || grade === null) return toast('Masukkan nilai terlebih dahulu!', 'error');
  if (Number(grade) < 0 || Number(grade) > currentSubMaxPoints) {
    return toast(`Nilai harus antara 0 dan ${currentSubMaxPoints}`, 'error');
  }

  btn.disabled = true; btn.innerHTML = '<div class="spinner spin-sm"></div>';
  try {
    const r = await fetch(`/api/classroom/courses/${courseId}/coursework/${workId}/submissions/${subId}/grade`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedGrade: Number(grade) })
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);

    // Return ke siswa jika dicentang
    if (doReturn) {
      await fetch(`/api/classroom/courses/${courseId}/coursework/${workId}/submissions/${subId}/return`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
      });
    }

    toast(`✅ Nilai ${grade} berhasil disimpan${doReturn ? ' dan dikembalikan ke siswa' : ''}!`, 'success');
    closeModal('modal-grade-input');
    // Refresh submissions panel
    openSubmissions(courseId, workId, document.getElementById('sub-work-title').textContent, currentSubMaxPoints);
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled = false; btn.innerHTML = '💾 Simpan Nilai';
}

async function returnSubmission(subId, name) {
  if (!confirm(`Return submission ${name}? Siswa akan bisa melihat nilai dan feedback.`)) return;
  try {
    const r = await fetch(`/api/classroom/courses/${currentSubCourseId}/coursework/${currentSubWorkId}/submissions/${subId}/return`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast(`${name} berhasil di-return.`, 'success');
    openSubmissions(currentSubCourseId, currentSubWorkId, document.getElementById('sub-work-title').textContent, currentSubMaxPoints);
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

// ── TOPICS ────────────────────────────────────────────────────────────────────

let allTopics = [];

async function loadTopicsForDropdown(courseId) {
  try {
    const r = await fetch(`/api/classroom/courses/${courseId}/topics`);
    const j = await r.json();
    if (!j.success) return;
    allTopics = j.data;

    const sel = document.getElementById('cw-topic');
    if (sel) {
      sel.innerHTML = `<option value="">-- Tanpa Topik --</option>` +
        allTopics.map(t => `<option value="${esc(t.topicId)}">${esc(t.name)}</option>`).join('');
    }
  } catch(_) {}
}

function renderTopicLabels() {
  const map = {};
  allTopics.forEach(t => map[t.topicId] = t.name);
  document.querySelectorAll('[class^="topic-label-"]').forEach(el => {
    const tid = el.className.replace('topic-label-', '');
    el.textContent = map[tid] || '-';
  });
}

function openTopics() {
  const btn = document.getElementById('btn-topics');
  if (!btn || !btn.dataset.courseId) return toast('Buka panel Tugas dulu!', 'error');
  document.getElementById('topic-course-name').textContent = btn.dataset.courseName || '-';
  document.getElementById('new-topic-name').value = '';
  document.getElementById('modal-topics').classList.add('open');
  renderTopicList();
}

function renderTopicList() {
  const list = document.getElementById('topics-list');
  if (!allTopics.length) {
    list.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--muted)">Belum ada topik. Tambah topik di atas.</div>';
    return;
  }
  list.innerHTML = allTopics.map(t => `
    <div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--border)">
      <span style="flex:1;font-size:13px" id="topic-name-${esc(t.topicId)}">${esc(t.name)}</span>
      <button class="btn btn-ghost" style="padding:3px 8px;font-size:11px"
        onclick="editTopicInline('${esc(t.topicId)}','${esc(t.name)}')">✏️</button>
      <button class="btn btn-danger" style="padding:3px 8px;font-size:11px"
        onclick="deleteTopic('${esc(t.topicId)}','${esc(t.name)}')">🗑</button>
    </div>`).join('');
}

async function submitTopic() {
  const btn  = document.querySelector('#modal-topics .btn-primary');
  const name = document.getElementById('new-topic-name').value.trim();
  if (!name) return toast('Nama topik tidak boleh kosong!', 'error');
  const courseId = document.getElementById('btn-topics').dataset.courseId;
  btn.disabled = true;
  try {
    const r = await fetch(`/api/classroom/courses/${courseId}/topics`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast('Topik berhasil ditambahkan!', 'success');
    document.getElementById('new-topic-name').value = '';
    await loadTopicsForDropdown(courseId);
    renderTopicList();
    renderTopicLabels();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled = false;
}

function editTopicInline(topicId, currentName) {
  const span = document.getElementById(`topic-name-${topicId}`);
  span.innerHTML = `
    <input type="text" class="field-input" id="edit-topic-${topicId}" value="${esc(currentName)}" style="font-size:12px;padding:4px 8px">
    <button class="btn btn-primary" style="padding:3px 8px;font-size:11px;margin-left:4px"
      onclick="saveTopicEdit('${esc(topicId)}')">✓</button>
    <button class="btn btn-ghost" style="padding:3px 8px;font-size:11px"
      onclick="renderTopicList()">✕</button>`;
}

async function saveTopicEdit(topicId) {
  const name     = document.getElementById(`edit-topic-${topicId}`)?.value.trim();
  const courseId = document.getElementById('btn-topics').dataset.courseId;
  if (!name) return toast('Nama tidak boleh kosong!', 'error');
  try {
    const r = await fetch(`/api/classroom/courses/${courseId}/topics/${topicId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast('Topik diperbarui!', 'success');
    await loadTopicsForDropdown(courseId);
    renderTopicList();
    renderTopicLabels();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}

async function deleteTopic(topicId, name) {
  if (!confirm(`Hapus topik "${name}"?`)) return;
  const courseId = document.getElementById('btn-topics').dataset.courseId;
  try {
    const r = await fetch(`/api/classroom/courses/${courseId}/topics/${topicId}`, { method: 'DELETE' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast('Topik dihapus.', 'success');
    await loadTopicsForDropdown(courseId);
    renderTopicList();
    renderTopicLabels();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}