import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Marker, Popup, ViewStateChangeEvent, MapRef, MapProvider } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { setWorkerUrl, setWorkerCount, prewarm, config as maplibreConfig } from "maplibre-gl";
import MapLibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(MapLibreWorkerUrl);
// Dynamically scale worker threads based on available CPU hardware concurrency (min 2, max 8)
const optimalWorkerCount =
  typeof navigator !== "undefined" && navigator.hardwareConcurrency
    ? Math.min(Math.max(navigator.hardwareConcurrency - 1, 2), 8)
    : 4;
setWorkerCount(optimalWorkerCount);
// Pre-spawn all workers immediately so the map is ready the moment it mounts
prewarm();

// Maximize parallel image requests so raster satellite tiles don't get throttled
maplibreConfig.MAX_PARALLEL_IMAGE_REQUESTS = 128;
maplibreConfig.MAX_PARALLEL_IMAGE_REQUESTS_PER_FRAME = 64;
// Retain up to 16 zoom levels of ancestor tiles in the pyramid cache for instant blur-up previews during rapid zoom
maplibreConfig.MAX_TILE_CACHE_ZOOM_LEVELS = 16;

export const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_API_KEY || "3pLaY3WqeKXPqQvGUWll";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useIsDarkTheme } from "@/hooks/use-theme";
import { Compass, Images, MapPin, Minus, Navigation, Plus, Trash2, Loader2, Pencil, CloudOff, Globe } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { deleteMemory, listMemories } from "@/lib/memories";
import { listDrafts, draftToMemory, revokeDraftBlobUrls } from "@/lib/drafts";
import { getOfflineMemoriesInBBox, saveOfflineMemories } from "@/lib/offline";
import { PredictiveSatellitePrewarmer, ViewportVelocityTracker } from "@/lib/tilePrewarmer";
import { useAppStore } from "@/lib/store";
import { UploadFab } from "./UploadFab";
import { OfflineDownloader } from "./OfflineDownloader";
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
import type { AuthUser, BBox, Memory, MemoryCluster } from "@/lib/types";

import { clusterKey, buildClusters } from "@/lib/clusters";
export { clusterKey, buildClusters };

function round(b: BBox): BBox {
  // Round to 1 decimal place (~11km) to create highly stable cache keys. 
  // Panning slightly won't constantly bust the React Query cache!
  const r = (n: number) => Math.round(n * 10) / 10;
  return { minLng: r(b.minLng), minLat: r(b.minLat), maxLng: r(b.maxLng), maxLat: r(b.maxLat) };
}


export function MapCanvas({
  onMemories,
  onCenter,
}: {
  onMemories: (m: Memory[]) => void;
  onCenter: (c: { lat: number; lng: number } | null) => void;
}) {
  return (
    <MapProvider>
      <MapCanvasInner onMemories={onMemories} onCenter={onCenter} />
    </MapProvider>
  );
}

