import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Compass, Images, MapPin, Minus, Navigation, Plus } from "lucide-react";
import { toast } from "sonner";
import { listMemories } from "@/lib/memories";
import { useAppStore } from "@/lib/store";
import { CollectionBadge } from "./CollectionBadge";
import { UploadFab } from "./UploadFab";
import type { AuthUser, BBox, Memory } from "@/lib/types";

const pinIcon = L.divIcon({
  className: "!bg-transparent !border-0",
  html: `<div class="memory-pin"></div>`,
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
}: {
  clusters: MemoryCluster[];
  onOpenCluster: (key: string) => void;
}) {
  const map = useMap();
  const [centerLng, setCenterLng] = useState<number>(map.getCenter().lng);

  useMapEvents({
    moveend: () => setCenterLng(map.getCenter().lng),
  });

  useEffect(() => {
    setCenterLng(map.getCenter().lng);
  }, [map]);

  return (
    <>
      {clusters.map((c) => {
        const wrappedLng = getWrappedLng(c.lng, centerLng);
        return (
          <Marker key={c.key} position={[c.lat, wrappedLng]} icon={pinIcon}>
            <Popup
              closeButton
              autoPan={false}
              closeOnMapClick={true}
              offset={[0, -20]}
            >
              <ClusterPopup cluster={c} onOpen={() => onOpenCluster(c.key)} />
            </Popup>
          </Marker>
        );
      })}
    </>
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

  const key = useMemo(() => (bbox ? round(bbox) : null), [bbox]);

  const query = useQuery({
    queryKey: ["memories", key],
    queryFn: () => listMemories(bbox!),
    enabled: !!bbox,
    staleTime: 30_000,
  });

  const [allMemories, setAllMemories] = useState<Memory[]>([]);

  useEffect(() => {
    if (!query.data) return;
    setAllMemories((prev) => {
      const map = new Map<string, Memory>();
      for (const m of prev) map.set(m.id, m);
      let changed = false;
      for (const m of query.data) {
        if (!map.has(m.id)) {
          map.set(m.id, m);
          changed = true;
        }
      }
      return changed ? [...map.values()] : prev;
    });
  }, [query.data]);

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
      <UserLocationZoomer />
      <MapControls />
      <ClusterMarkers clusters={clusters} onOpenCluster={setOpenClusterKey} />
    </MapContainer>
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
        () => toast.error("Could not access your location.")
      );
    }
  };

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[500] flex flex-col items-center gap-3 sm:bottom-8 sm:right-8">
      <div className="glass pointer-events-auto flex flex-col rounded-[1.25rem] p-1.5 shadow-xl border border-border/40">
        <button
          type="button"
          onClick={() => map.zoomIn()}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-foreground hover:bg-muted/80 transition-all active:scale-95 cursor-pointer"
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus className="h-5 w-5" />
        </button>
        <div className="mx-2 my-0.5 h-px bg-border/40" />
        <button
          type="button"
          onClick={() => map.zoomOut()}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-foreground hover:bg-muted/80 transition-all active:scale-95 cursor-pointer"
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus className="h-5 w-5" />
        </button>
        <div className="mx-2 my-0.5 h-px bg-border/40" />
        <button
          type="button"
          onClick={handleLocateMe}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-foreground hover:bg-muted/80 transition-all active:scale-95 cursor-pointer"
          title="My location"
          aria-label="My location"
        >
          <Navigation className="h-5 w-5 text-primary" />
        </button>
        <div className="mx-2 my-0.5 h-px bg-border/40" />
        <button
          type="button"
          onClick={() => map.flyTo([30, 5], 3, { duration: 1 })}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-foreground hover:bg-muted/80 transition-all active:scale-95 cursor-pointer"
          title="Reset view"
          aria-label="Reset view"
        >
          <Compass className="h-5 w-5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>

      <UploadFab />
    </div>
  );
}

function ClusterPopup({
  cluster,
  onOpen,
}: {
  cluster: MemoryCluster;
  onOpen: () => void;
}) {
  const sample = cluster.memories[0];
  const count = cluster.memories.length;
  const multiple = count > 1;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-[260px] text-left text-foreground transition-transform active:scale-[0.99]"
    >
      {sample.imageUrl && (
        <div className="relative aspect-[16/10] w-full overflow-hidden">
          <img
            src={sample.imageUrl}
            alt={sample.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
          <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-background/80 to-transparent" />
          {(sample.visibility || sample.collection) && (
            <div className="absolute bottom-2 left-2">
              <CollectionBadge visibility={sample.visibility} collection={sample.collection} />
            </div>
          )}
          {multiple && (
            <div className="glass absolute right-2 top-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
              <Images className="h-3 w-3 text-primary" />
              {count} photos
            </div>
          )}
        </div>
      )}
      <div className="space-y-1.5 px-3.5 py-3">
        <h3 className="font-display text-[15px] font-semibold leading-tight tracking-tight">
          {sample.title}
        </h3>
        {sample.locationTag && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3 text-primary" />
            <span className="truncate">{sample.locationTag}</span>
            <span className="opacity-60">·</span>
            <span>{formatDistanceToNow(new Date(sample.createdAt), { addSuffix: true })}</span>
          </div>
        )}
        <p className="line-clamp-2 pt-1 text-xs leading-relaxed text-foreground/80">
          {sample.narrative}
        </p>
        <div className="pt-1.5 text-[11px] font-medium text-primary opacity-80 transition-opacity group-hover:opacity-100">
          {multiple ? `View all ${count} photos →` : "Open details →"}
        </div>
      </div>
    </button>
  );
}
