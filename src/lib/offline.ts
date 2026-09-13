import { get, set } from "idb-keyval";
import { listMemories, within } from "./memories";
import type { BBox, Memory } from "./types";
import { QueryClient } from "@tanstack/react-query";

const OFFLINE_MEMORIES_KEY = "waypoint-offline-memories";

export async function saveOfflineMemories(memories: Memory[]): Promise<void> {
  if (!memories || memories.length === 0) return;
  try {
    const existing = (await get<Memory[]>(OFFLINE_MEMORIES_KEY)) || [];
    const map = new Map<string, Memory>();
    existing.forEach((m) => map.set(m.id, m));
    memories.forEach((m) => map.set(m.id, m));
    await set(OFFLINE_MEMORIES_KEY, Array.from(map.values()));
  } catch (err) {
    console.error("Failed to save offline memories:", err);
  }
}

export async function getOfflineMemoriesInBBox(bbox: BBox): Promise<Memory[]> {
  try {
    const all = (await get<Memory[]>(OFFLINE_MEMORIES_KEY)) || [];
    return all.filter((m) => within(m, bbox));
  } catch {
    return [];
  }
}

export async function getAllOfflineMemories(): Promise<Memory[]> {
  try {
    return (await get<Memory[]>(OFFLINE_MEMORIES_KEY)) || [];
  } catch {
    return [];
  }
}

export interface GeoResult {
  name: string;
  bbox: BBox;
}

export async function searchLocation(query: string): Promise<GeoResult[]> {
  // If user is offline, immediately search through downloaded regions
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const saved = getSavedRegions();
    const q = query.toLowerCase();
    return saved
      .filter((r) => r.name.toLowerCase().includes(q))
      .map((r) => ({ name: r.name, bbox: r.bbox }));
  }

  try {
    // Route through our secure Go proxy to use MapTiler Geocoding API without leaking the API key!
    const url = `/api/v1/map/proxy/geocoding/${encodeURIComponent(query)}.json?limit=5&language=en`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to search location");
    const data = await res.json();

    if (!data.features) return [];

    const results = data.features.map((item: any) => {
      let bbox = item.bbox;
      if (!bbox && item.center) {
        // If a feature is a point (e.g. a small town) with no explicit bounding box, 
        // generate a ~20km artificial bounding box around it so the downloader can still work.
        const [lng, lat] = item.center;
        bbox = [lng - 0.1, lat - 0.1, lng + 0.1, lat + 0.1];
      }

      if (!bbox) return null;

      // MapTiler returns bbox as [minLng, minLat, maxLng, maxLat]
      const [minLng, minLat, maxLng, maxLat] = bbox;
      return {
        name: item.place_name,
        bbox: { minLat, maxLat, minLng, maxLng }
      };
    }).filter(Boolean) as GeoResult[];

    // MapTiler often returns administrative duplicates (city, state, region) with the exact same display name.
    const uniqueNames = new Set();
    return results.filter((r: GeoResult) => {
      if (uniqueNames.has(r.name)) return false;
      uniqueNames.add(r.name);
      return true;
    });
  } catch {
    // Offline or network timeout fallback to saved downloaded regions
    const saved = getSavedRegions();
    const q = query.toLowerCase();
    return saved
      .filter((r) => r.name.toLowerCase().includes(q))
      .map((r) => ({ name: r.name, bbox: r.bbox }));
  }
}

export interface SavedRegion {
  id: string;
  name: string;
  bbox: BBox;
  mb: string;
  downloadedAt: number;
}

export function getSavedRegions(): SavedRegion[] {
  try {
    return JSON.parse(localStorage.getItem("offlineRegions") || "[]");
  } catch {
    return [];
  }
}

export function saveRegion(region: SavedRegion) {
  const regions = getSavedRegions();
  const existing = regions.findIndex((r) => r.id === region.id);
  if (existing >= 0) regions[existing] = region;
  else regions.push(region);
  localStorage.setItem("offlineRegions", JSON.stringify(regions));
}

