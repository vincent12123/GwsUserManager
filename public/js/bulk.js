// ── BULK TAMBAH USER ──────────────────────────────────────────────────────────

function parseBulkText() {
  const text = document.getElementById('bulk-textarea').value.trim();
  if (!text) return [];
  return text.split('\n').map(l => l.trim()).filter(Boolean).map((line, i) => {
    const p = line.split(',').map(s => s.trim());
    return { index: i + 1, firstName: p[0] || '', lastName: p[1] || '', email: p[2] || '', orgUnit: p[3] || '/' };
  }).filter(u => u.firstName && u.email);
}

function previewBulk() {
  const users = parseBulkText();
  const card  = document.getElementById('bulk-preview-card');
  if (!users.length) { toast('Tidak ada data valid untuk dipreview', 'error'); return; }
  document.getElementById('bulk-preview-count').textContent = `${users.length} user akan diimport`;
  document.getElementById('bulk-preview-tbody').innerHTML = users.map(u => `
    <tr>
      <td style="color:var(--muted);font-family:var(--mono);font-size:11px">${u.index}</td>
      <td>${esc(u.firstName)}</td><td>${esc(u.lastName)}</td>
      <td style="font-family:var(--mono);font-size:12px">${esc(u.email)}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--muted)">${esc(u.orgUnit)}</td>
    </tr>`).join('');
  card.style.display = 'block';
  document.getElementById('bulk-result-card').style.display = 'none';
}

async function submitBulk() {
  const users = parseBulkText();
  if (!users.length) return toast('Tidak ada data valid', 'error');
  const password = document.getElementById('bulk-password').value.trim();
  const payload  = users.map(u => ({ ...u, password: password || undefined }));
  const btn      = document.getElementById('bulk-submit-btn');
  btn.disabled   = true;
  btn.innerHTML  = `<div class="spinner spin-sm"></div> Mengimport ${users.length} user...`;
  try {
    const r = await fetch('/api/users/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ users: payload }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Gagal import');
    document.getElementById('res-total').textContent   = j.totalSuccess + j.totalFailed;
    document.getElementById('res-success').textContent = j.totalSuccess;
    document.getElementById('res-failed').textContent  = j.totalFailed;
    let html = '';
    if (j.ouCreated?.length) {
      html += `<div style="padding:10px 12px;background:var(--accent-lt);border:1px solid rgba(26,110,250,.2);border-radius:8px;margin-bottom:12px">
        <div style="font-size:11.5px;font-weight:700;color:var(--accent);margin-bottom:6px">🏢 ${j.ouCreated.length} Org Unit baru dibuat otomatis:</div>
        ${j.ouCreated.map(ou => `<div style="font-family:var(--mono);font-size:11px;color:var(--accent-dk);padding:2px 0">✓ ${esc(ou)}</div>`).join('')}
      </div>`;
    }
    if (j.results.failed.length) {
      html += `<div style="font-size:11.5px;font-weight:700;color:var(--red);margin-bottom:8px">Detail Gagal:</div>
        ${j.results.failed.map(f => `<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px"><span style="font-family:var(--mono);color:var(--red)">${esc(f.email)}</span><span style="color:var(--muted);flex:1">${esc(f.error)}</span></div>`).join('')}`;
    }
    document.getElementById('res-failed-list').innerHTML = html;
    document.getElementById('bulk-result-card').style.display  = 'block';
    document.getElementById('bulk-preview-card').style.display = 'none';
    if (j.totalFailed === 0) {
      toast(`✅ Semua ${j.totalSuccess} user berhasil diimport!`, 'success');
      document.getElementById('bulk-textarea').value = '';
    } else {
      toast(`Import selesai: ${j.totalSuccess} berhasil, ${j.totalFailed} gagal`, 'warning');
    }
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
  btn.disabled  = false;
  btn.innerHTML = '🚀 Import Semua';
}

async function uploadCSV() {
  const fileInput = document.getElementById('csv-file');
  const btn       = document.getElementById('csv-btn');
  const resultDiv = document.getElementById('csv-result');
  if (!fileInput.files[0]) return toast('Pilih file CSV terlebih dahulu', 'error');
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  btn.disabled  = true;
  btn.innerHTML = '<div class="spinner spin-sm"></div>';
  try {
    const r = await fetch('/api/users/bulk-csv', { method: 'POST', body: formData });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    resultDiv.innerHTML = `
      <div style="padding:12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;font-size:12.5px;line-height:2">
        📊 Dibaca: <strong>${j.totalParsed}</strong> &nbsp;
        ✅ Berhasil: <strong style="color:var(--green)">${j.totalSuccess}</strong> &nbsp;
        ❌ Gagal: <strong style="color:var(--red)">${j.totalFailed}</strong>
        ${j.results.failed.length ? '<br>' + j.results.failed.map(f => `<span style="font-family:var(--mono);color:var(--red);font-size:11px">✗ ${esc(f.email)}: ${esc(f.error)}</span>`).join('<br>') : ''}
      </div>`;
    toast(`CSV import: ${j.totalSuccess} berhasil, ${j.totalFailed} gagal`, j.totalFailed === 0 ? 'success' : 'warning');
  } catch(e) { toast('Upload gagal: ' + e.message, 'error'); }
  btn.disabled  = false;
  btn.innerHTML = '📤 Upload';
}

function downloadCSVTemplate() {
  const csv = 'firstName,lastName,email,orgUnit,password\nAhmad,Fauzi,ahmad.fauzi,/SMK-Karya-Bangsa/Guru,\nBudi,Hartono,budi.hartono,/SMK-Karya-Bangsa/Siswa,';
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: 'template-user-gws.csv'
  });
  a.click();
}
