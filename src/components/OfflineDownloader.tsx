import { useState, useEffect, useRef } from "react";
import { CloudDownload, Loader2, MapPin, CheckCircle2, Globe, ArrowLeft, Download, Navigation, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import { useMap } from "react-map-gl/maplibre";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { searchLocation, downloadOfflineRegion, estimateDownloadSize, saveRegion, getSavedRegions, deleteRegion, clearRegionCache, type GeoResult, type SavedRegion } from "@/lib/offline";
import { toast } from "@/hooks/use-toast";
import type { BBox } from "@/lib/types";

export function OfflineDownloader() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeoResult[]>([]);
  const [savedRegions, setSavedRegions] = useState<SavedRegion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedResult, setSelectedResult] = useState<GeoResult | null>(null);

  const [isDownloading, setIsDownloading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");

  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const queryClient = useQueryClient();
  const { current: map, "main-map": mainMap } = useMap();
  const activeMap = map || mainMap;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Debounced autocomplete
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    // When offline, searchLocation handles searching locally saved regions
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await searchLocation(query);
        setSuggestions(res);
      } catch {
        // silently fail
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleSelect = (result: GeoResult) => {
    setSelectedResult(result);
  };

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleDownload = async () => {
    if (!selectedResult) return;
    setIsDownloading(true);
    setIsDone(false);
    setProgress(0);
    setStatus("Starting download...");

    abortControllerRef.current = new AbortController();

    try {
      const success = await downloadOfflineRegion(
        selectedResult.bbox, 
        dark, 
        queryClient, 
        (stat, pct) => {
          setStatus(stat);
          setProgress(pct);
        },
        abortControllerRef.current.signal
      );
      
      if (!success) {
        // Download was aborted
        await clearRegionCache(selectedResult.bbox);
        return;
      }
      
      const { mb } = estimateDownloadSize(selectedResult.bbox);
      saveRegion({
        id: selectedResult.name,
        name: selectedResult.name,
        bbox: selectedResult.bbox,
        mb,
        downloadedAt: Date.now()
      });
      setSavedRegions(getSavedRegions());
      
      setIsDone(true);
      toast.success(`Downloaded "${selectedResult.name.split(",")[0]}" for offline use!`);
      setTimeout(() => {
        setOpen(false);
        resetState();
      }, 1500);
    } catch {
      toast.error("Failed to complete the download.");
      setIsDownloading(false);
    }
  };

  const resetState = () => {
    setQuery("");
    setSuggestions([]);
    setSelectedResult(null);
    setIsDownloading(false);
    setIsDone(false);
    setProgress(0);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o && isDownloading && !isDone) {
      abortControllerRef.current?.abort();
      if (selectedResult) clearRegionCache(selectedResult.bbox);
      toast("Download Cancelled.");
    }
    setOpen(o);
    if (o) setSavedRegions(getSavedRegions());
    if (!o) resetState();
  };

  const flyToCurrentLocation = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((pos) => {
        activeMap?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 13, duration: 2000 });
        setOpen(false);
      });
    } else {
      toast.error("Geolocation is not supported by your browser.");
    }
  };

  const flyToRegion = (bbox: BBox) => {
    activeMap?.fitBounds([
      [bbox.minLng, bbox.minLat],
      [bbox.maxLng, bbox.maxLat]
    ], { duration: 1500, padding: 40 });
    setOpen(false);
  };

  const handleDeleteRegion = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (confirm(`Are you sure you want to delete the downloaded map for ${name}?`)) {
      await deleteRegion(id);
      setSavedRegions(getSavedRegions());
      toast.success(`${name} removed from offline storage.`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-xl hover:bg-blue-700 hover:scale-105 active:scale-95 transition-all pointer-events-auto"
          title="Download Offline Area"
          aria-label="Download Offline Area"
        >
          <CloudDownload className="h-6 w-6 sm:h-7 sm:w-7" />
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md overflow-hidden p-0 border-border/40 shadow-2xl">
        {!isDownloading ? (
          !selectedResult ? (
            <Command shouldFilter={false} className="rounded-lg border-none bg-background">
              <div className="flex items-center border-b border-border/40 px-3 py-2">
                <Globe className="mr-3 h-5 w-5 text-primary opacity-80" />
                <CommandInput
                  placeholder={isOnline ? "Search for a city or country..." : "Search your downloaded cities..."}
                  value={query}
                  onValueChange={setQuery}
                  className="border-none focus:ring-0 h-10 w-full bg-transparent outline-none placeholder:text-muted-foreground/60 font-medium"
                />
                {!isOnline && (
                  <span className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 mr-2">
                    Offline
                  </span>
                )}
                {isSearching && <Loader2 className="ml-2 h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
              <CommandList className="max-h-[300px]">
                {query.length < 2 && (
                  <div className="p-2 space-y-1">
                    <div className="px-2 py-1.5 text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                      Your Locations
                    </div>
                    <CommandItem
                      onSelect={flyToCurrentLocation}
                      className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent cursor-pointer transition-colors"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 shrink-0">
                        <Navigation className="h-4 w-4 text-blue-500" />
                      </div>
                      <span className="font-medium text-sm">My Current Location</span>
                    </CommandItem>
                    
                    {savedRegions.map((r) => (
                      <div
                        key={r.id}
                        onClick={() => flyToRegion(r.bbox)}
                        className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 hover:bg-accent cursor-pointer transition-colors group"
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 shrink-0">
                            <CloudDownload className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex flex-col overflow-hidden">
                            <span className="truncate text-sm font-semibold">{r.name.split(",")[0]}</span>
                            <span className="truncate text-xs text-muted-foreground opacity-80">
                              {r.mb} MB • Available Offline
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => handleDeleteRegion(e, r.id, r.name.split(",")[0])}
                          title="Delete Region"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {query.length >= 2 && (
                  <>
                    {/* Matching downloaded regions */}
                    {savedRegions.filter(r => r.name.toLowerCase().includes(query.toLowerCase())).length > 0 && (
                      <CommandGroup heading="Downloaded Regions (Ready Offline)" className="px-2 pb-2 text-muted-foreground">
                        {savedRegions
                          .filter(r => r.name.toLowerCase().includes(query.toLowerCase()))
                          .map((r) => (
                            <div
                              key={r.id}
                              onClick={() => flyToRegion(r.bbox)}
                              className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 hover:bg-accent cursor-pointer transition-colors group"
                            >
                              <div className="flex items-center gap-3 overflow-hidden">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 shrink-0">
                                  <CloudDownload className="h-4 w-4 text-primary" />
                                </div>
                                <div className="flex flex-col overflow-hidden">
                                  <span className="truncate text-sm font-semibold">{r.name.split(",")[0]}</span>
                                  <span className="truncate text-xs text-muted-foreground opacity-80">
                                    {r.mb} MB • Ready Offline
                                  </span>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => handleDeleteRegion(e, r.id, r.name.split(",")[0])}
                                title="Delete Region"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                      </CommandGroup>
                    )}
                  </>
                )}
                {!isSearching && query.length >= 2 && suggestions.length === 0 && savedRegions.filter(r => r.name.toLowerCase().includes(query.toLowerCase())).length === 0 && (
                  <CommandEmpty className="py-6 text-center text-sm">
                    {isOnline ? "No regions found." : "No downloaded regions match your search."}
                  </CommandEmpty>
                )}
                {suggestions.length > 0 && (
                  <CommandGroup heading="Suggestions" className="px-2 pb-2 text-muted-foreground">
                    {suggestions.map((r, i) => {
                      const [primaryName, ...rest] = r.name.split(",");
                      const secondaryName = rest.slice(0, 2).join(",").trim();
                      const { mb } = estimateDownloadSize(r.bbox);
                      
                      return (
                        <CommandItem
                          key={i}
                          onSelect={() => handleSelect(r)}
                          className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 hover:bg-accent cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <MapPin className="h-4 w-4 text-primary shrink-0 opacity-80" />
                            <div className="flex flex-col overflow-hidden">
                              <span className="truncate text-sm font-semibold">{primaryName}</span>
                              {secondaryName && (
                                <span className="truncate text-xs text-muted-foreground opacity-80">
                                  {secondaryName}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 text-xs font-medium text-muted-foreground/60 whitespace-nowrap bg-muted/40 px-2 py-0.5 rounded-full">
                            ~{mb} MB
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          ) : (
            <div className="flex flex-col bg-background">
              <div className="flex items-center gap-3 border-b border-border/40 px-5 py-4">
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-accent" onClick={() => setSelectedResult(null)}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="font-semibold">Confirm Region</div>
              </div>
              <div className="p-6 space-y-6">
                <div className="flex items-start justify-between gap-4 rounded-xl border border-border/40 bg-muted/30 p-4 shadow-sm">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <MapPin className="h-5 w-5 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-display font-semibold text-base leading-tight">
                        {selectedResult.name.split(",")[0].trim()}
                      </h3>
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                        {selectedResult.name}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right space-y-0.5">
                    <div className="text-sm font-bold tracking-tight">~{estimateDownloadSize(selectedResult.bbox).mb} MB</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Est. Size</div>
                  </div>
                </div>
                
                <Button className="w-full h-11 rounded-lg text-sm font-semibold tracking-wide shadow-md hover:scale-[1.02] transition-transform" onClick={handleDownload}>
                  <Download className="mr-2 h-4 w-4" />
                  Download for Offline Use
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-14 space-y-6 bg-background">
            {isDone ? (
              <CheckCircle2 className="h-16 w-16 text-green-500 transition-all duration-500 scale-110" />
            ) : (
              <CloudDownload className="h-16 w-16 text-primary animate-bounce shadow-primary/20" />
            )}
            <div className="text-center space-y-3 w-full px-8">
              <p className="text-base font-semibold">{status}</p>
              <div className="relative w-full h-2.5 overflow-hidden rounded-full bg-muted">
                <Progress value={progress} className="h-full bg-primary transition-all duration-300" />
              </div>
              <p className="text-sm font-medium text-muted-foreground opacity-80">{Math.round(progress)}% complete</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
