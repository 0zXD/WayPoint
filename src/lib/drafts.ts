// IndexedDB draft queue for offline memory uploads
// Drafts are stored as: { id, title, narrative, locationTag, lat, lng, photos: ArrayBuffer[], mimeTypes: string[], createdAt }

const DB_NAME = 'waypoint-drafts';
const STORE   = 'drafts';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export interface MemoryDraft {
  id: string;
  title: string;
  narrative: string;
  locationTag: string;
  lat: string;
  lng: string;
  photos: ArrayBuffer[];
  mimeTypes: string[];
  createdAt: string;
}

export async function saveDraft(draft: Omit<MemoryDraft, 'id' | 'createdAt'>): Promise<string> {
  const db = await openDB();
  const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const record: MemoryDraft = {
    ...draft,
    id,
    createdAt: new Date().toISOString(),
  };
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add(record);
    req.onsuccess = () => resolve(id);
    req.onerror   = () => reject(req.error);
  });
}

export async function listDrafts(): Promise<MemoryDraft[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as MemoryDraft[]);
    req.onerror   = () => reject(req.error);
  });
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

export async function getDraftCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// Convert a MemoryDraft into a Memory shape the map can render.
// Photos are turned into object URLs (blob:// URIs).
// IMPORTANT: call revokeDraftBlobUrls() when these are no longer needed.
import type { Memory } from './types';

export function draftToMemory(draft: MemoryDraft, authorName?: string): Memory {
  const photos = draft.photos.map((buf, i) => {
    const blob = new Blob([buf], { type: draft.mimeTypes[i] || 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    return { id: `${draft.id}-photo-${i}`, url };
  });

  return {
    id: draft.id, // starts with "draft-" so we can detect it
    title: draft.title,
    narrative: draft.narrative,
    locationTag: draft.locationTag,
    lat: parseFloat(draft.lat),
    lng: parseFloat(draft.lng),
    authorName: authorName ?? 'You',
    photos,
    createdAt: draft.createdAt,
  };
}

// Revoke blob URLs created by draftToMemory to free memory
export function revokeDraftBlobUrls(memories: Memory[]) {
  for (const m of memories) {
    if (m.id.startsWith('draft-') && m.photos) {
      for (const p of m.photos) {
        URL.revokeObjectURL(p.url);
      }
    }
  }
}
