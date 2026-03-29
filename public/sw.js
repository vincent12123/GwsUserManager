// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE WORKER — CBT Siswa PWA
// Cache Strategy + Background Sync
// ═══════════════════════════════════════════════════════════════════════════════

const SW_VERSION   = 'cbt-sw-v1';
const CACHE_STATIC = 'cbt-static-v1';
const CACHE_SOAL   = 'cbt-soal-v1';
const SYNC_TAG     = 'cbt-jawaban-sync';

// Aset statis yang di-cache saat install
const STATIC_ASSETS = [
  '/cbt-siswa.html',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
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

  // API soal/siswa → Network First, cache sebagai fallback
  if (url.pathname.includes('/soal/siswa')) {
    event.respondWith(networkFirstSoal(request));
    return;
  }

  // API jawaban POST → jangan di-cache, biarkan lewat
  if (url.pathname.includes('/jawaban') && request.method === 'POST') {
    event.respondWith(fetchWithOfflineFallback(request));
    return;
  }

  // API submit POST → biarkan lewat, offline ditangani di client
  if (url.pathname.includes('/submit') && request.method === 'POST') {
    return; // biarkan fetch normal
  }

  // Static files → Cache First
  if (
    url.pathname === '/cbt-siswa.html' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json'
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
async function fetchWithOfflineFallback(request) {
  try {
    const response = await fetch(request.clone());
    return response;
  } catch {
    // Return response yang menandakan perlu di-queue
    return new Response(
      JSON.stringify({ success: false, offline: true, queued: true }),
      { status: 202, headers: { 'Content-Type': 'application/json' } }
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
  // Kirim pesan ke semua client untuk mulai sync
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
    // Cache soal yang dikirim dari client
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