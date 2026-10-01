import { formatDistanceToNow } from "date-fns";
import { Loader2, MapPin, Trash2, X, Heart, MessageCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAppStore } from "@/lib/store";
import { clusterKey } from "./MapCanvas";
import { deletePhoto } from "@/lib/memories";
import type { Memory } from "@/lib/types";

export function ClusterDrawer({ memories }: { memories: Memory[] }) {
  const openKey = useAppStore((s) => s.openClusterKey);
  const setOpenKey = useAppStore((s) => s.setOpenClusterKey);
  
  const items = openKey
    ? memories.filter((m) => clusterKey(m) === openKey)
    : [];
  const anchor = items[0];

  return (
    <Sheet open={!!openKey && items.length > 0} onOpenChange={(o) => !o && setOpenKey(null)}>
      <SheetContent
        side="left"
        className="w-full overflow-y-auto border-r border-border/60 bg-background/90 p-0 backdrop-blur-xl sm:max-w-md [&>button:last-child]:hidden z-[600]"
      >
        {anchor && (
          <div className="flex h-full flex-col">
            <div className="sticky top-0 z-10 border-b border-border/60 bg-background/80 px-6 py-4 backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3">
                <SheetHeader className="space-y-1 p-0 text-left">
                  <SheetTitle className="font-display text-xl leading-tight tracking-tight">
                    {anchor.locationTag ?? "This place"}
                  </SheetTitle>
                  <SheetDescription className="flex items-center gap-1.5 text-xs">
                    <MapPin className="h-3.5 w-3.5 text-primary" />
                    {anchor.lat.toFixed(4)}, {anchor.lng.toFixed(4)}
                    <span className="text-muted-foreground/60">·</span>
                    {items.length} {items.length === 1 ? "memory" : "memories"}
                  </SheetDescription>
                </SheetHeader>
                <Button
                  onClick={() => setOpenKey(null)}
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 rounded-full cursor-pointer hover:bg-accent/60 transition-colors"
                >
                  <X className="h-4.5 w-4.5" />
                </Button>
              </div>
            </div>

            <div className="flex-1 space-y-5 px-6 py-5">
              {items.map((m, i) => (
                <MemoryEntry key={m.id} memory={m} showSep={i < items.length - 1} />
              ))}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MemoryEntry({ memory, showSep }: { memory: Memory; showSep: boolean }) {
  const initials = memory.authorName?.slice(0, 2).toUpperCase() ?? "??";
  const user = useAppStore((s) => s.user);
  const qc = useQueryClient();
  
  // memory.authorName == user.name is used since the frontend doesn't have memory.userId yet,
  // but if we expose userId in types, we could check that. For now, authorName check works.
  const isOwner = user && user.name === memory.authorName;

  const deletePhotoMutation = useMutation({
    mutationFn: deletePhoto,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memories"] });
      toast.success("Photo deleted");
    },
    onError: () => toast.error("Failed to delete photo"),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          <h3 className="font-display text-lg font-semibold leading-tight tracking-tight">
            {memory.title}
          </h3>
        </div>
      </div>

      {memory.photos && memory.photos.length > 0 && (
        <div className="flex flex-col gap-6 pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6">
          {memory.photos.map((photo, idx) => (
            <div key={photo.id} className="flex flex-col gap-2.5">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border/60 bg-muted shadow-sm shrink-0 group/photo">
                <img
                  src={photo.url}
                  alt={`${memory.title} - ${idx + 1}`}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-background/0 pointer-events-none" />
                
                {isOwner && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 h-8 w-8 bg-black/40 hover:bg-destructive/80 backdrop-blur-md text-white border border-white/10 opacity-0 group-hover/photo:opacity-100 transition-opacity rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      deletePhotoMutation.mutate(photo.id);
                    }}
                    disabled={deletePhotoMutation.isPending}
                  >
                    {deletePhotoMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                )}

                <div className="absolute bottom-2.5 left-2.5 flex items-center gap-2">
                  {memory.authorName && (
                    <div className="flex items-center gap-1.5 rounded-full bg-black/40 backdrop-blur-md pl-1 pr-2.5 py-1 text-white shadow-sm border border-white/10">
                      <Avatar className="h-5 w-5">
                        <AvatarFallback className="bg-primary/80 text-[9px] text-primary-foreground font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-[10px] font-medium leading-none">{memory.authorName}</span>
                    </div>
                  )}
                </div>

                <div className="absolute bottom-2.5 right-3 flex items-center">
                  <span className="text-[11px] font-medium text-white/90 drop-shadow-sm tracking-wide">
                    {formatDistanceToNow(new Date(memory.createdAt), { addSuffix: true })}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4 px-1 text-muted-foreground">
                <button type="button" className="flex items-center gap-1.5 text-[13px] font-medium hover:text-foreground transition-colors cursor-pointer">
                  <Heart className="h-4 w-4" />
                  <span>Like</span>
                </button>
                <button type="button" className="flex items-center gap-1.5 text-[13px] font-medium hover:text-foreground transition-colors cursor-pointer">
                  <MessageCircle className="h-4 w-4" />
                  <span>Comment</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
        {memory.narrative}
      </p>
      {showSep && <Separator className="mt-5" />}
    </div>
  );
}
