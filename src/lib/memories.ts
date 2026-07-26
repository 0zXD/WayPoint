import { apiFetch, API_CONFIGURED } from "./api";
import type { BBox, Memory } from "./types";

// Deterministic demo dataset used until VITE_API_BASE_URL is set.
const DEMO: Memory[] = [
  {
    id: "m-1",
    title: "Sunrise over Notre-Dame",
    narrative:
      "Coffee at 6am on the Seine's edge. The bells hadn't started yet — the whole city felt like it was holding its breath.",
    imageUrl:
      "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=1200&auto=format&fit=crop&q=70",
    lat: 48.8529,
    lng: 2.3499,
    locationTag: "Paris, France",
    visibility: "public",
    collection: "Europe 2024",
    authorName: "Ines Marchand",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
  },
  {
    id: "m-2",
    title: "Late shift at Blue Bottle",
    narrative:
      "Wrote the last chapter of the draft here. Rain on the skylights, ceramic clinks, the barista laughed at something I couldn't hear.",
    imageUrl:
      "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&auto=format&fit=crop&q=70",
    lat: 40.7223,
    lng: -73.9878,
    locationTag: "Manhattan, NY",
    visibility: "shared",
    collection: "Field notes",
    authorName: "Jonah Bridge",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString(),
  },
  {
    id: "m-3",
    title: "Wet stones, Shibuya",
    narrative:
      "Ran the crossing three times just to feel it again. The rain flattened the neon into wet stones underfoot.",
    imageUrl:
      "https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=1200&auto=format&fit=crop&q=70",
    lat: 35.6595,
    lng: 139.7005,
    locationTag: "Shibuya, Tokyo",
    visibility: "public",
    authorName: "Ren Aoki",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
  },
  {
    id: "m-4",
    title: "Fog rolling into the bay",
    narrative:
      "Karl came in early today. Sat on the pier and watched the bridge disappear one cable at a time.",
    imageUrl:
      "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=1200&auto=format&fit=crop&q=70",
    lat: 37.8199,
    lng: -122.4783,
    locationTag: "San Francisco, CA",
    visibility: "shared",
    collection: "Bay walks",
    authorName: "Priya Kumar",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
  },
  {
    id: "m-5",
    title: "Bookstore, Kreuzberg",
    narrative:
      "Second-hand shop with a cat named Pauli. Left with three books and a phone number scribbled on a receipt.",
    imageUrl:
      "https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=1200&auto=format&fit=crop&q=70",
    lat: 52.4996,
    lng: 13.4033,
    locationTag: "Berlin, Germany",
    visibility: "public",
    authorName: "Milo Hertz",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 32).toISOString(),
  },
  {
    id: "m-6",
    title: "Salt air, Positano",
    narrative:
      "Every color the sea can be, right here. Ate a lemon granita and tried to remember all of them.",
    imageUrl:
      "https://images.unsplash.com/photo-1533105079780-92b9be482077?w=1200&auto=format&fit=crop&q=70",
    lat: 40.628,
    lng: 14.4849,
    locationTag: "Positano, Italy",
    visibility: "public",
    collection: "Europe 2024",
    authorName: "Ines Marchand",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
  },
  {
    id: "m-1b",
    title: "Booksellers on the quay",
    narrative:
      "Green boxes flipped open one by one. Bought a battered copy of Perec and a postcard of a boat I'll never own.",
    imageUrl:
      "https://images.unsplash.com/photo-1522093007474-d86e9bf7ba6f?w=1200&auto=format&fit=crop&q=70",
    lat: 48.8529,
    lng: 2.3499,
    locationTag: "Paris, France",
    visibility: "public",
    collection: "Europe 2024",
    authorName: "Ines Marchand",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 19).toISOString(),
  },
  {
    id: "m-1c",
    title: "Rain on the parapet",
    narrative:
      "The gargoyles looked less serious in the rain. Everyone shared umbrellas without asking.",
    imageUrl:
      "https://images.unsplash.com/photo-1520175480921-4edfa2983e0f?w=1200&auto=format&fit=crop&q=70",
    lat: 48.8529,
    lng: 2.3499,
    locationTag: "Paris, France",
    visibility: "shared",
    collection: "Europe 2024",
    authorName: "Ines Marchand",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 15).toISOString(),
  },
  {
    id: "m-3b",
    title: "Neon after the rain",
    narrative:
      "Second lap through the crossing. A stranger's umbrella brushed mine and neither of us apologized.",
    imageUrl:
      "https://images.unsplash.com/photo-1542051841857-5f90071e7989?w=1200&auto=format&fit=crop&q=70",
    lat: 35.6595,
    lng: 139.7005,
    locationTag: "Shibuya, Tokyo",
    visibility: "public",
    authorName: "Ren Aoki",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
];

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
  if (!API_CONFIGURED) {
    // Return demo data filtered by viewport
    return DEMO.filter((m) => within(m, bbox));
  }
  const q = `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;
  return apiFetch<Memory[]>(`/api/v1/memories?bbox=${encodeURIComponent(q)}`);
}

export async function uploadMemory(form: FormData): Promise<Memory> {
  if (!API_CONFIGURED) {
    const file = form.get("image") as File | null;
    const imageUrl = file ? URL.createObjectURL(file) : "";
    const m: Memory = {
      id: `local-${Date.now()}`,
      title: (form.get("title") as string) || "Untitled",
      narrative: (form.get("narrative") as string) || "",
      imageUrl,
      lat: Number(form.get("lat")) || 0,
      lng: Number(form.get("lng")) || 0,
      locationTag: (form.get("locationTag") as string) || undefined,
      visibility: ((form.get("visibility") as Memory["visibility"]) || "private"),
      authorName: "You",
      createdAt: new Date().toISOString(),
    };
    DEMO.push(m);
    return m;
  }
  return apiFetch<Memory>(`/api/v1/memories`, { method: "POST", body: form });
}