export function calculateMaxZoom(bbox: BBox): number {
  const area = (bbox.maxLng - bbox.minLng) * (bbox.maxLat - bbox.minLat);
  // MapTiler Planet v3 vector tiles (.pbf) max out at zoom 14.
  // Vector tiles contain scalable geometry; MapLibre overzooms them effortlessly up to zoom 22+.
  if (area <= 0.1) return 14;  // Dense city (e.g. Paris ~0.02)
  if (area <= 0.5) return 14;  // Large metro (e.g. London ~0.34)
  if (area <= 5) return 13;    // Small region / state
  if (area <= 50) return 11;   // Large state
  if (area <= 200) return 9;   // Country
  return 7;                    // Continent
}

export async function clearRegionCache(bbox: BBox) {
  if (!('caches' in window)) return;
  try {
    const maxZoom = calculateMaxZoom(bbox);
    const cacheKeys = await caches.keys();
    const offlineCacheKey = cacheKeys.find((k) => k.startsWith('waypoint-offline-tiles-'));

    if (offlineCacheKey) {
      const cache = await caches.open(offlineCacheKey);
      const allUrls = getTileUrls(bbox, 0, maxZoom);

      const batchSize = 100;
      for (let i = 0; i < allUrls.length; i += batchSize) {
        const batch = allUrls.slice(i, i + batchSize);
        await Promise.all(batch.map((url) => cache.delete(url, { ignoreSearch: true, ignoreVary: true })));
      }
    }
  } catch (e) {
    console.error("Failed to clear tiles from cache:", e);
  }
}

export async function deleteRegion(regionId: string) {
  const regions = getSavedRegions();
  const region = regions.find((r) => r.id === regionId);
  if (!region) return;

  const updated = regions.filter((r) => r.id !== regionId);
  localStorage.setItem("offlineRegions", JSON.stringify(updated));

  await clearRegionCache(region.bbox);
}

function lon2tile(lon: number, zoom: number): number {
  return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom)));
}

function lat2tile(lat: number, zoom: number): number {
  return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)));
}

export function getTileUrls(bbox: BBox, minZ: number, maxZ: number): string[] {
  const urls: string[] = [];
  // Use our Go proxy for MapTiler vector tiles (.pbf)
  const base = "/api/v1/map/proxy/tiles/v3";

  for (let z = minZ; z <= maxZ; z++) {
    const xMin = lon2tile(bbox.minLng, z);
    const xMax = lon2tile(bbox.maxLng, z);
    const yMin = lat2tile(bbox.maxLat, z);
    const yMax = lat2tile(bbox.minLat, z);

    for (let x = Math.min(xMin, xMax); x <= Math.max(xMin, xMax); x++) {
      for (let y = Math.min(yMin, yMax); y <= Math.max(yMin, yMax); y++) {
        urls.push(`${base}/${z}/${x}/${y}.pbf?offline=true`);
      }
    }
  }
  return urls;
}

function roundBBox(b: BBox): BBox {
  const r = (n: number) => Math.round(n * 10) / 10;
  return { minLng: r(b.minLng), minLat: r(b.minLat), maxLng: r(b.maxLng), maxLat: r(b.maxLat) };
}

export function estimateDownloadSize(bbox: BBox): { tiles: number; mb: string } {
  const maxZoom = calculateMaxZoom(bbox);

  // Vector tiles are theme-independent geometry
  const tileUrls = getTileUrls(bbox, 0, maxZoom);
  const tiles = tileUrls.length;
  // ~35KB per vector tile + ~1.2MB for full styles, sprites (1x & 2x dark & light), and font glyphs
  const bytes = tiles * 35 * 1024 + 1.2 * 1024 * 1024;
  const mb = (bytes / (1024 * 1024)).toFixed(1);

  return { tiles, mb: mb === "0.0" ? "< 0.1" : mb };
}

