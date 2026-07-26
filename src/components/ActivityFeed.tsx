import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Activity, ChevronRight, MessageSquare, Share2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { connectActivity, type WSStatus } from "@/lib/ws";
import { useAppStore } from "@/lib/store";
import type { ActivityEvent } from "@/lib/types";

const iconFor = (t: ActivityEvent["type"]) =>
  t === "memory.created"
    ? Sparkles
    : t === "memory.commented"
      ? MessageSquare
      : t === "collection.shared"
        ? Share2
        : Activity;

const labelFor = (e: ActivityEvent) => {
  switch (e.type) {
    case "memory.created":
      return "added";
    case "memory.commented":
      return "commented on";
    case "memory.updated":
      return "updated";
    case "collection.shared":
      return "shared";
  }
};

export function ActivityFeed({ onStatus }: { onStatus: (s: WSStatus) => void }) {
  const token = useAppStore((s) => s.token);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const h = connectActivity(
      token,
      (e) => setEvents((prev) => [e, ...prev].slice(0, 40)),
      onStatus,
    );
    return () => h.close();
  }, [token, onStatus]);

  return (
    <div className="pointer-events-none fixed bottom-6 left-3 z-[500] sm:left-6">
      <div
        className={`pointer-events-auto glass overflow-hidden rounded-2xl transition-all duration-300 ${
          open ? "w-[320px]" : "w-[220px]"
        }`}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
        >
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
            <Activity className="h-3.5 w-3.5" />
          </span>
          <div className="flex-1">
            <div className="text-sm font-medium">Activity</div>
            <div className="text-xs text-muted-foreground">
              {events.length} {events.length === 1 ? "event" : "events"} · live
            </div>
          </div>
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          />
        </button>

        {open && (
          <ScrollArea className="h-64 border-t border-border/60">
            <ul className="divide-y divide-border/50">
              {events.length === 0 && (
                <li className="px-3.5 py-4 text-center text-xs text-muted-foreground">
                  Waiting for the first ripple…
                </li>
              )}
              {events.map((e) => {
                const Icon = iconFor(e.type);
                return (
                  <li key={e.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <div className="min-w-0 text-xs leading-snug">
                      <span className="font-medium">{e.actorName}</span>{" "}
                      <span className="text-muted-foreground">{labelFor(e)}</span>{" "}
                      <span className="font-medium">{e.memoryTitle ?? "a memory"}</span>
                      <div className="text-[10px] text-muted-foreground/80">
                        {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
