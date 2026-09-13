import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { MapPin, X, ChevronLeft, ChevronRight } from "lucide-react";
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
import type { Memory } from "@/lib/types";

export function MemoryDrawer({ memories }: { memories: Memory[] }) {
  const id = useAppStore((s) => s.selectedMemoryId);
  const setId = useAppStore((s) => s.setSelectedMemoryId);
  const memory = memories.find((m) => m.id === id) ?? null;

  return (
    <Sheet open={!!memory} onOpenChange={(o) => !o && setId(null)}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 sm:max-w-md z-[600]"
      >
        {memory && <DrawerBody memory={memory} onClose={() => setId(null)} />}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ memory, onClose }: { memory: Memory; onClose: () => void }) {
  const initials = memory.authorName?.slice(0, 2).toUpperCase() ?? "??";
  const scrollRef = useRef<HTMLDivElement>(null);
  const scroll = (e: React.MouseEvent, dir: "left" | "right") => {
    e.stopPropagation();
    if (scrollRef.current) {
      const el = scrollRef.current;
      const scrollAmount = el.clientWidth;
      el.scrollBy({ left: dir === "left" ? -scrollAmount : scrollAmount, behavior: "smooth" });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative w-full bg-muted group">
        {memory.photos && memory.photos.length > 0 ? (
          <>
            <div ref={scrollRef} className="flex overflow-x-auto snap-x snap-mandatory" style={{ scrollbarWidth: "none" }}>
              {memory.photos.map((photo, idx) => (
                <div key={photo.id} className="relative aspect-[4/3] w-full snap-center shrink-0">
                  <img src={photo.url} alt={`${memory.title} - ${idx + 1}`} className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
            {memory.photos.length > 1 && (
              <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-between pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity px-2 sm:px-4">
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
            )}
          </>
        ) : (
          <div className="aspect-[4/3] w-full" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/0 pointer-events-none" />
        <Button
          onClick={onClose}
          size="icon"
          variant="secondary"
          className="absolute right-3 top-3 h-8 w-8 rounded-full backdrop-blur"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-4 px-6 py-5">
        <SheetHeader className="space-y-2 p-0 text-left">
          <SheetTitle className="font-display text-2xl leading-tight">
            {memory.title}
          </SheetTitle>
          {memory.locationTag && (
            <SheetDescription className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-primary" />
              {memory.locationTag}
              <span className="text-muted-foreground/60">·</span>
              {formatDistanceToNow(new Date(memory.createdAt), { addSuffix: true })}
            </SheetDescription>
          )}
        </SheetHeader>

        <Separator />

        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
          {memory.narrative}
        </p>

        {memory.authorName && (
          <>
            <Separator />
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-primary/15 text-xs text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="text-sm">
                <div className="font-medium">{memory.authorName}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(memory.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="pt-2 text-xs text-muted-foreground">
          {memory.lat.toFixed(4)}, {memory.lng.toFixed(4)}
        </div>
      </div>
    </div>
  );
}
