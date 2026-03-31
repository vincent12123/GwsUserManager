// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE WORKER — CBT Siswa PWA
// Cache Strategy + Background Sync
// FIX v2: offline response pakai 503 (bukan 202) agar tidak dianggap sukses
// ═══════════════════════════════════════════════════════════════════════════════

const SW_VERSION   = 'cbt-sw-v2';       // ← naik versi agar SW refresh otomatis
const CACHE_STATIC = 'cbt-static-v2';   // ← naik versi agar cache lama dihapus
const CACHE_SOAL   = 'cbt-soal-v2';
const SYNC_TAG     = 'cbt-jawaban-sync';

const STATIC_ASSETS = [
  '/cbt-siswa.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing', SW_VERSION);
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(STATIC_ASSETS.filter(Boolean)))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Cache install error:', err))
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating', SW_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_SOAL)
          .map(k => { console.log('[SW] Deleting old cache:', k); return caches.delete(k); })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Hanya handle same-origin
  if (url.origin !== self.location.origin) return;

  // ✅ FIX: Semua endpoint /api/ — JANGAN di-cache, pass-through saja
  // Kalau offline, lempar error agar client (cbt-offline.js) bisa handle
  if (url.pathname.startsWith('/api/')) {
    // Khusus POST jawaban: pakai fallback yang benar
    if (url.pathname.includes('/jawaban') && request.method === 'POST') {
      event.respondWith(fetchWithOfflineFallback(request));
      return;
    }
    // API soal: network first, boleh cache sebagai fallback offline
    if (url.pathname.includes('/soal/siswa')) {
      event.respondWith(networkFirstSoal(request));
      return;
    }
    // API lainnya (health, validate-token, submit, dll): pass-through tanpa cache
    return;
  }

  // Static files → Cache First
  if (
    url.pathname === '/cbt-siswa.html' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json' ||
    url.pathname.startsWith('/js/')
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }
});

// ── CACHE FIRST ───────────────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline — file tidak tersedia', { status: 503 });
  }
}

// ── NETWORK FIRST (untuk data soal) ──────────────────────────────────────────
async function networkFirstSoal(request) {
  try {
    const response = await fetch(request.clone());
    if (response.ok) {
      const cache = await caches.open(CACHE_SOAL);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) {
      console.log('[SW] Serving soal from cache (offline)');
      return cached;
    }
    return new Response(
      JSON.stringify({ success: false, error: 'Offline — soal tidak tersedia di cache' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── FETCH WITH OFFLINE FALLBACK (untuk POST jawaban) ─────────────────────────
// ✅ FIX UTAMA: kembalikan 503 (bukan 202) saat offline
// Sebelumnya 202 dianggap r.ok=true oleh cbt-offline.js → jawaban dianggap
// sudah terkirim padahal belum. Dengan 503, r.ok=false → masuk queue dengan benar
async function fetchWithOfflineFallback(request) {
  try {
    const response = await fetch(request.clone());
    return response;
  } catch {
    console.log('[SW] Offline — jawaban masuk antrian sync');
    return new Response(
      JSON.stringify({ success: false, offline: true, queued: true }),
      {
        status: 503,   // ← BUKAN 202! 503 = r.ok false → client akan enqueue
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// ── BACKGROUND SYNC ───────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  console.log('[SW] Sync event:', event.tag);
  if (event.tag === SYNC_TAG || event.tag.startsWith('cbt-')) {
    event.waitUntil(syncJawaban());
  }
});

async function syncJawaban() {
  console.log('[SW] Starting background sync...');
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'SW_SYNC_TRIGGERED' });
  }
}

// ── MESSAGE HANDLER ───────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'CACHE_SOAL') {
    const { url, data } = event.data;
    if (url && data) {
      caches.open(CACHE_SOAL).then(cache => {
        const response = new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json' },
        });
        cache.put(url, response);
        console.log('[SW] Soal cached manually:', url);
      });
    }
  }

  if (event.data?.type === 'CLEAR_SOAL_CACHE') {
    caches.delete(CACHE_SOAL).then(() => {
      console.log('[SW] Soal cache cleared');
    });
  }
});

console.log('[SW] Service Worker loaded:', SW_VERSION);