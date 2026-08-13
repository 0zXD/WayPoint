import { apiFetch, NetworkTimeoutError } from "./api";
import type { BBox, Memory } from "./types";

export function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function within(m: Memory, b: BBox): boolean {
  if (m.lat < b.minLat || m.lat > b.maxLat) return false;
  if (b.maxLng - b.minLng >= 360) return true;

  const mLng = normalizeLng(m.lng);
  const minLng = normalizeLng(b.minLng);
  const maxLng = normalizeLng(b.maxLng);

  if (minLng <= maxLng) {
    return mLng >= minLng && mLng <= maxLng;
  } else {
    // Spans across anti-meridian (+180/-180)
    return mLng >= minLng || mLng <= maxLng;
  }
}

export async function listMemories(bbox: BBox): Promise<Memory[]> {
  const query = new URLSearchParams({
    minLng: String(bbox.minLng),
    minLat: String(bbox.minLat),
    maxLng: String(bbox.maxLng),
    maxLat: String(bbox.maxLat)
  }).toString();
  const results = await apiFetch<Memory[]>(`/api/v1/memories?${query}`);

  // Convert relative backend imageUrl to absolute path if needed
  const { API_BASE } = await import("./api");
  return (results || []).map(m => ({
    ...m,
    photos: (m.photos || []).map(p => ({ ...p, url: p.url.startsWith('/') ? `${API_BASE}${p.url}` : p.url }))
  }));
}

export async function uploadMemory(form: FormData): Promise<Memory> {
  return await apiFetch<Memory>(`/api/v1/memories`, { method: "POST", body: form });
}

export async function updateMemory(id: string, form: FormData): Promise<Memory> {
  return await apiFetch<Memory>(`/api/v1/memories/${id}`, { method: "PUT", body: form });
}

export async function deleteMemory(id: string): Promise<void> {
  await apiFetch(`/api/v1/memories/${id}`, { method: "DELETE" });
}

export async function deletePhoto(photoId: string): Promise<void> {
  await apiFetch(`/api/v1/memories/photo/${photoId}`, { method: "DELETE" });
}

export async function searchMemories(query: string): Promise<Memory[]> {
  try {
    const results = await apiFetch<Memory[]>(`/api/v1/memories/search?q=${encodeURIComponent(query)}`);
    const { API_BASE } = await import("./api");
    return (results || []).map(m => ({
      ...m,
      photos: (m.photos || []).map(p => ({ ...p, url: p.url.startsWith('/') ? `${API_BASE}${p.url}` : p.url }))
    }));
  } catch {
    return [];
  }
}
