// ── AUDIT LOG ─────────────────────────────────────────────────────────────────

let auditOffset = 0;
const AUDIT_LIMIT = 50;
let auditTotal = 0;

async function loadAuditLog() { auditOffset = 0; await fetchAuditLog(); }

async function fetchAuditLog() {
  document.getElementById('audit-tbody').innerHTML = `<tr><td colspan="5"><div class="spinner-wrap"><div class="spinner"></div><span style="color:var(--muted);font-size:13px">Memuat log...</span></div></td></tr>`;
  try {
    const search = document.getElementById('audit-search').value.trim();
    const action = document.getElementById('audit-action-filter').value;
    const status = document.getElementById('audit-status-filter').value;
    const params = new URLSearchParams({
      limit: AUDIT_LIMIT, offset: auditOffset,
      ...(search && { search }),
      ...(action && { action }),
      ...(status && { status }),
    });
    const r = await fetch(`/api/audit?${params}`);
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    auditTotal = j.total;
    renderAuditLog(j.data);
    updateAuditPagination();
  } catch(e) { toast('Gagal memuat audit log: ' + e.message, 'error'); }
}

function filterAudit() { auditOffset = 0; fetchAuditLog(); }
function auditPrev()   { if (auditOffset <= 0) return; auditOffset = Math.max(0, auditOffset - AUDIT_LIMIT); fetchAuditLog(); }
function auditNext()   { if (auditOffset + AUDIT_LIMIT >= auditTotal) return; auditOffset += AUDIT_LIMIT; fetchAuditLog(); }

function updateAuditPagination() {
  const from = auditTotal === 0 ? 0 : auditOffset + 1;
  const to   = Math.min(auditOffset + AUDIT_LIMIT, auditTotal);
  document.getElementById('audit-count-info').textContent =
    auditTotal === 0 ? 'Tidak ada log' : `${from}–${to} dari ${auditTotal} log`;
  document.getElementById('audit-prev-btn').disabled = auditOffset <= 0;
  document.getElementById('audit-next-btn').disabled = auditOffset + AUDIT_LIMIT >= auditTotal;
}

function renderAuditLog(logs) {
  if (!logs.length) {
    document.getElementById('audit-tbody').innerHTML = `<tr><td colspan="5" class="state-box"><div class="state-emoji">📭</div><div class="state-title">Belum ada log</div></td></tr>`;
    return;
  }
  const statusClass = { success: 'badge-active', error: 'badge-suspended', warning: 'badge-archived' };
  const statusLabel = { success: 'Sukses', error: 'Error', warning: 'Warning' };
  const actionColor = {
    'Hapus User':               'var(--red)',
    'Nonaktifkan Guru':         '#7C3AED',
    'Transfer Drive':           'var(--accent)',
    'Ganti Lisensi (Archive)':  'var(--amber)',
    'Ganti Lisensi (Restore)':  'var(--green)',
  };
  document.getElementById('audit-tbody').innerHTML = logs.map(l => `
    <tr>
      <td style="font-size:11px;font-family:var(--mono);white-space:nowrap;color:var(--muted)">${fmtDateTime(l.timestamp)}</td>
      <td><span style="font-size:12.5px;font-weight:600;color:${actionColor[l.action] || 'var(--text)'}">${esc(l.action)}</span></td>
      <td><span style="font-family:var(--mono);font-size:12px">${esc(l.target)}</span></td>
      <td style="font-size:12px;color:var(--muted);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.detail || '')}">${esc(l.detail || '-')}</td>
      <td><span class="badge ${statusClass[l.status] || 'badge-active'}"><span class="badge-dot"></span>${statusLabel[l.status] || l.status}</span></td>
    </tr>`).join('');
}

function confirmClearAudit() {
  document.getElementById('confirm-title').textContent = '🗑 Hapus Log Lama';
  document.getElementById('confirm-msg').innerHTML = `Hapus semua log yang lebih dari <strong>90 hari</strong>?<br><br>Log terbaru tetap disimpan.`;
  document.getElementById('confirm-ok').textContent = 'Ya, Hapus';
  document.getElementById('confirm-ok').onclick     = clearOldAudit;
  document.getElementById('modal-confirm').classList.add('open');
}

async function clearOldAudit() {
  closeModal('modal-confirm');
  try {
    const r = await fetch('/api/audit?days=90', { method: 'DELETE' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    toast(`✅ ${j.deleted} log lama berhasil dihapus.`, 'success');
    loadAuditLog();
  } catch(e) { toast('Gagal: ' + e.message, 'error'); }
}
