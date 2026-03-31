// ═══════════════════════════════════════════════════════════════════════════════
// CBT OFFLINE — IndexedDB + Sync Manager
// FIX v2: tambah cache:'no-store' di semua fetch agar SW tidak cache API calls
// ═══════════════════════════════════════════════════════════════════════════════

const CBTOffline = (() => {

  const DB_NAME    = 'cbt-offline-db';
  const DB_VERSION = 1;
  const STORE_ANS  = 'answers';
  const STORE_Q    = 'sync_queue';

  let _db        = null;
  let _sessionId = null;
  let _userEmail = null;
  let _roomId    = null;
  let _syncItv   = null;
  let _onSyncCallback = null;
  let _onStatusChange = null;
  let _isOnline  = navigator.onLine;

  // ── Inisialisasi DB ─────────────────────────────────────────────────────────
  async function init(sessionId, userEmail, roomId) {
    _sessionId = sessionId;
    _userEmail = userEmail;
    _roomId    = roomId;

    _db = await openDB();

    window.addEventListener('online',  () => { _isOnline = true;  onOnline(); });
    window.addEventListener('offline', () => { _isOnline = false; onOffline(); });

    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'SW_SYNC_TRIGGERED') {
          flushQueue();
        }
      });
    }

    // Auto-sync interval 5 detik
    _syncItv = setInterval(() => {
      if (_isOnline) flushQueue();
    }, 5000);

    console.log('[CBTOffline] Initialized for session:', sessionId);
    return true;
  }

  // ── Buka IndexedDB ──────────────────────────────────────────────────────────
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_ANS)) {
          const ansStore = db.createObjectStore(STORE_ANS, { keyPath: 'key' });
          ansStore.createIndex('sessionId', 'sessionId', { unique: false });
          ansStore.createIndex('synced',    'synced',    { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_Q)) {
          const qStore = db.createObjectStore(STORE_Q, { keyPath: 'id', autoIncrement: true });
          qStore.createIndex('sessionId', 'sessionId', { unique: false });
          qStore.createIndex('synced',    'synced',    { unique: false });
        }
      };

      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ── Simpan jawaban ke IndexedDB ─────────────────────────────────────────────
  async function saveAnswer(nomor, jawaban) {
    if (!_db) return;
    const key  = `${_sessionId}_${_userEmail}_${nomor}`;
    const item = {
      key, sessionId: _sessionId, userEmail: _userEmail,
      nomor, jawaban, synced: false,
      savedAt: new Date().toISOString(),
    };
    return dbPut(STORE_ANS, item);
  }

  // ── Ambil semua jawaban lokal ───────────────────────────────────────────────
  async function getLocalAnswers() {
    if (!_db) return {};
    const all = await dbGetByIndex(STORE_ANS, 'sessionId', _sessionId);
    const map = {};
    all.forEach(item => {
      if (item.userEmail === _userEmail) map[item.nomor] = item.jawaban;
    });
    return map;
  }

  // ── Tandai jawaban sebagai sudah sync ───────────────────────────────────────
  async function markSynced(nomor) {
    if (!_db) return;
    const key  = `${_sessionId}_${_userEmail}_${nomor}`;
    const item = await dbGet(STORE_ANS, key);
    if (item) {
      item.synced   = true;
      item.syncedAt = new Date().toISOString();
      await dbPut(STORE_ANS, item);
    }
  }

  // ── Tambah ke antrian sync ──────────────────────────────────────────────────
  async function enqueue(nomor, jawaban) {
    if (!_db) return;
    const item = {
      sessionId: _sessionId, userEmail: _userEmail,
      roomId: _roomId, nomor, jawaban,
      synced: false, retries: 0,
      savedAt: new Date().toISOString(),
    };
    return dbAdd(STORE_Q, item);
  }

  // ── Kirim antrian ke server ─────────────────────────────────────────────────
  async function flushQueue() {
    if (!_db || !_isOnline || !_sessionId) return;

    const pending = await dbGetByIndex(STORE_Q, 'sessionId', _sessionId);
    const unsent  = pending.filter(i => !i.synced && i.userEmail === _userEmail);

    if (!unsent.length) return;

    console.log('[CBTOffline] Syncing', unsent.length, 'queued answers...');

    let synced = 0;
    for (const item of unsent) {
      try {
        const body = {
          userEmail: item.userEmail,
          nomor:     item.nomor,
          jawaban:   item.jawaban,
          savedAt:   item.savedAt,
        };
        if (item.roomId) body.roomId = item.roomId;

        const r = await fetch(`/api/cbt/sessions/${item.sessionId}/jawaban`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
          signal:  AbortSignal.timeout(8000),
          cache:   'no-store',   // ✅ FIX: jangan cache request API
        });

        // ✅ FIX: hanya tandai synced kalau benar-benar 200/201
        // Sebelumnya r.ok (200-299) termasuk 202 dari SW saat offline
        // Sekarang SW sudah return 503 saat offline, tapi kita tambah guard ini
        if ((r.ok || r.status === 200 || r.status === 201) && r.status !== 503) {
          // Cek apakah response adalah offline fallback dari SW
          let isOfflineFallback = false;
          try {
            const clone = r.clone();
            const j = await clone.json();
            if (j.offline === true) isOfflineFallback = true;
          } catch(_) {}

          if (!isOfflineFallback) {
            item.synced   = true;
            item.syncedAt = new Date().toISOString();
            await dbPut(STORE_Q, item);
            await markSynced(item.nomor);
            synced++;
          } else {
            // SW sedang offline, jangan tandai synced
            console.log('[CBTOffline] SW offline fallback — skip mark synced');
          }
        } else if (r.status === 403) {
          const j = await r.json().catch(() => ({}));
          if (j.submitted) {
            item.synced = true;
            await dbPut(STORE_Q, item);
          }
          break;
        } else {
          // 503, 500, dll — retry nanti
          item.retries = (item.retries || 0) + 1;
          await dbPut(STORE_Q, item);
        }
      } catch (e) {
        console.warn('[CBTOffline] Sync failed for nomor', item.nomor, e.message);
        item.retries = (item.retries || 0) + 1;
        if (_db) await dbPut(STORE_Q, item);
      }
    }

    if (synced > 0 && _onSyncCallback) {
      _onSyncCallback(synced, unsent.length);
    }

    updateSyncStatus();
  }

  // ── Kirim jawaban (dengan fallback ke queue) ────────────────────────────────
  async function sendAnswer(nomor, jawaban) {
    await saveAnswer(nomor, jawaban);

    if (!_isOnline) {
      await enqueue(nomor, jawaban);
      updateSyncStatus();
      return { queued: true };
    }

    try {
      const body = {
        userEmail: _userEmail,
        nomor, jawaban,
        savedAt: new Date().toISOString(),
      };
      if (_roomId) body.roomId = _roomId;

      const r = await fetch(`/api/cbt/sessions/${_sessionId}/jawaban`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(8000),
        cache:   'no-store',   // ✅ FIX: jangan cache
      });

      // ✅ FIX: cek apakah ini offline fallback dari SW
      if (r.ok && r.status !== 503) {
        let isOfflineFallback = false;
        try {
          const j = await r.clone().json();
          if (j.offline === true) isOfflineFallback = true;
        } catch(_) {}

        if (!isOfflineFallback) {
          await markSynced(nomor);
          updateSyncStatus();
          return { synced: true };
        }
      }

      // Gagal / offline fallback — masukkan ke queue
      await enqueue(nomor, jawaban);
      updateSyncStatus();
      return { queued: true };

    } catch {
      await enqueue(nomor, jawaban);
      updateSyncStatus();
      return { queued: true };
    }
  }

  // ── Submit dengan flush antrian dulu ────────────────────────────────────────
  async function submitWithFlush(timeoutMs = 10000) {
    if (!_isOnline) {
      await saveSubmitFlag();
      return { queued: true, offline: true };
    }

    await flushQueue();

    try {
      const r = await fetch(`/api/cbt/sessions/${_sessionId}/submit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userEmail: _userEmail }),
        signal:  AbortSignal.timeout(timeoutMs),
        cache:   'no-store',   // ✅ FIX
      });
      const j = await r.json().catch(() => ({}));
      return { success: r.ok, ...j };
    } catch {
      return { success: false, error: 'Gagal terhubung ke server' };
    }
  }

  // ── Simpan flag submit (untuk offline submit) ────────────────────────────────
  async function saveSubmitFlag() {
    if (!_db) return;
    const item = {
      key:       `submit_${_sessionId}_${_userEmail}`,
      sessionId: _sessionId, userEmail: _userEmail,
      roomId:    _roomId, type: 'submit',
      jawaban:   null, nomor: 0,
      synced:    false, retries: 0,
      savedAt:   new Date().toISOString(),
    };
    await dbPut(STORE_Q, item);
  }

  // ── Hitung jumlah yang belum sync ────────────────────────────────────────────
  async function getPendingCount() {
    if (!_db) return 0;
    const pending = await dbGetByIndex(STORE_Q, 'sessionId', _sessionId);
    return pending.filter(i => !i.synced && i.userEmail === _userEmail).length;
  }

  // ── Update status indicator di UI ───────────────────────────────────────────
  async function updateSyncStatus() {
    if (!_onStatusChange) return;
    const pending = await getPendingCount();
    _onStatusChange({ isOnline: _isOnline, pending });
  }

  // ── Event handlers online/offline ───────────────────────────────────────────
  function onOnline() {
    console.log('[CBTOffline] Back online — flushing queue...');
    updateSyncStatus();

    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then(sw => {
        sw.sync.register('cbt-jawaban-sync').catch(() => flushQueue());
      }).catch(() => flushQueue());
    } else {
      flushQueue();
    }
  }

  function onOffline() {
    console.log('[CBTOffline] Gone offline');
    updateSyncStatus();
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  function destroy() {
    clearInterval(_syncItv);
    if (_db) { _db.close(); _db = null; }
  }

  // ── Hapus data lokal setelah selesai ujian ────────────────────────────────────
  async function clearSession() {
    if (!_db) return;
    const ansTx = _db.transaction(STORE_ANS, 'readwrite');
    const qTx   = _db.transaction(STORE_Q,   'readwrite');
    const all   = await dbGetByIndex(STORE_ANS, 'sessionId', _sessionId);
    for (const item of all) ansTx.objectStore(STORE_ANS).delete(item.key);
    const q = await dbGetByIndex(STORE_Q, 'sessionId', _sessionId);
    for (const item of q) qTx.objectStore(STORE_Q).delete(item.id);
  }

  // ── IndexedDB helpers ────────────────────────────────────────────────────────
  function dbPut(store, item) {
    return new Promise((res, rej) => {
      const tx  = _db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(item);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  }

  function dbAdd(store, item) {
    return new Promise((res, rej) => {
      const tx  = _db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).add(item);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  }

  function dbGet(store, key) {
    return new Promise((res, rej) => {
      const tx  = _db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  }

  function dbGetByIndex(store, indexName, value) {
    return new Promise((res, rej) => {
      const tx    = _db.transaction(store, 'readonly');
      const idx   = tx.objectStore(store).index(indexName);
      const req   = idx.getAll(value);
      req.onsuccess = () => res(req.result || []);
      req.onerror   = () => rej(req.error);
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  return {
    init,
    sendAnswer,
    submitWithFlush,
    getLocalAnswers,
    getPendingCount,
    flushQueue,
    clearSession,
    destroy,
    get isOnline() { return _isOnline; },
    onSync(cb)         { _onSyncCallback = cb; },
    onStatusChange(cb) { _onStatusChange = cb; },
  };

})();