import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Compass, Images, MapPin, Minus, Navigation, Plus, Trash2, Loader2, Pencil, CloudOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { deleteMemory, listMemories } from "@/lib/memories";
import { listDrafts, draftToMemory, revokeDraftBlobUrls } from "@/lib/drafts";
import { useAppStore } from "@/lib/store";
import { UploadFab } from "./UploadFab";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { AuthUser, BBox, Memory } from "@/lib/types";

const SAMPLE_MEMORIES: Memory[] = [
  {
    id: "sample-1",
    title: "Eiffel Tower Sunset",
    narrative: "A beautiful evening in Paris, watching the lights sparkle.",
    lat: 48.8584,
    lng: 2.2945,
    locationTag: "Paris, France",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    authorName: "WayPoint",
    photos: [{ id: "p1", url: "https://images.unsplash.com/photo-1543349689-9a4d426bee8e?auto=format&fit=crop&w=800&q=80" }]
  },
  {
    id: "sample-2",
    title: "Mount Fuji Hike",
    narrative: "Breathtaking views from the top. The sunrise was unforgettable.",
    lat: 35.3606,
    lng: 138.7274,
    locationTag: "Honshu, Japan",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    authorName: "WayPoint",
    photos: [{ id: "p2", url: "https://images.unsplash.com/photo-1490806843957-31f4c9a91c65?auto=format&fit=crop&w=800&q=80" }]
  },
  {
    id: "sample-3",
    title: "Central Park Stroll",
    narrative: "Autumn leaves falling softly around the reservoir.",
    lat: 40.7812,
    lng: -73.9665,
    locationTag: "New York, USA",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
    authorName: "WayPoint",
    photos: [{ id: "p3", url: "https://images.unsplash.com/photo-1510798831971-661eb04b3739?auto=format&fit=crop&w=800&q=80" }]
  },
  {
    id: "sample-4",
    title: "Santorini Getaway",
    narrative: "Crystal clear waters and white-washed houses.",
    lat: 36.3932,
    lng: 25.4615,
    locationTag: "Santorini, Greece",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString(),
    authorName: "WayPoint",
    photos: [{ id: "p4", url: "https://images.unsplash.com/photo-1613395877344-13d4a8e0d49e?auto=format&fit=crop&w=800&q=80" }]
  }
];

const pinIcon = L.divIcon({
  className: "!bg-transparent !border-0",
  html: `<div class="memory-pin"></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 26],
});

const draftPinIcon = L.divIcon({
  className: "!bg-transparent !border-0",
  html: `<div class="memory-pin draft-pin"></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 26],
});