function MapCanvasInner({
  onMemories,
  onCenter,
}: {
  onMemories: (m: Memory[]) => void;
  onCenter: (c: { lat: number; lng: number } | null) => void;
}) {
  const mapRef = useRef<MapRef>(null);
  const [bbox, setBbox] = useState<BBox | null>(null);
  const isDark = useIsDarkTheme();
  const [mapMode, setMapMode] = useState<"vector" | "satellite">("vector");
  const mapModeRef = useRef(mapMode);
  mapModeRef.current = mapMode;
  
  // Base map style always stays mounted (no heavy WebGL teardown when toggling satellite!)
  const mapStyleId = isDark ? "dataviz-dark" : "dataviz-light";
  const [styleObject, setStyleObject] = useState<any>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = localStorage.getItem("atlas-theme");
      const currentDark = stored === "dark" || (stored !== "light" && (
        typeof document !== "undefined" && (document.documentElement.classList.contains("dark") || window.matchMedia("(prefers-color-scheme: dark)").matches)
      ));
      const targetId = currentDark ? "dataviz-dark" : "dataviz-light";
      const cached = sessionStorage.getItem(`waypoint_unified_style_v6_${targetId}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {}
    return null;
  });
  const styleCacheRef = useRef<Record<string, any>>({});
  const satelliteOverlayIdsRef = useRef<string[]>([]);
  const fadeTimeoutRef = useRef<number | null>(null);

  // Predictive Satellite Prewarming engine (strictly prewarms satellite tiles for predicted final viewport)
  const prewarmerRef = useRef<PredictiveSatellitePrewarmer>(new PredictiveSatellitePrewarmer(MAPTILER_KEY));
  const velocityTrackerRef = useRef<ViewportVelocityTracker>(new ViewportVelocityTracker());

  useEffect(() => {
    if (prewarmerRef.current) {
      prewarmerRef.current.setForegroundPressureCallback(() => {
        const map = mapRef.current?.getMap();
        return map ? map.areTilesLoaded() : true;
      });
    }
  }, []);

  // Helper to construct a unified style containing:
  // 1. All clean, pristine vector layers for vector mode (paint & layout properties untouched so buildings & 3D details never disappear!)
  // 2. All authentic Satellite Hybrid layers for satellite mode (positioned above vector layers)
  // 3. Progressive two-tier satellite rendering: instant low-res backdrop (maxzoom 8) + smooth high-res layer (maxzoom 22)
  const prepareStyle = useCallback((baseStyle: any, hybridStyle: any) => {
    const s = JSON.parse(JSON.stringify(baseStyle));
    if (s.sprite && s.sprite.startsWith("/")) {
      s.sprite = window.location.origin + s.sprite;
    }
    if (s.glyphs && s.glyphs.startsWith("/")) {
      s.glyphs = window.location.origin + s.glyphs;
    }
    if (s.sources) {
      for (const key of Object.keys(s.sources)) {
        const src = s.sources[key];
        if (src.url && src.url.startsWith("/")) {
          src.url = window.location.origin + src.url;
        }
      }

      // Inline direct MapTiler satellite raster sources:
      // 1. Low-res satellite backdrop source (512x512, maxzoom 12)
      //    At zoom 12, a single tile covers ~10km and is ~75KB.
      //    In any neighborhood/city viewport, 1 single tile covers the entire screen,
      //    loading in ~40ms to provide an authentic photographic preview with visible terrain,
      //    rivers, roads and landmarks before high-res tiles stream in.
      s.sources.satellite_base = {
        type: "raster",
        tiles: [`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}&base=true`],
        tileSize: 512,
        minzoom: 0,
        maxzoom: 12,
      };

      // 2. High-res satellite raster source (512x512 progressive tiles, maxzoom 22)
      //    Directly streams over HTTP/3 & HTTP/2 from Cloudflare Anycast CDN with zero proxy latency
      s.sources.satellite = {
        type: "raster",
        tiles: [`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`],
        tileSize: 512,
        minzoom: 0,
        maxzoom: 22,
        attribution:
          '<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>',
      };

      // Direct vector planet tiles if not already pointing directly to MapTiler
      if (s.sources.maptiler_planet && s.sources.maptiler_planet.type === "vector") {
        delete s.sources.maptiler_planet.url; // Force direct tile URLs instead of hitting tiles.json proxy
        s.sources.maptiler_planet.tiles = [`https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=${MAPTILER_KEY}`];
        s.sources.maptiler_planet.minzoom = 0;
        s.sources.maptiler_planet.maxzoom = 15;
      }
    }

    // 1. Vector layers: ensure all vector layers are visible and their paint styles 100% pristine
    s.layers.forEach((l: any) => {
      if (!l.layout) l.layout = {};
      l.layout.visibility = "visible";
    });

    // 2. Inject the Satellite Hybrid layers positioned above the vector layers
    if (hybridStyle && hybridStyle.layers) {
      const isCurrentSat = mapModeRef.current === "satellite";
      const satOverlayIds: string[] = [];
      hybridStyle.layers.forEach((hl: any) => {
        const satLayer = JSON.parse(JSON.stringify(hl));
        satLayer.id = "sat_" + satLayer.id;

        if (satLayer.id === "sat_Satellite") {
          // Low-res satellite backdrop layer: positioned directly underneath the high-res satellite layer.
          // Keep visibility visible so MapLibre quietly loads the single 35KB low-res tile in the background
          // as the user pans around in vector mode. When switching to satellite mode, it renders in 0ms!
          const satBaseLayer = {
            id: "sat_Satellite_base",
            type: "raster",
            source: "satellite_base",
            paint: {
              "raster-opacity": isCurrentSat ? 1 : 0,
              "raster-resampling": "linear",
              "raster-fade-duration": 0,
            },
            layout: {
              visibility: "visible",
            },
          };
          s.layers.push(satBaseLayer);

          // High-res satellite layer with linear resampling and smooth fade-in over the low-res backdrop
          satLayer.paint = {
            "raster-opacity": isCurrentSat ? 0.99 : 0,
            "raster-resampling": "linear",
            "raster-fade-duration": 300,
          };
          satLayer.layout = {
            visibility: isCurrentSat ? "visible" : "none",
          };
          s.layers.push(satLayer);
        } else {
          // Satellite hybrid overlays (roads, labels, borders)
          satOverlayIds.push(satLayer.id);
          if (!satLayer.layout) satLayer.layout = {};
          satLayer.layout.visibility = isCurrentSat ? "visible" : "none";
          
          // Use loaded font stacks so zero extra font round-trips occur
          if (satLayer.type === "symbol") {
            satLayer.layout["text-font"] = ["Metropolis Semi Bold", "Noto Sans Bold"];
          }
          s.layers.push(satLayer);
        }
      });
      satelliteOverlayIdsRef.current = satOverlayIds;
    }

    return s;
  }, []);

  // Pre-fetch all styles directly from MapTiler Edge CDN on mount (with fallback to local proxy/offline)
  useEffect(() => {
    const fetchStyle = async (id: string) => {
      // 1. Direct from MapTiler CDN (multiplexed HTTP/2 / HTTP/3 from edge)
      try {
        const directRes = await fetch(`https://api.maptiler.com/maps/${id}/style.json?key=${MAPTILER_KEY}`);
        if (directRes.ok) return await directRes.json();
      } catch (err) {
        console.warn(`Direct fetch for ${id} style failed, falling back:`, err);
      }
      // 2. Fallback to local Go proxy or offline Service Worker cache
      try {
        const localRes = await fetch(`/api/v1/map/style?id=${id}`);
        if (localRes.ok) return await localRes.json();
      } catch {}
      return null;
    };

    Promise.all([
      fetchStyle("dataviz-dark"),
      fetchStyle("dataviz-light"),
      fetchStyle("hybrid"),
    ])
      .then(([dark, light, hybrid]) => {
        if (!dark || !light || !hybrid) return;
        const preparedDark = prepareStyle(dark, hybrid);
        const preparedLight = prepareStyle(light, hybrid);
        styleCacheRef.current["dataviz-dark"] = preparedDark;
        styleCacheRef.current["dataviz-light"] = preparedLight;
        
        try {
          sessionStorage.setItem("waypoint_unified_style_v6_dataviz-dark", JSON.stringify(preparedDark));
          sessionStorage.setItem("waypoint_unified_style_v6_dataviz-light", JSON.stringify(preparedLight));
        } catch {}

        // Dynamically get current theme rather than stale initial value
        const stored = typeof localStorage !== "undefined" ? localStorage.getItem("atlas-theme") : null;
        const currentDark = stored === "dark" || (stored !== "light" && (
          typeof document !== "undefined" && (document.documentElement.classList.contains("dark") || window.matchMedia("(prefers-color-scheme: dark)").matches)
        ));
        const currentStyleId = currentDark ? "dataviz-dark" : "dataviz-light";
        setStyleObject(styleCacheRef.current[currentStyleId]);
      })
      .catch((err) => console.warn("Failed to load map styles:", err));
  }, [prepareStyle]);

  // When theme changes between dark and light:
  useEffect(() => {
    if (styleCacheRef.current[mapStyleId]) {
      setStyleObject(styleCacheRef.current[mapStyleId]);
    }
  }, [mapStyleId]);

  // Clean show/hide toggle between Vector and Satellite view
  const applyMapMode = useCallback((mode: "vector" | "satellite") => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    // Layer must exist in map style before toggling properties
    if (!map.style || !map.getLayer("sat_Satellite") || !map.getLayer("sat_Satellite_base")) {
      window.setTimeout(() => applyMapMode(mode), 50);
      window.setTimeout(() => applyMapMode(mode), 150);
      return;
    }

    if (fadeTimeoutRef.current) {
      window.clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = null;
    }

    const isSat = mode === "satellite";

    try {
      if (isSat) {
        if (map.getLayer("sat_Satellite_base")) {
          map.setLayoutProperty("sat_Satellite_base", "visibility", "visible");
          map.setPaintProperty("sat_Satellite_base", "raster-opacity", 1);
        }
        if (map.getLayer("sat_Satellite")) {
          map.setLayoutProperty("sat_Satellite", "visibility", "visible");
          map.setPaintProperty("sat_Satellite", "raster-opacity", 0.99);
        }

        const overlayIds = satelliteOverlayIdsRef.current.length > 0
          ? satelliteOverlayIdsRef.current
          : (map.getStyle()?.layers || [])
              .map((l: any) => l.id)
              .filter((id: string) => id.startsWith("sat_") && id !== "sat_Satellite" && id !== "sat_Satellite_base");

        overlayIds.forEach((id: string) => {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, "visibility", "visible");
          }
        });

        map.triggerRepaint();
      } else {
        if (map.getLayer("sat_Satellite_base")) {
          // Keep visibility visible so MapLibre quietly maintains the 1 low-res tile in cache for current area
          map.setLayoutProperty("sat_Satellite_base", "visibility", "visible");
          map.setPaintProperty("sat_Satellite_base", "raster-opacity", 0);
        }
        if (map.getLayer("sat_Satellite")) {
          map.setLayoutProperty("sat_Satellite", "visibility", "none");
          map.setPaintProperty("sat_Satellite", "raster-opacity", 0);
        }

        const overlayIds = satelliteOverlayIdsRef.current.length > 0
          ? satelliteOverlayIdsRef.current
          : (map.getStyle()?.layers || [])
              .map((l: any) => l.id)
              .filter((id: string) => id.startsWith("sat_") && id !== "sat_Satellite" && id !== "sat_Satellite_base");

        overlayIds.forEach((id: string) => {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, "visibility", "none");
          }
        });

        map.triggerRepaint();
      }
    } catch (err) {
      console.warn("Could not apply map mode:", err);
    }
  }, []);

  useEffect(() => {
    applyMapMode(mapMode);
    // When switching map modes, ensure current viewport satellite tiles are prewarmed
    const map = mapRef.current?.getMap();
    if (map && prewarmerRef.current) {
      try {
        const bounds = map.getBounds();
        if (bounds) {
          prewarmerRef.current.prewarmTier1(
            {
              minLng: bounds.getWest(),
              minLat: bounds.getSouth(),
              maxLng: bounds.getEast(),
              maxLat: bounds.getNorth(),
            },
            map.getZoom()
          );
        }
      } catch {}
    }
  }, [mapMode, styleObject, applyMapMode]);

  useEffect(() => {
    return () => {
      if (fadeTimeoutRef.current) {
        window.clearTimeout(fadeTimeoutRef.current);
      }
    };
  }, []);

  // Offline detection: gracefully fallback to vector map if satellite is selected while offline
  useEffect(() => {
    const handleOffline = () => {
      if (mapMode === "satellite") {
        setMapMode("vector");
        toast.info("Offline mode active: switched to downloaded vector map");
      }
    };
    window.addEventListener("offline", handleOffline);
    if (!navigator.onLine && mapMode === "satellite") {
      setMapMode("vector");
    }
    return () => window.removeEventListener("offline", handleOffline);
  }, [mapMode]);


  const setBBoxStore = useAppStore((s) => s.setBBox);
  const setOpenClusterKey = useAppStore((s) => s.setOpenClusterKey);
  const debounceRef = useRef<number | null>(null);

  // User's current GPS location (persisted in localStorage for instant rendering on refresh)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = localStorage.getItem("waypoint_user_location");
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });
  const [showLocationPopup, setShowLocationPopup] = useState(false);

  const computeExpandedBBox = useCallback((map: any) => {
    try {
      const b = map.getBounds();
      const c = map.getCenter();
      if (!b || !c) return null;

      const lngSpan = b.getEast() - b.getWest();
      const latSpan = b.getNorth() - b.getSouth();

      return {
        bbox: {
          minLng: b.getWest() - lngSpan,
          minLat: b.getSouth() - latSpan,
          maxLng: b.getEast() + lngSpan,
          maxLat: b.getNorth() + latSpan,
        },
        center: { lat: c.lat, lng: c.lng },
      };
    } catch {
      return null;
    }
  }, []);

  const updateViewportBBox = useCallback((mapInstance?: any) => {
    const map = mapInstance || mapRef.current?.getMap();
    if (!map) return;
    const computed = computeExpandedBBox(map);
    if (!computed) return;

    onCenter(computed.center);
    setBbox(computed.bbox);
    setBBoxStore(computed.bbox);
  }, [computeExpandedBBox, onCenter, setBBoxStore]);

  const requestUserLocation = useCallback((flyToLocation = false) => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        try {
          localStorage.setItem("waypoint_user_location", JSON.stringify(loc));
        } catch {}

        if (flyToLocation && mapRef.current) {
          mapRef.current.flyTo({
            center: [loc.lng, loc.lat],
            zoom: 14,
            duration: 1500,
          });
        }
      },
      (err) => {
        console.warn("[Geolocation] Could not access location:", err.message);
        if (flyToLocation) {
          toast.error("Could not access your location. Please check browser permissions.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  }, []);

  // Request user location on initial mount (refresh) and track with watchPosition
  useEffect(() => {
    requestUserLocation(false);

    if (typeof window !== "undefined" && "geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLocation(loc);
          try {
            localStorage.setItem("waypoint_user_location", JSON.stringify(loc));
          } catch {}
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 27000 }
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, [requestUserLocation]);

  const handleLocateMe = useCallback(() => {
    if (userLocation && mapRef.current) {
      mapRef.current.flyTo({
        center: [userLocation.lng, userLocation.lat],
        zoom: 14,
        duration: 1500,
      });
    }
    requestUserLocation(true);
  }, [userLocation, requestUserLocation]);

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

  // When user logs in or auth changes:
  // 1. Calculate bounding box immediately and fetch waypoints without needing a manual pan
  // 2. Invalidate memories & drafts cache
  // 3. Refresh user location
  useEffect(() => {
    if (user) {
      updateViewportBBox();
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["drafts"] });
      requestUserLocation(false);
    }
  }, [user, updateViewportBBox, qc, requestUserLocation]);
  const isPickingLocation = useAppStore((s) => s.isPickingLocation);
  const setIsPickingLocation = useAppStore((s) => s.setIsPickingLocation);
  const setPickedLocation = useAppStore((s) => s.setPickedLocation);
  const setUploadOpen = useAppStore((s) => s.setUploadOpen);

  const query = useQuery({
    queryKey: ["memories", key],
    queryFn: () => listMemories(bbox!),
    enabled: !!bbox && !!user,
    staleTime: 30_000,
  });

  const userName = user?.name;
  const draftsQuery = useQuery({
    queryKey: ["drafts"],
    networkMode: "always",
    queryFn: async () => {
      const drafts = await listDrafts();
      return drafts.map((d) => draftToMemory(d, userName ?? undefined));
    },
    enabled: !!user,
    staleTime: 5_000,
  });

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

  const [serverClusters, setServerClusters] = useState<MemoryCluster[]>([]);
  const [offlineMemories, setOfflineMemories] = useState<Memory[]>([]);

  useEffect(() => {
    if (query.data) {
      setServerClusters(buildClusters(query.data));
      // Save flat memories for offline store persistence
      if (query.data.length > 0) {
        saveOfflineMemories(query.data);
      }
    }
  }, [query.data]);

  // When offline or navigating cached regions, seamlessly load memories from offline store
  useEffect(() => {
    if (!bbox) return;
    let isCancelled = false;
    getOfflineMemoriesInBBox(bbox).then((offline) => {
      if (isCancelled || offline.length === 0) return;
      setOfflineMemories((prev) => {
        const map = new Map<string, Memory>();
        offline.forEach((m) => map.set(m.id, m));
        prev.forEach((m) => map.set(m.id, m));
        return Array.from(map.values());
      });
    });
    return () => {
      isCancelled = true;
    };
  }, [bbox]);

  const activeSearchMemory = useAppStore((s) => s.activeSearchMemory);

  const clusters = useMemo(() => {
    if (!user) return [];
    const drafts = draftsQuery.data ?? [];

    // 1. Online: Use server-calculated clusters directly from Go backend.
    // 2. Offline fallback: Cluster local IndexedDB memories on the client.
    let baseClusters: MemoryCluster[] = [];
    if (serverClusters.length > 0) {
      baseClusters = serverClusters;
    } else if (offlineMemories.length > 0) {
      baseClusters = buildClusters(offlineMemories);
    }

    if (drafts.length === 0 && !activeSearchMemory) {
      return baseClusters;
    }

    // Merge un-synced drafts or active search item into the clusters
    const map = new Map<string, MemoryCluster>();
    for (const c of baseClusters) {
      map.set(c.key, { ...c, memories: [...c.memories] });
    }

    const extraMemories = [...drafts];
    if (activeSearchMemory && !extraMemories.some((m) => m.id === activeSearchMemory.id)) {
      extraMemories.push(activeSearchMemory);
    }

    for (const d of extraMemories) {
      const k = clusterKey(d);
      const existing = map.get(k);
      if (existing) {
        if (!existing.memories.some((m) => m.id === d.id)) {
          existing.memories.unshift(d);
          existing.count = existing.memories.length;
        }
      } else {
        map.set(k, { key: k, lat: d.lat, lng: d.lng, count: 1, memories: [d] });
      }
    }

    return Array.from(map.values());
  }, [user, serverClusters, offlineMemories, draftsQuery.data, activeSearchMemory]);

  const allMemories = useMemo(() => {
    return clusters.flatMap((c) => c.memories);
  }, [clusters]);

  const onMemoriesRef = useRef(onMemories);
  onMemoriesRef.current = onMemories;
  useEffect(() => {
    if (allMemories.length > 0) onMemoriesRef.current(allMemories);
  }, [allMemories]);

  const handleDragStart = useCallback(() => {
    velocityTrackerRef.current.clear();
    if (prewarmerRef.current) {
      prewarmerRef.current.abortPending();
    }
  }, []);

  const handleDrag = useCallback((e: ViewStateChangeEvent) => {
    const map = e.target;
    const center = map.getCenter();
    if (center) {
      velocityTrackerRef.current.record(center.lng, center.lat, map.getZoom());
    }
  }, []);

  // When user releases the map drag, immediately predict where inertia will come to rest
  // and prefetch satellite tiles for the final destination viewport!
  const handleDragEnd = useCallback((e: ViewStateChangeEvent) => {
    const map = e.target;
    const center = map.getCenter();
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const result = velocityTrackerRef.current.getVelocityAndConfidence();

    if (center && bounds && result && prewarmerRef.current) {
      const { velocity, confidence } = result;
      const isFling = velocity.speed >= 0.00007 || Math.abs(velocity.vZoom) >= 0.001;
      
      if (isFling) {
        prewarmerRef.current.prefetchPredictedViewport(
          { lng: center.lng, lat: center.lat },
          {
            minLng: bounds.getWest(),
            minLat: bounds.getSouth(),
            maxLng: bounds.getEast(),
            maxLat: bounds.getNorth(),
          },
          zoom,
          velocity,
          confidence
        );
      }
    }
  }, []);

  const handleMove = useCallback((e: ViewStateChangeEvent) => {
    const map = e.target;
    const computed = computeExpandedBBox(map);
    if (computed) {
      onCenter(computed.center);

      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        setBbox(computed.bbox);
        setBBoxStore(computed.bbox);
      }, 150);
    }

    // Predictive Satellite Prewarming: record continuous pan/zoom velocity during flings
    try {
      const center = map.getCenter();
      if (center) {
        velocityTrackerRef.current.record(center.lng, center.lat, map.getZoom());
        const result = velocityTrackerRef.current.getVelocityAndConfidence();

        // Always feed continuous motion to the prediction engine.
        // The engine internally uses zoom-normalized physics (px/ms) and throttles itself.
        if (result && prewarmerRef.current) {
          const { velocity, confidence } = result;
          const bounds = map.getBounds();
          if (bounds) {
            prewarmerRef.current.prefetchPredictedViewport(
              { lng: center.lng, lat: center.lat },
              {
                minLng: bounds.getWest(),
                minLat: bounds.getSouth(),
                maxLng: bounds.getEast(),
                maxLat: bounds.getNorth(),
              },
              map.getZoom(),
              velocity,
              confidence
            );
          }
        }
      }
    } catch {}
  }, [computeExpandedBBox, onCenter, setBBoxStore]);

  const handleMoveEnd = useCallback((e: ViewStateChangeEvent) => {
    const map = e.target;
    updateViewportBBox(map);

    // Clear velocity samples now that motion has stopped
    velocityTrackerRef.current.clear();

    // Prewarm satellite tiles for the settled viewport under strict budget
    try {
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      if (bounds && prewarmerRef.current) {
        prewarmerRef.current.prewarmTier1(
          {
            minLng: bounds.getWest(),
            minLat: bounds.getSouth(),
            maxLng: bounds.getEast(),
            maxLat: bounds.getNorth(),
          },
          zoom
        );
      }
    } catch {}
  }, [updateViewportBBox]);

  // Synchronize satellite & hybrid overlay visibility only when style loads or changes
  const handleStyleData = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !map.style || !map.getLayer("sat_Satellite") || !map.getLayer("sat_Satellite_base")) return;
    const isSat = mapMode === "satellite";
    const currentVis = map.getLayoutProperty("sat_Satellite", "visibility");
    const targetVis = isSat ? "visible" : "none";
    if (currentVis !== targetVis) {
      applyMapMode(mapMode);
    }
  }, [mapMode, applyMapMode]);

  // Handle zooming to actively searched memory
  const activeSearchPopupId = useAppStore((s) => s.activeSearchPopupId);
  const setActiveSearchPopupId = useAppStore((s) => s.setActiveSearchPopupId);

  useEffect(() => {
    if (activeSearchPopupId && mapRef.current) {
      const cluster = clusters.find(c => c.key === activeSearchPopupId || c.memories.some(m => m.id === activeSearchPopupId));
      if (cluster) {
        mapRef.current.panTo([cluster.lng, cluster.lat], { duration: 1000 });
      } else if (activeSearchMemory && activeSearchMemory.id === activeSearchPopupId) {
        mapRef.current.panTo([activeSearchMemory.lng, activeSearchMemory.lat], { duration: 1000 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSearchPopupId, activeSearchMemory]);

  // Location Picker logic
  useEffect(() => {
    if (!isPickingLocation) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsPickingLocation(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPickingLocation, setIsPickingLocation]);

  const isDarkVector = isDark && mapMode === "vector";

  return (
    <div className={`fixed inset-0 h-screen w-screen ${isPickingLocation ? 'cursor-crosshair' : ''} ${isDarkVector ? 'dark-map-filter' : ''}`}>
      <style>{`
        .dark-map-filter .maplibregl-canvas {
          filter: brightness(0.9) contrast(1.05) saturate(1.1);
        }
        .maplibregl-canvas {
          transition: filter 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .maplibregl-popup-content {
          background: none !important;
          padding: 0 !important;
          box-shadow: none !important;
        }
        .maplibregl-popup-tip {
          display: none !important;
        }
      `}</style>
      <MapGL
        id="main-map"
        ref={mapRef}
        initialViewState={{
          longitude: 5,
          latitude: 30,
          zoom: 3
        }}
        minZoom={2.5}
        padding={{ top: 100, bottom: 40, left: 20, right: 20 }}
        mapStyle={styleObject || `https://api.maptiler.com/maps/${mapStyleId}/style.json?key=${MAPTILER_KEY}`}
        onError={(e) => console.error("MapGL Error:", e.error)}
        onLoad={(e) => {
          const map = e.target;
          (window as any).__map = map;
          updateViewportBBox(map);
          applyMapMode(mapMode);
          setTimeout(() => updateViewportBBox(map), 100);

          // Initial prefetch of satellite tiles for starting viewport
          try {
            const bounds = map.getBounds();
            if (bounds && prewarmerRef.current) {
              prewarmerRef.current.prewarmTier1(
                {
                  minLng: bounds.getWest(),
                  minLat: bounds.getSouth(),
                  maxLng: bounds.getEast(),
                  maxLat: bounds.getNorth(),
                },
                map.getZoom()
              );
            }
          } catch {}
        }}
        onStyleData={handleStyleData}
        // --- Smooth vector & satellite rendering & performance ---
        fadeDuration={150}         // snappy 150ms tile transition
        maxTileCacheSize={2000}    // keep up to 2000 tiles in GPU memory while panning
        refreshExpiredTiles={false} // don't refetch tiles that have an Expires header
        reuseMaps={true}           // keep the WebGL context alive between style swaps
        canvasContextAttributes={{
          powerPreference: "high-performance",
          preserveDrawingBuffer: false,
          antialias: true,
        }}
        transformRequest={(url) => {
          if (url.startsWith('/api/')) {
            return { url: `${window.location.origin}${url}` };
          }
          return { url };
        }}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        onClick={(e) => {
          if (isPickingLocation) {
            setPickedLocation({ lat: e.lngLat.lat, lng: e.lngLat.lng });
            setIsPickingLocation(false);
            setUploadOpen(true);
          }
        }}
      >
        {/* User's Current GPS Location Beacon */}
        {userLocation && (
          <Marker
            longitude={userLocation.lng}
            latitude={userLocation.lat}
            anchor="center"
            style={{ zIndex: 40 }}
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setShowLocationPopup((prev) => !prev);
            }}
          >
            <div
              className="current-location-marker group"
              title="Your current location"
            >
              <div className="current-location-pulse" />
              <div className="current-location-halo" />
              <div className="current-location-core">
                <div className="current-location-dot" />
              </div>
            </div>
          </Marker>
        )}

        {showLocationPopup && userLocation && (
          <Popup
            longitude={userLocation.lng}
            latitude={userLocation.lat}
            anchor="bottom"
            offset={[0, -18]}
            closeButton={false}
            closeOnClick={true}
            onClose={() => setShowLocationPopup(false)}
          >
            <div className="glass rounded-xl px-3 py-2 text-xs font-medium text-foreground shadow-xl flex items-center gap-2 border border-border/50">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              <span>Your Current Location</span>
            </div>
          </Popup>
        )}

        {clusters.map((c) => (
          <Marker
            key={c.key}
            longitude={c.lng}
            latitude={c.lat}
            anchor="bottom"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              if (activeSearchPopupId === c.key) {
                setActiveSearchPopupId(null);
              } else {
                setActiveSearchPopupId(c.key); // Using cluster key as the active popup ID for MapLibre
              }
            }}
          >
            <div className={`memory-pin ${c.memories.some(m => m.id?.startsWith('draft-')) ? 'draft-pin' : ''}`}>
              {c.count > 1 && (
                <span className="pin-badge">{c.count}</span>
              )}
            </div>
          </Marker>
        ))}

        {activeSearchPopupId && (
          <Popup
            longitude={clusters.find(c => c.key === activeSearchPopupId || c.memories.some(m => m.id === activeSearchPopupId))?.lng || (activeSearchMemory?.id === activeSearchPopupId ? activeSearchMemory.lng : 0)}
            latitude={clusters.find(c => c.key === activeSearchPopupId || c.memories.some(m => m.id === activeSearchPopupId))?.lat || (activeSearchMemory?.id === activeSearchPopupId ? activeSearchMemory.lat : 0)}
            anchor="bottom"
            offset={[0, -32]}
            closeButton={false}
            closeOnClick={true}
            onClose={() => setActiveSearchPopupId(null)}
          >
            {(() => {
              const cluster = clusters.find(c => c.key === activeSearchPopupId || c.memories.some(m => m.id === activeSearchPopupId));
              if (!cluster) return null;
              return (
                <ClusterPopup 
                  cluster={cluster} 
                  onOpen={() => {
                    if (!user) {
                      toast("Please sign in or create an account to view full memory details and photos.");
                      return;
                    }
                    setOpenClusterKey(cluster.key);
                  }} 
                  onDeleteMemory={(m) => setMemoryToDelete(m)} 
                />
              );
            })()}
          </Popup>
        )}
      </MapGL>

      <MapControls 
        mapRef={mapRef} 
        mapMode={mapMode} 
        setMapMode={setMapMode} 
        onLocateMe={handleLocateMe}
      />

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
    </div>
  );
}

