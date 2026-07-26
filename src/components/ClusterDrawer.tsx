import { formatDistanceToNow } from "date-fns";
import { MapPin, X } from "lucide-react";
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
import { CollectionBadge } from "./CollectionBadge";
import { useAppStore } from "@/lib/store";
import { clusterKey } from "./MapCanvas";
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
        className="w-full overflow-y-auto border-r border-border/60 bg-background/85 p-0 backdrop-blur-xl sm:max-w-md"
      >
        {anchor && (
          <div className="flex h-full flex-col">
            <div className="sticky top-0 z-10 border-b border-border/60 bg-background/70 px-6 py-4 backdrop-blur-xl">
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
                  className="h-8 w-8 rounded-full"
                >
                  <X className="h-4 w-4" />
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
  return (
    <div className="space-y-3">
      {memory.imageUrl && (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border/60 bg-muted shadow-sm">
          <img
            src={memory.imageUrl}
            alt={memory.title}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-background/0" />
          <div className="absolute bottom-2 left-2">
            <CollectionBadge visibility={memory.visibility} collection={memory.collection} />
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <h3 className="font-display text-lg font-semibold leading-tight tracking-tight">
          {memory.title}
        </h3>
        <div className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(memory.createdAt), { addSuffix: true })}
        </div>
      </div>
      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
        {memory.narrative}
      </p>
      {memory.authorName && (
        <div className="flex items-center gap-2.5 pt-1">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-primary/15 text-[10px] text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="text-xs text-muted-foreground">{memory.authorName}</div>
        </div>
      )}
      {showSep && <Separator className="mt-5" />}
    </div>
  );
}