const userLocationIcon = L.divIcon({
  className: "!bg-transparent !border-0",
  html: `
    <div class="relative flex items-center justify-center">
      <span class="absolute h-8 w-8 animate-ping rounded-full bg-primary/40 opacity-75"></span>
      <span class="relative flex h-5 w-5 items-center justify-center rounded-full bg-primary ring-4 ring-background shadow-lg">
        <span class="h-2 w-2 rounded-full bg-primary-foreground"></span>
      </span>
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

export function getWrappedLng(lng: number, centerLng: number): number {
  return lng + Math.round((centerLng - lng) / 360) * 360;
}

function BBoxEmitter({ onBBox, onCenter }: {
  onBBox: (b: BBox) => void;
  onCenter: (c: { lat: number; lng: number }) => void;
}) {
  const map = useMap();
  const onBBoxRef = useRef(onBBox);
  const onCenterRef = useRef(onCenter);
  onBBoxRef.current = onBBox;
  onCenterRef.current = onCenter;
  useEffect(() => {
    const b = map.getBounds();
    onBBoxRef.current({
      minLng: b.getWest(),
      minLat: b.getSouth(),
      maxLng: b.getEast(),
      maxLat: b.getNorth(),
    });
    const c = map.getCenter();
    onCenterRef.current({ lat: c.lat, lng: c.lng });
  }, [map]);
  useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      onBBox({
        minLng: b.getWest(),
        minLat: b.getSouth(),
        maxLng: b.getEast(),
        maxLat: b.getNorth(),
      });
      const c = map.getCenter();
      onCenter({ lat: c.lat, lng: c.lng });
    },
  });
  return null;
}

function UserLocationZoomer() {
  const map = useMap();
  const user = useAppStore((s) => s.user);
  const prevUserRef = useRef<AuthUser | null>(user);
  const isInitialMountRef = useRef(true);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [centerLng, setCenterLng] = useState<number>(map.getCenter().lng);

  useMapEvents({
    moveend: () => setCenterLng(map.getCenter().lng),
  });

  useEffect(() => {
    setCenterLng(map.getCenter().lng);
  }, [map]);

  useEffect(() => {
    const wasUserLoggedIn = !!prevUserRef.current;
    const isUserLoggedIn = !!user;
    const justSignedOut = wasUserLoggedIn && !isUserLoggedIn;
    const justSignedIn = !wasUserLoggedIn && isUserLoggedIn;
    const initialLoadSignedIn = isInitialMountRef.current && isUserLoggedIn;

    prevUserRef.current = user;
    isInitialMountRef.current = false;

    if (justSignedOut) {
      setLocation(null);
      // Smoothly zoom out map back to global world view
      map.flyTo([30, 5], 3, {
        duration: 2.5,
        easeLinearity: 0.25,
      });
      return;
    }

    if (!isUserLoggedIn) {
      setLocation(null);
      return;
    }

    // Only zoom to location AFTER user signs in (or on initial load if already signed in)
    if (justSignedIn || initialLoadSignedIn || !location) {
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords;
            setLocation({ lat: latitude, lng: longitude });

            // Elegant, smooth parabolic flyTo animation
            map.flyTo([latitude, longitude], 13, {
              duration: 2.8,
              easeLinearity: 0.25,
            });
          },
          (err) => {
            console.warn("Geolocation error:", err.message);
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000,
          }
        );
      }
    }
  }, [user, map]);

  if (!location) return null;

  const wrappedLng = getWrappedLng(location.lng, centerLng);

  return (
    <Marker position={[location.lat, wrappedLng]} icon={userLocationIcon}>
      <Tooltip direction="top" offset={[0, -12]} opacity={1}>
        <div className="whitespace-nowrap px-3 py-1.5 text-center font-display text-xs font-semibold text-primary">
          You're here
        </div>
      </Tooltip>
    </Marker>
  );
}

function ClusterMarkers({
  clusters,
  onOpenCluster,
  onDeleteMemory,
}: {
  clusters: MemoryCluster[];
  onOpenCluster: (key: string) => void;
  onDeleteMemory: (m: Memory) => void;
}) {
  const map = useMap();
  const [centerLng, setCenterLng] = useState<number>(map.getCenter().lng);

  useMapEvents({
    moveend: () => setCenterLng(map.getCenter().lng),
  });

  useEffect(() => {
    setCenterLng(map.getCenter().lng);
  }, [map]);

  const activeSearchPopupId = useAppStore((s) => s.activeSearchPopupId);
  const setActiveSearchPopupId = useAppStore((s) => s.setActiveSearchPopupId);

  return (
    <>
      {clusters.map((c) => (
        <ClusterMarkerItem
          key={c.key}
          cluster={c}
          centerLng={centerLng}
          onOpenCluster={onOpenCluster}
          onDeleteMemory={onDeleteMemory}
          activeSearchPopupId={activeSearchPopupId}
          clearActiveSearchPopup={() => setActiveSearchPopupId(null)}
        />
      ))}
    </>
  );
}

function ClusterMarkerItem({
  cluster,
  centerLng,
  onOpenCluster,
  onDeleteMemory,
  activeSearchPopupId,
  clearActiveSearchPopup,
}: {
  cluster: MemoryCluster;
  centerLng: number;
  onOpenCluster: (key: string) => void;
  onDeleteMemory: (m: Memory) => void;
  activeSearchPopupId: string | null;
  clearActiveSearchPopup: () => void;
}) {
  const markerRef = useRef<any>(null);
  const wrappedLng = getWrappedLng(cluster.lng, centerLng);

  useEffect(() => {
    if (activeSearchPopupId && cluster.memories.some((m) => m.id === activeSearchPopupId)) {
      if (markerRef.current) {
        markerRef.current.openPopup();
        clearActiveSearchPopup();
      }
    }
  }, [activeSearchPopupId, cluster, clearActiveSearchPopup]);

  return (
    <Marker ref={markerRef} position={[cluster.lat, wrappedLng]} icon={cluster.memories.some(m => m.id.startsWith('draft-')) ? draftPinIcon : pinIcon}>
      <Popup closeButton={false} autoPan={true} closeOnClick={true} offset={[0, -20]}>
        <ClusterPopup cluster={cluster} onOpen={() => onOpenCluster(cluster.key)} onDeleteMemory={onDeleteMemory} />
      </Popup>
    </Marker>
  );
}

function useDark() {
  const [dark, setDark] = useState(
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains("dark")));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function round(b: BBox): BBox {
  const r = (n: number) => Math.round(n * 100) / 100;
  return { minLng: r(b.minLng), minLat: r(b.minLat), maxLng: r(b.maxLng), maxLat: r(b.maxLat) };
}

export type MemoryCluster = {
  key: string;
  lat: number;
  lng: number;
  memories: Memory[];
};

export function clusterKey(m: Pick<Memory, "lat" | "lng">) {
  return `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`;
}

function buildClusters(memories: Memory[]): MemoryCluster[] {
  const map = new Map<string, MemoryCluster>();
  for (const m of memories) {
    const k = clusterKey(m);
    const existing = map.get(k);
    if (existing) existing.memories.push(m);
    else map.set(k, { key: k, lat: m.lat, lng: m.lng, memories: [m] });
  }
  for (const c of map.values()) {
    c.memories.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
  return [...map.values()];
}

const MAX_BOUNDS: L.LatLngBoundsExpression = [
  [-85.05112878, -Infinity],
  [85.05112878, Infinity],
];

export function MapCanvas({
  onMemories,
  onCenter,
}: {
  onMemories: (m: Memory[]) => void;
  onCenter: (c: { lat: number; lng: number } | null) => void;
}) {
  const [bbox, setBbox] = useState<BBox | null>(null);
  const setBBoxStore = useAppStore((s) => s.setBBox);
  const setOpenClusterKey = useAppStore((s) => s.setOpenClusterKey);
  const debounceRef = useRef<number | null>(null);
  const dark = useDark();

  const qc = useQueryClient();
  const [memoryToDelete, setMemoryToDelete] = useState<Memory | null>(null);

  const deleteMemoryMutation = useMutation({
    mutationFn: () => deleteMemory(memoryToDelete!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memories"] });
      setMemoryToDelete(null);
    },
    onError: () => toast.error("Failed to delete memory"),
  });

  const key = useMemo(() => (bbox ? round(bbox) : null), [bbox]);
  const user = useAppStore((s) => s.user);

  const query = useQuery({
    queryKey: ["memories", key],
    queryFn: () => listMemories(bbox!),
    enabled: !!bbox && !!user,
    staleTime: 30_000,
  });

  // Load offline drafts from IndexedDB
  const userName = user?.name;
  const draftsQuery = useQuery({
    queryKey: ["drafts"],
    networkMode: "always", // CRITICAL: Run even when offline so we can read from IndexedDB
    queryFn: async () => {
      const drafts = await listDrafts();
      return drafts.map((d) => draftToMemory(d, userName ?? undefined));
    },
    enabled: !!user,
    staleTime: 5_000,
  });

  // Revoke blob URLs when draft memories change
  const prevDraftMemories = useRef<Memory[]>([]);
  useEffect(() => {
    return () => {
      revokeDraftBlobUrls(prevDraftMemories.current);
    };
  }, []);
  useEffect(() => {
    if (draftsQuery.data) {
      revokeDraftBlobUrls(prevDraftMemories.current);
      prevDraftMemories.current = draftsQuery.data;
    }
  }, [draftsQuery.data]);

  // To prevent flickering while panning, we can retain the previous data
  // until the new fetch completes.
  const [serverMemories, setServerMemories] = useState<Memory[]>([]);

  useEffect(() => {
    if (query.data) {
      setServerMemories(query.data);
    }
  }, [query.data]);

  // Merge server memories with offline draft memories
  const allMemories = useMemo(() => {
    if (!user) return SAMPLE_MEMORIES;
    const drafts = draftsQuery.data ?? [];
    // Filter out any drafts that might have already synced (same lat/lng/title)
    return [...serverMemories, ...drafts];
  }, [serverMemories, draftsQuery.data, user]);

  const clusters = useMemo(() => buildClusters(allMemories), [allMemories]);

  const onMemoriesRef = useRef(onMemories);
  onMemoriesRef.current = onMemories;
  useEffect(() => {
    if (allMemories.length > 0) onMemoriesRef.current(allMemories);
  }, [allMemories]);

  const handleBBox = (b: BBox) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setBbox(b);
      setBBoxStore(b);
    }, 300);
  };

  const tileUrl = dark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

  return (
    <>
      <MapContainer
        center={[30, 5]}
        zoom={3}
        minZoom={3}
        maxBounds={MAX_BOUNDS}
        maxBoundsViscosity={1.0}
        worldCopyJump
        className="fixed inset-0 h-screen w-screen"
        zoomControl={false}
      >
        <TileLayer
          url={tileUrl}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> · <a href="https://carto.com/attributions">CARTO</a>'
          bounds={[[-85.05112878, -180], [85.05112878, 180]]}
        />
        <BBoxEmitter onBBox={handleBBox} onCenter={onCenter} />
        <LocationPicker />
        <UserLocationZoomer />
        <MapControls />
        <ClusterMarkers
          clusters={clusters}
          onOpenCluster={(key) => {
            if (!user) {
              toast("Please sign in or create an account to view full memory details and photos.");
              return;
            }
            setOpenClusterKey(key);
          }}
          onDeleteMemory={(m) => setMemoryToDelete(m)}
        />
      </MapContainer>

      <AlertDialog open={!!memoryToDelete} onOpenChange={(open) => !open && setMemoryToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete your memory "{memoryToDelete?.title}" and remove all of its associated photos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteMemoryMutation.isPending}
              onClick={() => deleteMemoryMutation.mutate()}
            >
              {deleteMemoryMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Memory
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MapControls() {
  const map = useMap();
  const user = useAppStore((s) => s.user);

  const handleLocateMe = () => {
    if (!user) {
      toast.info("Please sign in to zoom to your location.");
      return;
    }
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.flyTo([pos.coords.latitude, pos.coords.longitude], 14, {
            duration: 2.2,
            easeLinearity: 0.25,
          });
        },
        () => toast.error("Could not access your location."),
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    }
  };

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-[500] flex flex-col items-center gap-2 sm:bottom-6 sm:right-6 sm:gap-3">
      <div className="glass pointer-events-auto flex flex-col rounded-xl sm:rounded-[1.25rem] p-1 sm:p-1.5 shadow-xl border border-border/40">
        <button
          type="button"
          onClick={() => map.zoomIn()}
          className="flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl text-foreground hover:bg-muted/80 transition-all active:scale-95 cursor-pointer"
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>
        <div className="mx-1.5 sm:mx-2 my-0.5 h-px bg-border/40" />
        <button
          type="button"
          onClick={() => map.zoomOut()}
          className="flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl text-foreground hover:bg-muted/80 transition-all active:scale-95 cursor-pointer"
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>
        <div className="mx-1.5 sm:mx-2 my-0.5 h-px bg-border/40" />
        <button
          type="button"
          onClick={handleLocateMe}
          className="flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl text-foreground hover:bg-muted/80 transition-all active:scale-95 cursor-pointer"
          title="My location"
          aria-label="My location"
        >
          <Navigation className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
        </button>
        <div className="mx-1.5 sm:mx-2 my-0.5 h-px bg-border/40" />
        <button
          type="button"
          onClick={() => map.flyTo([30, 5], 3, { duration: 1 })}
          className="flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl text-foreground hover:bg-muted/80 transition-all active:scale-95 cursor-pointer"
          title="Reset view"
          aria-label="Reset view"
        >
          <Compass className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>

      <UploadFab />
    </div>
  );
}

function ClusterPopup({
  cluster,
  onOpen,
  onDeleteMemory,
}: {
  cluster: MemoryCluster;
  onOpen: () => void;
  onDeleteMemory: (m: Memory) => void;
}) {
  const sample = cluster.memories[0];
  const count = cluster.memories.length;
  const multiple = count > 1;
  const isDraft = sample.id.startsWith('draft-');
  const user = useAppStore((s) => s.user);
  const setEditingMemory = useAppStore((s) => s.setEditingMemory);
  const isOwner = user?.name === sample.authorName;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-[215px] sm:w-[260px] text-left text-foreground transition-transform active:scale-[0.99]"
    >
      {sample.photos && sample.photos.length > 0 && (
        <div className="relative aspect-[16/9.5] sm:aspect-[16/10] w-full overflow-hidden rounded-t-xl sm:rounded-t-2xl">
          <img
            src={sample.photos[0].url}
            alt={sample.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
          <div className="absolute inset-x-0 bottom-0 h-10 sm:h-14 bg-gradient-to-t from-background/80 to-transparent" />

          {isOwner && !isDraft && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteMemory(sample);
              }}
              className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-black/40 hover:bg-destructive/80 backdrop-blur-md text-white border border-white/10 transition-colors z-10"
              title="Delete memory"
            >
              <Trash2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            </button>
          )}

          {multiple && (
            <div className="glass absolute left-1.5 top-1.5 sm:left-2 sm:top-2 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium text-foreground shadow-sm">
              <Images className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-primary" />
              {count} memories
            </div>
          )}
        </div>
      )}
      <div className="space-y-1 px-2.5 py-2.5 sm:space-y-1.5 sm:px-3.5 sm:py-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-xs sm:text-[15px] font-semibold leading-tight tracking-tight">
            {sample.title}
          </h3>
          {isDraft && (
            <span className="text-[9px] sm:text-[10px] uppercase tracking-wider font-semibold text-muted-foreground shrink-0 pt-0.5 sm:pt-1">
              Offline
            </span>
          )}
        </div>
        {sample.locationTag && (
          <div className="flex items-center gap-1 text-[10px] sm:text-[11px] text-muted-foreground">
            <MapPin className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-primary shrink-0" />
            <span className="truncate">{sample.locationTag}</span>
            <span className="opacity-60">·</span>
            <span className="shrink-0">{formatDistanceToNow(new Date(sample.createdAt), { addSuffix: true })}</span>
          </div>
        )}
        <p className="line-clamp-2 text-[11px] sm:text-xs leading-relaxed text-foreground/80 pt-0.5">
          {sample.narrative}
        </p>
        <div className="pt-1 text-[10px] sm:text-[11px] font-medium text-primary opacity-80 transition-opacity group-hover:opacity-100 flex items-center justify-between w-full">
          {isDraft ? (
            <span className="text-amber-500">Waiting to sync...</span>
          ) : (
            <>
              <span>{multiple ? `View all ${count} photos →` : "Open details →"}</span>
              {isOwner && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingMemory(sample);
                  }}
                  className="flex items-center gap-1 hover:text-foreground transition-colors px-2 py-0.5 rounded-full hover:bg-primary/10"
                  title="Edit memory"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function LocationPicker() {
  const isPickingLocation = useAppStore((s) => s.isPickingLocation);
  const setIsPickingLocation = useAppStore((s) => s.setIsPickingLocation);
  const setPickedLocation = useAppStore((s) => s.setPickedLocation);
  const setUploadOpen = useAppStore((s) => s.setUploadOpen);
  const map = useMap();

  const cancelPicking = useCallback(() => {
    setIsPickingLocation(false);
  }, [setIsPickingLocation]);

  // Show crosshair cursor while picking
  useEffect(() => {
    if (!isPickingLocation) return;
    map.getContainer().style.cursor = "crosshair";
    return () => {
      map.getContainer().style.cursor = "";
    };
  }, [isPickingLocation, map]);

  // Escape key exits pick mode (desktop/laptop)
  useEffect(() => {
    if (!isPickingLocation) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelPicking();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPickingLocation, cancelPicking]);

  // Browser back button exits pick mode (mobile)
  useEffect(() => {
    if (!isPickingLocation) return;

    // Push a dummy history entry so pressing back pops it instead of navigating away
    history.pushState({ pickingLocation: true }, "");

    const onPopState = () => {
      cancelPicking();
    };

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      // Clean up the dummy entry if we exit pick mode by other means
      if (history.state?.pickingLocation) {
        history.back();
      }
    };
  }, [isPickingLocation, cancelPicking]);

  useMapEvents({
    click(e) {
      if (isPickingLocation) {
        setPickedLocation({ lat: e.latlng.lat, lng: e.latlng.lng });
        setIsPickingLocation(false);
        setUploadOpen(true);
      }
    },
  });

  return null;
}
