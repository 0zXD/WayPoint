// WayPoint Service Worker
// Strategy:
//   - Navigation requests  → Network-first, fallback to /offline.html
//   - Static assets (.js/.css/.woff2/icons) → Cache-first
//   - Map tiles (CartoCDN) → Cache-first, 60-tile LRU cap
//   - API requests (/api/) → Network-only (never cached)
// Background Sync: re-attempts failed memory uploads when connectivity returns.

const CACHE_VERSION = 'v14';
const STATIC_CACHE  = `waypoint-static-${CACHE_VERSION}`;
const TILE_CACHE    = `waypoint-tiles-${CACHE_VERSION}`;
const OFFLINE_TILE_CACHE = `waypoint-offline-tiles-v1`;
const MAX_TILES     = 500;

let isCleaningCache = false;
let putCounter = 0;

const PRECACHE_URLS = [
  '/',
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
          .filter((k) => k !== STATIC_CACHE && k !== TILE_CACHE && k !== OFFLINE_TILE_CACHE)
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

  // Photos - Cache first!
  if (url.pathname.startsWith('/api/v1/photos/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Other API requests — always go to network, never cache (except our proxied map assets!)
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/v1/map/')) {
    return;
  }

  // Map tiles, style JSON, and sprites from our Go proxy
  if (url.pathname.startsWith('/api/v1/map/')) {
    // Only intercept if user is explicitly downloading an offline pack or is currently offline
    if (url.searchParams.has('offline') || !navigator.onLine) {
      event.respondWith(tileFirst(request));
      return;
    }
    // Online navigation: bypass Service Worker completely.
    // This allows MapLibre's native AbortController to immediately propagate HTTP/2 RST_STREAM
    // to the Go backend when the user pans/swipes, preventing hundreds of zombie tile downloads.
    return;
  }

  // Static assets: JS, CSS, fonts, images
  const isStaticAsset =
    /\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|webp|svg|ico|webmanifest|json)(\?.*)?$/.test(url.pathname);

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
  const cached = await cache.match(request.url, { ignoreVary: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      await cache.put(request.url, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function tileFirst(request) {
  const cache = await caches.open(TILE_CACHE);
  const offlineCache = await caches.open(OFFLINE_TILE_CACHE);

  // Strip ONLY the offline=true parameter so style IDs (like ?id=dataviz-dark) are still cached uniquely!
  let urlObj = new URL(request.url);
  urlObj.searchParams.delete('offline');
  const cacheKey = urlObj.toString();

  // Try offline region cache first
  const offlineCached = await offlineCache.match(cacheKey, { ignoreVary: true });
  if (offlineCached) return offlineCached;

  // Then try normal tile cache
  const cached = await cache.match(cacheKey, { ignoreVary: true });
  if (cached) return cached;

  try {
    // Fetch using the original request so domain sharding still hits the network correctly
    const response = await fetch(request);
    
    // Opaque responses or OK responses
    if (response.ok || response.type === 'opaque') {
      if (request.url.includes('offline=true')) {
        offlineCache.put(cacheKey, response.clone()).catch(console.error);
      } else {
        limitedCachePut(cache, cacheKey, response.clone(), MAX_TILES);
      }
    }
    return response;
  } catch {
    // If offline and request is for a vector tile (.pbf), return 204 No Content.
    // In MapLibre GL JS, HTTP 204 tells the engine the tile has no data,
    // which cleanly renders empty background without throwing Pbf decoder errors.
    if (urlObj.pathname.endsWith('.pbf')) {
      return new Response(null, { status: 204, statusText: 'No Content' });
    }
    // For style.json or other JSON, return 404 JSON response rather than 503 text
    if (urlObj.pathname.endsWith('.json') || urlObj.pathname.includes('/style')) {
      return new Response(JSON.stringify({ error: 'Offline asset not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(null, { status: 204, statusText: 'No Content' });
  }
}

async function networkFirstNav(request) {
  try {
    const response = await fetch(request);
    // Cache the successful navigation for future offline use
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(request.url, response.clone());
      await cache.put('/', response.clone());
    }
    return response;
  } catch {
    // Try cache first with ignoreVary to bypass mismatching browser headers on reload
    const cache = await caches.open(STATIC_CACHE);
    const cached = (await cache.match(request.url, { ignoreVary: true }))
      || (await cache.match('/', { ignoreVary: true }))
      || (await cache.match('/index.html', { ignoreVary: true }));
    if (cached) return cached;
    // Final fallback: offline page
    const offline = await cache.match('/offline.html', { ignoreVary: true });
    return offline ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/html' } });
  }
}

// LRU-ish cap: delete oldest entries when tile cache exceeds MAX_TILES
async function limitedCachePut(cache, request, response, maxEntries) {
  try {
    await cache.put(request, response);
  } catch (e) {
    console.error("Cache put failed:", e);
    return;
  }
  
  putCounter++;
  if (putCounter % 25 !== 0 || isCleaningCache) return;
  isCleaningCache = true;
  
  try {
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
      // Delete in batches of 50
      const toDelete = keys.slice(0, keys.length - maxEntries);
      await Promise.all(toDelete.map((k) => cache.delete(k)));
    }
  } catch (e) {
    console.error("Cache cleanup failed:", e);
  } finally {
    isCleaningCache = false;
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
