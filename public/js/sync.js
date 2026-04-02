// ═══════════════════════════════════════════════════════════════════════════════
// SYNC — Frontend untuk sinkronisasi cache GWS → SQLite
// ═══════════════════════════════════════════════════════════════════════════════

let _syncStatus = null;

async function initSync() {
  await loadSyncStatus();
}

async function loadSyncStatus() {
  try {
    const r = await fetch('/api/sync/status');
    const j = await r.json();
    if (!j.success) return;
    _syncStatus = j.data;
    renderSyncStatus();
  } catch(e) { console.warn('[Sync] Gagal cek status:', e.message); }
}

function renderSyncStatus() {
  const el = document.getElementById('sync-status-bar');
  if (!el || !_syncStatus) return;

  const { totalUsers, totalOUs, lastUserSync, isCacheReady } = _syncStatus;

  function timeAgo(dateStr) {
    if (!dateStr) return 'Belum pernah';
    const diff = Date.now() - new Date(dateStr).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1)   return 'Baru saja';
    if (min < 60)  return `${min} menit lalu`;
    const hr = Math.floor(min / 60);
    if (hr < 24)   return `${hr} jam lalu`;
    return `${Math.floor(hr / 24)} hari lalu`;
  }

  if (isCacheReady) {
    el.innerHTML = `<button class="btn btn-ghost" style="padding:2px 8px;font-size:11px;color:var(--green)"
      onclick="doSync('full')" id="btn-do-sync">🟢 Synced</button>`;
  } else {
    el.innerHTML = `<button class="btn btn-ghost" style="padding:2px 8px;font-size:11px;color:var(--amber)"
      onclick="doSync('full')" id="btn-do-sync">🟡 Sync</button>`;
  }
}

async function doSync(type = 'full') {
  const btn = document.getElementById('btn-do-sync');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spin-sm" style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite"></div>'; }

  const statusBar = document.getElementById('sync-status-bar');
  const statusSpan = statusBar?.querySelector('span');
  if (statusSpan) statusSpan.textContent = '⏳ Sinkronisasi...';

  try {
    const r = await fetch(`/api/sync/${type}`, { method: 'POST' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast(j.message || 'Sync berhasil!', 'success');
    await loadSyncStatus();

    // Reload OU dropdown di classroom kalau sedang dibuka
    if (typeof loadOUSelectForImport === 'function') {
      loadOUSelectForImport();
    }
    // Reload OU list di user manager kalau ada
    if (typeof loadOrgUnits === 'function') {
      loadOrgUnits();
    }
  } catch(e) {
    toast('Sync gagal: ' + e.message, 'error');
    if (statusBar) renderSyncStatus();
  } finally {
    if (btn) { btn.disabled = false; }
    renderSyncStatus();
  }
}

// Sync otomatis saat pertama buka halaman (background, tidak blokir UI)
// Hanya jika cache belum ada atau sudah lebih dari 6 jam
async function autoSyncIfStale() {
  try {
    // Pakai status yang sudah dimuat oleh initSync, atau fetch ulang
    const s = _syncStatus || (await fetch('/api/sync/status').then(r=>r.json()).then(j=>j.data));
    if (!s) return;

    if (!s.isCacheReady) {
      // Cache kosong — sync otomatis
      console.log('[Sync] Cache kosong, auto-sync...');
      doSync('full');
      return;
    }
    if (s.lastUserSync) {
      const ageHours = (Date.now() - new Date(s.lastUserSync).getTime()) / 3600000;
      if (ageHours > 6) {
        // Cache sudah lebih dari 6 jam — sync diam-diam di background
        console.log(`[Sync] Cache stale (${ageHours.toFixed(1)} jam), auto-sync...`);
        fetch('/api/sync/full', { method: 'POST' }).then(() => loadSyncStatus());
      }
    }
  } catch(_) {}
}