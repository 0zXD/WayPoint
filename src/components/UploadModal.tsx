import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, Loader2, MapPin, X } from "lucide-react";
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
import { uploadMemory } from "@/lib/memories";
import type { Memory } from "@/lib/types";

const ACCEPT = { "image/jpeg": [], "image/png": [], "image/webp": [] };

export function UploadModal({ mapCenter }: { mapCenter: { lat: number; lng: number } | null }) {
  const open = useAppStore((s) => s.uploadOpen);
  const setOpen = useAppStore((s) => s.setUploadOpen);
  const token = useAppStore((s) => s.token);
  const qc = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [narrative, setNarrative] = useState("");
  const [locationTag, setLocationTag] = useState("");
  const [visibility, setVisibility] = useState<Memory["visibility"]>("private");

  useEffect(() => {
    if (!open) {
      setFile(null);
      setPreview(null);
      setTitle("");
      setNarrative("");
      setLocationTag("");
      setVisibility("private");
    }
  }, [open]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) setFile(accepted[0]);
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Add an image first");
      if (!mapCenter) throw new Error("Map not ready");
      const fd = new FormData();
      fd.append("image", file);
      fd.append("title", title);
      fd.append("narrative", narrative);
      fd.append("locationTag", locationTag);
      fd.append("visibility", visibility);
      fd.append("lat", String(mapCenter.lat));
      fd.append("lng", String(mapCenter.lng));
      return uploadMemory(fd);
    },
    onSuccess: () => {
      toast.success("Memory added to your map");
      qc.invalidateQueries({ queryKey: ["memories"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">New memory</DialogTitle>
          <DialogDescription>
            {token
              ? "Drop it where you were. It'll pin to the current map center."
              : "Signed-out uploads are stored locally in demo mode."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            {...getRootProps()}
            className={`relative flex aspect-video cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors ${
              isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
          >
            <input {...getInputProps()} />
            {preview ? (
              <>
                <img src={preview} alt="preview" className="h-full w-full object-cover" />
                <Button
                  size="icon"
                  variant="secondary"
                  className="absolute right-2 top-2 h-7 w-7 rounded-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setPreview(null);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
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
                <Input
                  id="loc"
                  value={locationTag}
                  onChange={(e) => setLocationTag(e.target.value)}
                  placeholder="Kyoto, Japan"
                  className="pl-9"
                />
              </div>
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

          <div className="space-y-1.5">
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as Memory["visibility"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private — only you</SelectItem>
                <SelectItem value="shared">Shared — your team</SelectItem>
                <SelectItem value="public">Public — anyone with the map</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            className="gradient-accent text-primary-foreground"
            disabled={mutation.isPending || !file}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save memory
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
