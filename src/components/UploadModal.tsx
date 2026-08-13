import { useCallback, useEffect, useState, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { ImagePlus, Loader2, MapPin, X, Navigation, Crosshair, ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppStore } from "@/lib/store";
import { uploadMemory, updateMemory, deletePhoto } from "@/lib/memories";
import { saveDraft } from "@/lib/drafts";
import type { Memory } from "@/lib/types";

const ACCEPT = { "image/jpeg": [], "image/png": [], "image/webp": [] };

export function UploadModal({ mapCenter }: { mapCenter: { lat: number; lng: number } | null }) {
  const open = useAppStore((s) => s.uploadOpen);
  const setOpen = useAppStore((s) => s.setUploadOpen);
  const token = useAppStore((s) => s.token);
  const qc = useQueryClient();

  const setIsPickingLocation = useAppStore((s) => s.setIsPickingLocation);
  const isPickingLocation = useAppStore((s) => s.isPickingLocation);
  const pickedLocation = useAppStore((s) => s.pickedLocation);
  const setPickedLocation = useAppStore((s) => s.setPickedLocation);

  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<{ id: string; url: string }[]>([]);

  const editingMemory = useAppStore((s) => s.editingMemory);
  const setEditingMemory = useAppStore((s) => s.setEditingMemory);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scroll = (e: React.MouseEvent, dir: "left" | "right") => {
    e.stopPropagation();
    if (scrollRef.current) {
      const el = scrollRef.current;
      const scrollAmount = el.clientWidth;
      el.scrollBy({ left: dir === "left" ? -scrollAmount : scrollAmount, behavior: "smooth" });
    }
  };
  const [title, setTitle] = useState("");
  const [narrative, setNarrative] = useState("");
  const [locationTag, setLocationTag] = useState("");
  const [lat, setLat] = useState<string>("");
  const [lng, setLng] = useState<string>("");
  const [isGeocodingTag, setIsGeocodingTag] = useState(false);

  const reverseGeocode = async (latVal: string, lngVal: string) => {
    const parsedLat = parseFloat(latVal);
    const parsedLng = parseFloat(lngVal);
    if (isNaN(parsedLat) || isNaN(parsedLng)) return;
    setIsGeocodingTag(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${parsedLat}&lon=${parsedLng}&zoom=10&addressdetails=1`,
        { headers: { "Accept-Language": "en" } }
      );
      if (!res.ok) return;
      const data = await res.json();
      const addr = data.address || {};
      // Build a concise label: city/town/village, country
      const locality =
        addr.city || addr.town || addr.village || addr.county || addr.state_district || addr.state || "";
      const country = addr.country || "";
      const tag = [locality, country].filter(Boolean).join(", ");
      if (tag) setLocationTag(tag);
    } catch {
      // Silently fail — user can still see coordinates
    } finally {
      setIsGeocodingTag(false);
    }
  };

  useEffect(() => {
    if (!open && !isPickingLocation) {
      setFiles([]);
      setPreviews([]);
      setTitle("");
      setNarrative("");
      setLocationTag("");
      setLat("");
      setLng("");
      setPickedLocation(null);
      setEditingMemory(null);
      setExistingPhotos([]);
    }
  }, [open, isPickingLocation, setPickedLocation, setEditingMemory]);

  useEffect(() => {
    if (open) {
      if (editingMemory && !isPickingLocation) {
        setTitle(editingMemory.title);
        setNarrative(editingMemory.narrative);
        setLocationTag(editingMemory.locationTag || "");
        setLat(editingMemory.lat.toString());
        setLng(editingMemory.lng.toString());
        setExistingPhotos(editingMemory.photos || []);
      } else if (pickedLocation) {
        const latStr = pickedLocation.lat.toFixed(6);
        const lngStr = pickedLocation.lng.toFixed(6);
        setLat(latStr);
        setLng(lngStr);
        setPickedLocation(null);
        reverseGeocode(latStr, lngStr);
      } else if (!lat && !lng && mapCenter && !editingMemory) {
        const latStr = mapCenter.lat.toFixed(6);
        const lngStr = mapCenter.lng.toFixed(6);
        setLat(latStr);
        setLng(lngStr);
        reverseGeocode(latStr, lngStr);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pickedLocation, mapCenter, setPickedLocation, editingMemory, isPickingLocation]);

  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach(u => URL.revokeObjectURL(u));
  }, [files]);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => [...prev, ...accepted].slice(0, 4));
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxFiles: 4,
    maxSize: 10 * 1024 * 1024,
  });

  const saveAsDraft = async () => {
    const photos = await Promise.all(files.map(f => f.arrayBuffer()));
    const mimeTypes = files.map(f => f.type);
    await saveDraft({ title, narrative, locationTag, lat, lng, photos, mimeTypes });
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready
        .then((reg) => (reg as any).sync.register('waypoint-draft-sync'))
        .catch(console.warn);
    }
    qc.invalidateQueries({ queryKey: ["drafts"] });
    toast.info("You're offline — draft saved. It'll upload automatically when you reconnect.", { duration: 6000 });
    setOpen(false);
  };

  const mutation = useMutation({
    networkMode: "always", // CRITICAL: prevents React Query from pausing the mutation indefinitely when offline
    mutationFn: async () => {
      if (files.length === 0 && existingPhotos.length === 0) throw new Error("Add at least one image");
      if (!mapCenter && !editingMemory) throw new Error("Map not ready");

      // Check offline BEFORE touching the network — DevTools "Offline" throttle
      // blocks fetch() indefinitely without rejecting it, so we must bail early.
      if (!navigator.onLine && !editingMemory && files.length > 0) {
        await saveAsDraft();
        return;
      }

      const fd = new FormData();
      files.forEach(f => fd.append("images", f));
      fd.append("title", title);
      fd.append("narrative", narrative);
      fd.append("locationTag", locationTag);
      fd.append("lat", lat);
      fd.append("lng", lng);

      if (editingMemory) {
        return updateMemory(editingMemory.id, fd);
      }
      return uploadMemory(fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memories"] });
      setOpen(false);
    },
    onError: async (e: Error) => {
      if (editingMemory) {
        toast.error(e.message);
        return;
      }
      // Detect timeout (AbortError from our 20s timer) and other network failures
      const isNetworkError =
        e.name === 'NetworkTimeoutError' ||
        e.name === 'AbortError' ||
        !navigator.onLine ||
        e.message.toLowerCase().includes('network') ||
        e.message.toLowerCase().includes('fetch') ||
        e.message.toLowerCase().includes('failed to fetch') ||
        e.message.toLowerCase().includes('timed out');
      if (isNetworkError && files.length > 0) {
        try {
          await saveAsDraft();
        } catch {
          toast.error("Couldn't save draft. Please try again.");
        }
      } else {
        toast.error(e.message);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[94vw] max-w-lg sm:max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="font-display text-xl sm:text-2xl">
            {editingMemory ? "Edit memory" : "New memory"}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {editingMemory
              ? "Update your memory's details or photos."
              : "Drop it where you were. It'll pin to the current map center."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 sm:space-y-4">
          <div
            {...getRootProps()}
            className={`relative flex aspect-[16/9] min-h-[140px] max-h-52 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl sm:rounded-2xl border-2 border-dashed transition-colors ${isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}
          >
            <input {...getInputProps()} />
            {previews.length > 0 || existingPhotos.length > 0 ? (
              <div className="relative h-full w-full group">
                <div
                  ref={scrollRef}
                  className="flex h-full w-full overflow-x-auto snap-x snap-mandatory"
                  style={{ scrollbarWidth: "none" }}
                >
                  {existingPhotos.map((photo) => (
                    <div key={photo.id} className="relative h-full w-full shrink-0 snap-center">
                      <img src={photo.url} alt="existing" className="h-full w-full object-cover" />
                      <Button
                        size="icon"
                        variant="secondary"
                        className="absolute right-2 top-2 h-7 w-7 rounded-full shadow-md z-10"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await deletePhoto(photo.id);
                            setExistingPhotos(prev => prev.filter(p => p.id !== photo.id));
                            qc.invalidateQueries({ queryKey: ["memories"] });
                          } catch (err) {
                            toast.error("Failed to delete photo");
                          }
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  {previews.map((src, idx) => (
                    <div key={idx} className="relative h-full w-full shrink-0 snap-center">
                      <img src={src} alt="preview" className="h-full w-full object-cover" />
                      <Button
                        size="icon"
                        variant="secondary"
                        className="absolute right-2 top-2 h-7 w-7 rounded-full shadow-md z-10"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFiles(prev => prev.filter((_, i) => i !== idx));
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  {(previews.length + existingPhotos.length) < 4 && (
                    <div className="relative flex flex-col items-center justify-center h-full w-full shrink-0 snap-center bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-primary transition-colors">
                      <ImagePlus className="h-8 w-8 mb-2" />
                      <span className="text-sm font-medium">Add more ({previews.length}/4)</span>
                    </div>
                  )}
                </div>

                {/* Navigation Arrows */}
                <div className="absolute inset-y-0 left-2 right-2 flex items-center justify-between pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 rounded-full shadow-md pointer-events-auto backdrop-blur-sm bg-background/60 hover:bg-background/90"
                    onClick={(e) => scroll(e, "left")}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 rounded-full shadow-md pointer-events-auto backdrop-blur-sm bg-background/60 hover:bg-background/90"
                    onClick={(e) => scroll(e, "right")}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 text-center text-sm text-muted-foreground">
                <ImagePlus className="h-8 w-8 text-primary" />
                <span className="font-medium text-foreground">Drop an image or click to browse</span>
                <span className="text-xs">JPEG · PNG · WebP · up to 10MB</span>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="A quiet Sunday…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc">Location tag</Label>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                {isGeocodingTag ? (
                  <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 pl-9 text-sm text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Detecting location…
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <Input
                      id="loc"
                      value={locationTag}
                      readOnly
                      placeholder="Auto-detected from coordinates"
                      className="pl-9 bg-muted/30 cursor-default select-none text-sm"
                      title={locationTag || "Location will be auto-detected from coordinates"}
                    />
                    <button
                      type="button"
                      onClick={() => reverseGeocode(lat, lng)}
                      disabled={!lat || !lng}
                      className="shrink-0 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Re-detect location from coordinates"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1 text-xs sm:text-sm h-9"
              onClick={() => {
                if (navigator.geolocation) {
                  const toastId = toast.loading("Locating...");
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      const latStr = pos.coords.latitude.toFixed(6);
                      const lngStr = pos.coords.longitude.toFixed(6);
                      setLat(latStr);
                      setLng(lngStr);
                      reverseGeocode(latStr, lngStr);
                      toast.success("Location updated via GPS", { id: toastId });
                    },
                    () => {
                      toast.error("Could not fetch location", { id: toastId });
                    },
                    { enableHighAccuracy: true }
                  );
                } else {
                  toast.error("Geolocation is not supported by your browser");
                }
              }}
            >
              {/* <Navigation className="mr-2 h-3.5 w-3.5 text-primary" /> */}
              Locate Me
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1 text-xs sm:text-sm h-9"
              onClick={() => {
                setIsPickingLocation(true);
                setOpen(false);
              }}
            >
              {/* <Crosshair className="mr-2 h-3.5 w-3.5 text-primary" /> */}
              Pick on Map
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lat">Latitude</Label>
              <Input
                id="lat"
                type="number"
                step="any"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="0.000000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lng">Longitude</Label>
              <Input
                id="lng"
                type="number"
                step="any"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="0.000000"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="story">Narrative</Label>
            <Textarea
              id="story"
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              placeholder="What made this moment stick?"
              rows={4}
            />
          </div>

        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            className="gradient-accent text-primary-foreground"
            disabled={mutation.isPending || (files.length === 0 && existingPhotos.length === 0)}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editingMemory ? "Save Changes" : "Save memory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
