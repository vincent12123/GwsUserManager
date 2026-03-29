// ── PHASE 3: NONAKTIFKAN GURU ─────────────────────────────────────────────────

let dtTeacherTimer = null, dtTargetTimer = null;

function openDeactivateTeacher() {
  if (!allUsers.length) return toast('Muat data user dulu (klik Refresh)', 'error');
  dtClearTeacher();
  dtClearTarget();
  document.getElementById('dt-transfer-calendar').checked = true;
  document.getElementById('dt-submit-btn').disabled       = true;
  document.getElementById('modal-deactivate-teacher').classList.add('open');
}

function dtTeacherSearch(input) {
  const q   = input.value.toLowerCase().trim();
  const box = document.getElementById('dt-teacher-suggest');
  if (q.length < 2) { box.classList.remove('open'); return; }
  clearTimeout(dtTeacherTimer);
  dtTeacherTimer = setTimeout(() => {
    const filtered = allUsers.filter(u => {
      const name  = (u.name?.fullName || '').toLowerCase();
      const email = (u.primaryEmail || '').toLowerCase();
      return (name.includes(q) || email.includes(q)) && !u.archived;
    }).slice(0, 8);
    if (!filtered.length) { box.innerHTML = '<div class="ac-msg">Tidak ditemukan</div>'; box.classList.add('open'); return; }
    box.innerHTML = filtered.map(u => `
      <div class="ac-item" onclick="dtSelectTeacher('${esc(u.primaryEmail)}','${esc(u.name?.fullName || u.primaryEmail)}','${esc(u.orgUnitPath || '/')}')">
        <div class="ac-name">${esc(u.name?.fullName || '-')}</div>
        <div class="ac-email">${esc(u.primaryEmail)} · <span style="color:var(--muted)">${esc(u.orgUnitPath || '/')}</span></div>
      </div>`).join('');
    box.classList.add('open');
  }, 200);
}

function dtSelectTeacher(email, name, ou) {
  document.getElementById('dt-teacher-suggest').classList.remove('open');
  document.getElementById('dt-teacher-search').value       = name;
  document.getElementById('dt-teacher-email').value        = email;
  document.getElementById('dt-teacher-text').textContent   = `${name} (${email}) · ${ou}`;
  document.getElementById('dt-teacher-selected').classList.add('show');
  dtCheckReady();
}

function dtClearTeacher() {
  document.getElementById('dt-teacher-search').value     = '';
  document.getElementById('dt-teacher-email').value      = '';
  document.getElementById('dt-teacher-selected').classList.remove('show');
  document.getElementById('dt-teacher-text').textContent = '';
  dtCheckReady();
}

function dtTargetSearch(input) {
  const q   = input.value.toLowerCase().trim();
  const box = document.getElementById('dt-target-suggest');
  if (q.length < 2) { box.classList.remove('open'); return; }
  clearTimeout(dtTargetTimer);
  dtTargetTimer = setTimeout(() => {
    const filtered = allUsers.filter(u => {
      const name  = (u.name?.fullName || '').toLowerCase();
      const email = (u.primaryEmail || '').toLowerCase();
      return name.includes(q) || email.includes(q);
    }).slice(0, 8);
    if (!filtered.length) { box.innerHTML = '<div class="ac-msg">Tidak ditemukan</div>'; box.classList.add('open'); return; }
    box.innerHTML = filtered.map(u => `
      <div class="ac-item" onclick="dtSelectTarget('${esc(u.primaryEmail)}','${esc(u.name?.fullName || u.primaryEmail)}')">
        <div class="ac-name">${esc(u.name?.fullName || '-')}</div>
        <div class="ac-email">${esc(u.primaryEmail)}</div>
      </div>`).join('');
    box.classList.add('open');
  }, 200);
}

function dtSelectTarget(email, name) {
  document.getElementById('dt-target-suggest').classList.remove('open');
  document.getElementById('dt-target-search').value     = name;
  document.getElementById('dt-target-email').value      = email;
  document.getElementById('dt-target-text').textContent = `${name} (${email})`;
  document.getElementById('dt-target-selected').classList.add('show');
  dtCheckReady();
}

function dtClearTarget() {
  document.getElementById('dt-target-search').value     = '';
  document.getElementById('dt-target-email').value      = '';
  document.getElementById('dt-target-selected').classList.remove('show');
  document.getElementById('dt-target-text').textContent = '';
  dtCheckReady();
}

function dtCheckReady() {
  const teacher = document.getElementById('dt-teacher-email').value;
  const target  = document.getElementById('dt-target-email').value;
  document.getElementById('dt-submit-btn').disabled = !(teacher && target);
}

function confirmDeactivateTeacher() {
  const teacher     = document.getElementById('dt-teacher-email').value;
  const target      = document.getElementById('dt-target-email').value;
  const teacherName = document.getElementById('dt-teacher-text').textContent;
  const targetName  = document.getElementById('dt-target-text').textContent;
  const withCal     = document.getElementById('dt-transfer-calendar').checked;

  document.getElementById('confirm-title').textContent = '⛔ Konfirmasi Nonaktifkan Guru';
  document.getElementById('confirm-msg').innerHTML = `
    <strong>${esc(teacherName)}</strong> akan diproses:<br><br>
    <span style="display:block;padding:3px 0">1. ⏸ Suspend akun</span>
    <span style="display:block;padding:3px 0">2. 📁 Transfer Drive${withCal ? ' + Calendar' : ''} → <strong>${esc(targetName)}</strong></span>
    <span style="display:block;padding:3px 0">3. 🗃 Archive akun</span>
    <br><span style="color:var(--red);font-size:12px">Proses ini tidak bisa dibatalkan setelah dimulai.</span>`;
  document.getElementById('confirm-ok').textContent = 'Ya, Nonaktifkan';
  document.getElementById('confirm-ok').onclick     = () => executeDeactivateTeacher(teacher, target, withCal);
  closeModal('modal-deactivate-teacher');
  document.getElementById('modal-confirm').classList.add('open');
}

async function executeDeactivateTeacher(teacherEmail, driveTargetEmail, transferCalendar) {
  closeModal('modal-confirm');
  toast('Sedang memproses...', '');
  try {
    const r = await fetch('/api/teachers/deactivate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacherEmail, driveTargetEmail, transferCalendar })
    });
    const j = await r.json();
    const allOk = j.log.every(l => l.status === 'ok');
    document.getElementById('dt-result-title').textContent = allOk ? '✅ Proses Selesai' : '⚠️ Proses Selesai dengan Peringatan';
    document.getElementById('dt-result-body').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px">
        ${j.log.map(l => `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;
            background:${l.status === 'ok' ? 'var(--green-lt)' : 'var(--red-lt)'};
            border:1px solid ${l.status === 'ok' ? 'rgba(14,159,110,.2)' : 'rgba(220,38,38,.2)'};border-radius:8px">
            <span style="font-size:16px">${l.status === 'ok' ? '✅' : '❌'}</span>
            <div>
              <div style="font-weight:600;font-size:13px">${esc(l.step)}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px">${esc(l.msg)}</div>
            </div>
          </div>`).join('')}
        ${j.log.find(l => l.transferId) ? `
          <div style="padding:10px 12px;background:var(--accent-lt);border:1px solid rgba(26,110,250,.2);border-radius:8px;font-size:12px;color:var(--accent-dk)">
            ℹ️ Transfer Drive berjalan di background Google. Bisa memakan waktu beberapa menit sampai jam tergantung jumlah file.
          </div>` : ''}
      </div>`;
    document.getElementById('modal-deactivate-result').classList.add('open');
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}
