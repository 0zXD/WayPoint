import type { Memory, MemoryCluster } from "./types";

export function clusterKey(m: Pick<Memory, "lat" | "lng">) {
  return `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`;
}

export function buildClusters(memories: Memory[]): MemoryCluster[] {
  const map = new Map<string, MemoryCluster>();
  for (const m of memories) {
    if (!m || !m.id) continue; // Safeguard against corrupted IndexedDB data
    const k = clusterKey(m);
    const existing = map.get(k);
    if (existing) {
      existing.memories.push(m);
      existing.count = existing.memories.length;
    } else {
      map.set(k, { key: k, lat: m.lat, lng: m.lng, count: 1, memories: [m] });
    }
  }
  for (const c of map.values()) {
    c.memories.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
  return [...map.values()];
}
