// WayPoint Service Worker
// Strategy:
//   - Navigation requests  → Network-first, fallback to /offline.html
//   - Static assets (.js/.css/.woff2/icons) → Cache-first
//   - Map tiles (CartoCDN) → Cache-first, 60-tile LRU cap
//   - API requests (/api/) → Network-only (never cached)
// Background Sync: re-attempts failed memory uploads when connectivity returns.

const CACHE_VERSION = 'v1';
const STATIC_CACHE  = `waypoint-static-${CACHE_VERSION}`;
const TILE_CACHE    = `waypoint-tiles-${CACHE_VERSION}`;
const MAX_TILES     = 60;

const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.ico',
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== TILE_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept non-GET or extension devtools requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // API requests — always go to network, never cache
  if (url.pathname.startsWith('/api/')) return;

  // Map tiles (CartoCDN / OpenStreetMap)
  if (
    url.hostname.includes('basemaps.cartocdn.com') ||
    url.hostname.includes('tile.openstreetmap.org')
  ) {
    event.respondWith(tileFirst(request));
    return;
  }

  // Static assets: JS, CSS, fonts, images
  const isStaticAsset =
    /\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|webp|svg|ico)(\?.*)?$/.test(url.pathname);

  if (isStaticAsset) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Navigation (HTML pages) — network-first, fallback to offline page
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNav(request));
    return;
  }
});

// ─── Strategies ───────────────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function tileFirst(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      await limitedCachePut(cache, request, response.clone(), MAX_TILES);
    }
    return response;
  } catch {
    return new Response('Tile unavailable offline', { status: 503 });
  }
}

async function networkFirstNav(request) {
  try {
    const response = await fetch(request);
    // Cache the successful navigation for future offline use
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Try cache first
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    // Final fallback: offline page
    const offline = await cache.match('/offline.html');
    return offline ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/html' } });
  }
}

// LRU-ish cap: delete oldest entries when tile cache exceeds MAX_TILES
async function limitedCachePut(cache, request, response, maxEntries) {
  await cache.put(request, response);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    // Delete the oldest entries (front of the list)
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map((k) => cache.delete(k)));
  }
}

// ─── Background Sync ──────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'waypoint-draft-sync') {
    event.waitUntil(syncDrafts());
  }
});

async function syncDrafts() {
  // Notify all open clients to trigger the sync
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'SYNC_DRAFTS' });
  }
}