function MapControls({ 
  mapRef, 
  mapMode, 
  setMapMode,
  onLocateMe,
}: { 
  mapRef: React.RefObject<MapRef | null>;
  mapMode: "vector" | "satellite";
  setMapMode: React.Dispatch<React.SetStateAction<"vector" | "satellite">>;
  onLocateMe?: () => void;
}) {
  const handleLocateMe = () => {
    if (onLocateMe) {
      onLocateMe();
      return;
    }
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          mapRef.current?.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude],
            zoom: 14,
            duration: 1500
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
          onClick={() => mapRef.current?.zoomIn()}
          className="flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl text-foreground hover:bg-muted/80 transition-all active:scale-95 cursor-pointer"
          title="Zoom in"
        >
          <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>
        <div className="mx-1.5 sm:mx-2 my-0.5 h-px bg-border/40" />
        <button
          type="button"
          onClick={() => mapRef.current?.zoomOut()}
          className="flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl text-foreground hover:bg-muted/80 transition-all active:scale-95 cursor-pointer"
          title="Zoom out"
        >
          <Minus className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>
        <div className="mx-1.5 sm:mx-2 my-0.5 h-px bg-border/40" />
        <button
          type="button"
          onClick={handleLocateMe}
          className="flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl text-foreground hover:bg-muted/80 transition-all active:scale-95 cursor-pointer"
          title="My location"
        >
          <Navigation className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>
        <div className="mx-1.5 sm:mx-2 my-0.5 h-px bg-border/40" />
        <button
          type="button"
          onClick={() => {
            if (!navigator.onLine) {
              toast.info("Satellite view requires an active internet connection.");
              return;
            }
            setMapMode(s => s === "vector" ? "satellite" : "vector");
          }}
          className={`flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl transition-all active:scale-95 cursor-pointer ${mapMode === 'satellite' ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-muted/80'}`}
          title="Toggle Satellite View"
        >
          <Globe className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>
        <div className="mx-1.5 sm:mx-2 my-0.5 h-px bg-border/40" />
        <button
          type="button"
          onClick={() => mapRef.current?.flyTo({ center: [5, 30], zoom: 3, duration: 1000 })}
          className="flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl text-foreground hover:bg-muted/80 transition-all active:scale-95 cursor-pointer"
          title="Reset view"
        >
          <Compass className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>
      <OfflineDownloader />
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
      className="group block w-[215px] sm:w-[260px] text-left text-foreground transition-transform active:scale-[0.99] p-0 border-0 bg-transparent"
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
      <div className="space-y-1 px-2.5 py-2.5 sm:space-y-1.5 sm:px-3.5 sm:py-3 bg-card rounded-b-xl sm:rounded-b-2xl border border-t-0 border-border/40">
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