export async function downloadOfflineRegion(
  bbox: BBox,
  _dark: boolean,
  queryClient: QueryClient,
  onProgress: (status: string, percentage: number) => void,
  signal?: AbortSignal
): Promise<boolean> {
  // 1. Fetch waypoints for this exact bounding box into React Query cache & save to IndexedDB
  if (signal?.aborted) return false;
  onProgress("Fetching memories...", 0);
  const roundedKey = roundBBox(bbox);

  let memories: Memory[] = [];
  try {
    memories = await queryClient.fetchQuery({
      queryKey: ["memories", roundedKey],
      queryFn: () => listMemories(bbox)
    });
    // Persist to offline IndexedDB so offline mode displays them immediately!
    if (memories && memories.length > 0) {
      await saveOfflineMemories(memories);
    }
  } catch (err) {
    console.warn("Could not fetch memories for region:", err);
  }

  // 2. Fetch Photos to prime the Service Worker cache
  let photoUrls: string[] = [];
  memories.forEach(m => {
    if (m.photos) m.photos.forEach(p => photoUrls.push(p.url));
  });

  if (photoUrls.length > 0) {
    let photosDone = 0;
    const PHOTO_BATCH = 20;
    for (let i = 0; i < photoUrls.length; i += PHOTO_BATCH) {
      if (signal?.aborted) return false;
      const batch = photoUrls.slice(i, i + PHOTO_BATCH);
      await Promise.all(batch.map(async url => {
        try {
          if (signal?.aborted) return;
          await fetch(url, { signal });
        } catch (e) { }
        if (signal?.aborted) return;
        photosDone++;
        onProgress("Downloading photos...", (photosDone / photoUrls.length) * 10);
      }));
    }
  }

  if (signal?.aborted) return false;

  // 3. Calculate Map Tiles & Assets (zoom 0 to maxZoom 14 for seamless street to world viewing)
  onProgress("Calculating vector map tiles...", 10);

  const maxZoom = calculateMaxZoom(bbox);
  const tileUrls = getTileUrls(bbox, 0, maxZoom);
  
  // Add complete asset bundle (both dark & light styles, sprites, and font glyphs)
  tileUrls.push(
    // Both styles so dark/light theme switching works 100% offline
    "/api/v1/map/style?id=dataviz-dark&offline=true",
    "/api/v1/map/style?id=dataviz-light&offline=true",
    // TileJSON specification
    "/api/v1/map/proxy/tiles/v3/tiles.json?offline=true",
    // Sprites for dataviz-dark (1x and 2x Retina)
    "/api/v1/map/proxy/maps/dataviz-dark/sprite.json?offline=true",
    "/api/v1/map/proxy/maps/dataviz-dark/sprite.png?offline=true",
    "/api/v1/map/proxy/maps/dataviz-dark/sprite@2x.json?offline=true",
    "/api/v1/map/proxy/maps/dataviz-dark/sprite@2x.png?offline=true",
    // Sprites for dataviz-light (1x and 2x Retina)
    "/api/v1/map/proxy/maps/dataviz-light/sprite.json?offline=true",
    "/api/v1/map/proxy/maps/dataviz-light/sprite.png?offline=true",
    "/api/v1/map/proxy/maps/dataviz-light/sprite@2x.json?offline=true",
    "/api/v1/map/proxy/maps/dataviz-light/sprite@2x.png?offline=true",
    // Essential font glyphs for street/place labels
    "/api/v1/map/proxy/fonts/Metropolis%20Semi%20Bold,Noto%20Sans%20Bold/0-255.pbf?offline=true",
    "/api/v1/map/proxy/fonts/Metropolis%20Semi%20Bold%20Italic,Noto%20Sans%20Bold/0-255.pbf?offline=true",
    "/api/v1/map/proxy/fonts/Metropolis%20Semi%20Bold,Noto%20Sans%20Bold/256-511.pbf?offline=true",
    "/api/v1/map/proxy/fonts/Metropolis%20Semi%20Bold%20Italic,Noto%20Sans%20Bold/256-511.pbf?offline=true"
  );

  if (tileUrls.length === 0) {
    onProgress("Download complete!", 100);
    return true;
  }

  // 4. Download Map Tiles
  let tilesDone = 0;

  // Controlled concurrency pool keeps browser network saturated without hitting resource limits
  const MAX_CONCURRENT = 30;
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < tileUrls.length) {
      if (signal?.aborted) break;
      const url = tileUrls[currentIndex++];
      try {
        await fetch(url, { signal });
      } catch (e) { }

      if (signal?.aborted) break;

      tilesDone++;
      // Throttle UI updates to avoid freezing React
      if (tilesDone % 5 === 0 || tilesDone === tileUrls.length) {
        const pct = 10 + (tilesDone / tileUrls.length) * 90;
        onProgress(`Downloading vector map (${tilesDone}/${tileUrls.length})...`, Math.round(pct));
      }
    }
  };

  const workers = Array(Math.min(MAX_CONCURRENT, tileUrls.length)).fill(0).map(worker);
  await Promise.all(workers);

  if (signal?.aborted) return false;

  onProgress("Download complete!", 100);
  return true;
}
