// ── IMPORT SOAL DARI JSON MCP → GOOGLE FORMS ──────────────────────────────────

let importSoalData = null; // parsed JSON preview dari server

function openImportSoal() {
  resetImportSoal();
  // Isi dropdown kelas dari allCourses
  const sel = document.getElementById('soal-course-id');
  sel.innerHTML = `<option value="">-- Tidak dilampirkan (hanya buat Form) --</option>` +
    (allCourses || [])
      .filter(c => c.state === 'ACTIVE')
      .map(c => `<option value="${esc(c.id)}">${esc(c.name)}${c.section && c.section !== '-' ? ' — ' + esc(c.section) : ''}</option>`)
      .join('');

  document.getElementById('modal-import-soal').classList.add('open');
}

function loadSoalFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('soal-json-text').value = e.target.result;
  };
  reader.readAsText(file);
}

async function previewSoal() {
  const text = document.getElementById('soal-json-text').value.trim();
  if (!text) return toast('Paste JSON atau upload file dulu!', 'error');

  let json;
  try { json = JSON.parse(text); } catch(e) { return toast('JSON tidak valid: ' + e.message, 'error'); }

  try {
    const r = await fetch('/api/forms/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);

    importSoalData = { json: json, preview: j.preview };  // json sudah object dari JSON.parse
    renderSoalPreview(j.preview);

    document.getElementById('import-step-1').style.display = 'none';
    document.getElementById('import-step-2').style.display = 'block';
    document.getElementById('import-step-3').style.display = 'none';
  } catch(e) { toast('Gagal preview: ' + e.message, 'error'); }
}

function renderSoalPreview(p) {
  // Meta box
  document.getElementById('soal-meta-box').innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:16px">
      <div><span style="color:var(--muted)">Mapel:</span> <strong>${esc(p.mapel || '-')}</strong></div>
      <div><span style="color:var(--muted)">Kelas:</span> <strong>${esc(p.kelas || '-')}</strong></div>
      <div><span style="color:var(--muted)">Semester:</span> <strong>${esc(p.semester || '-')}</strong></div>
      <div><span style="color:var(--muted)">TA:</span> <strong>${esc(p.tahunAjaran || '-')}</strong></div>
      <div><span style="color:var(--muted)">Waktu:</span> <strong>${esc(p.waktu || '-')}</strong></div>
      <div><span style="color:var(--muted)">Pembuat:</span> <strong>${esc(p.pembuat || '-')}</strong></div>
    </div>
    <div style="margin-top:10px;display:flex;gap:20px;font-size:13px">
      <span>📝 Total: <strong>${p.totalSoal} soal</strong></span>
      <span style="color:var(--accent)">PG: <strong>${p.totalPG}</strong></span>
      <span style="color:var(--amber)">Essay: <strong>${p.totalEssay}</strong></span>
      <span style="color:var(--green)">Total bobot: <strong>${p.totalBobot}</strong></span>
    </div>`;

  // Tabel soal
  const typeBadge = {
    PG: `<span class="badge badge-active"><span class="badge-dot"></span>PG</span>`,
    ES: `<span class="badge badge-archived"><span class="badge-dot"></span>Essay</span>`,
  };
  document.getElementById('soal-preview-tbody').innerHTML = p.soal.map(s => `
    <tr>
      <td style="padding:7px 12px;font-size:12px;font-weight:700;text-align:center">${s.no}</td>
      <td style="padding:7px 12px">${typeBadge[s.tipe] || s.tipe}</td>
      <td style="padding:7px 12px;font-size:12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.soal)}">${esc(s.soal)}</td>
      <td style="padding:7px 12px;text-align:center;font-weight:600;color:var(--green)">${s.bobot}</td>
      <td style="padding:7px 12px;text-align:center;font-family:var(--mono);font-size:12px;font-weight:700;color:var(--accent)">${s.kunci || '-'}</td>
    </tr>`).join('');
}

function toggleSoalSchedule() {
  const state = document.getElementById('soal-state').value;
  document.getElementById('soal-schedule-wrap').style.display =
    state === 'SCHEDULED' ? 'block' : 'none';
}

async function submitImportSoal() {
  if (!importSoalData) return toast('Preview soal dulu!', 'error');

  const btn           = document.getElementById('soal-submit-btn');
  const courseId      = document.getElementById('soal-course-id').value;
  const state         = document.getElementById('soal-state').value;
  const scheduledTime = document.getElementById('soal-scheduled-time').value;
  const dueDate       = document.getElementById('soal-due-date').value;
  const dueTime       = document.getElementById('soal-due-time').value;

  if (state === 'SCHEDULED' && !scheduledTime) {
    return toast('Isi waktu rilis untuk tugas terjadwal!', 'error');
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner spin-sm"></div> Membuat Google Form...';

  try {
    const r = await fetch('/api/forms/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        json:           importSoalData.json,
        courseId:       courseId || null,
        state:          state || 'PUBLISHED',
        scheduledTime:  state === 'SCHEDULED' && scheduledTime
                          ? new Date(scheduledTime).toISOString()
                          : null,
        dueDate:        dueDate || null,
        dueTime:        dueTime || null,
      }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || j.error);

    // Tampilkan hasil
    document.getElementById('import-step-2').style.display = 'none';
    document.getElementById('import-step-3').style.display = 'block';
    document.getElementById('soal-result-box').innerHTML = `
      <div style="text-align:center;padding:20px 0">
        <div style="font-size:36px;margin-bottom:12px">✅</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px">Google Form berhasil dibuat!</div>
        <div style="font-size:12.5px;color:var(--muted);margin-bottom:20px">
          ${j.totalSoal} soal · Owner: ${esc(j.ownerEmail)}<br>
          ${j.courseWorkId
            ? j.isScheduled
              ? `⏰ Dijadwalkan rilis: <strong>${new Date(j.scheduledTime).toLocaleString('id-ID')}</strong>`
              : '✅ Sudah dipublikasikan ke kelas'
            : 'Form tersimpan di Drive (belum dilampirkan ke kelas)'}
        </div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <a href="${esc(j.formUrl)}" target="_blank" class="btn btn-primary">
            ✏️ Edit Form
          </a>
          <a href="${esc(j.viewUrl)}" target="_blank" class="btn btn-ghost">
            👁 Preview Form
          </a>
          ${courseId ? `<button class="btn btn-ghost" onclick="loadCoursework('${esc(courseId)}',''); closeModal('modal-import-soal')">📝 Lihat di Tugas</button>` : ''}
        </div>
      </div>`;

    toast(`✅ Google Form berhasil dibuat! ${j.courseWorkId ? 'Sudah dilampirkan ke kelas.' : ''}`, 'success');

    // Hook ke CBT Manager kalau deploy dari CBT
    if (typeof onCBTFormDeployed === 'function' && window._cbtDeploySessionId) {
      await onCBTFormDeployed(j.formUrl, j.formId);
    }

    // Refresh coursework kalau ada courseId
    if (courseId && cwCourseId === courseId) {
      loadCoursework(courseId, cwCourseName);
    }
  } catch(e) {
    toast('Gagal: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '🚀 Buat Google Form';
  }
}

function resetImportSoal() {
  importSoalData = null;
  document.getElementById('soal-json-text').value = '';
  if (document.getElementById('soal-file')) document.getElementById('soal-file').value = '';
  document.getElementById('import-step-1').style.display = 'block';
  document.getElementById('import-step-2').style.display = 'none';
  document.getElementById('import-step-3').style.display = 'none';
  if (document.getElementById('soal-state'))          document.getElementById('soal-state').value = 'PUBLISHED';
  if (document.getElementById('soal-schedule-wrap'))  document.getElementById('soal-schedule-wrap').style.display = 'none';
  if (document.getElementById('soal-scheduled-time')) document.getElementById('soal-scheduled-time').value = '';
  if (document.getElementById('soal-due-date'))       document.getElementById('soal-due-date').value = '';
  const btn = document.getElementById('soal-submit-btn');
  if (btn) { btn.disabled = false; btn.innerHTML = '🚀 Buat Google Form'; }
}