import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Activity, ChevronRight, LogIn, MessageSquare, Share2, Sparkles } from "lucide-react";
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
  const user = useAppStore((s) => s.user);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!token) {
      onStatus("idle");
      setEvents([]);
      return;
    }
    const h = connectActivity(
      token,
      (e) => setEvents((prev) => [e, ...prev].slice(0, 40)),
      onStatus,
    );
    return () => h.close();
  }, [token, onStatus]);

  const isLoggedIn = !!user && !!token;

  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-[500] sm:bottom-6 sm:left-6">
      <div
        className={`pointer-events-auto glass overflow-hidden rounded-xl sm:rounded-2xl transition-all duration-300 ${open ? "w-[260px] sm:w-[320px]" : "w-[160px] sm:w-[220px]"
          }`}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 sm:gap-2 sm:px-3.5 sm:py-2.5 text-left cursor-pointer"
        >
          <span className="grid h-6 w-6 sm:h-7 sm:w-7 place-items-center rounded-lg bg-primary/15 text-primary shrink-0">
            <Activity className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-xs sm:text-sm font-medium leading-tight truncate">
              {isLoggedIn ? "Activity" : "Live Stream"}
            </div>
            <div className="text-[10px] sm:text-xs text-muted-foreground truncate">
              {isLoggedIn
                ? `${events.length} ${events.length === 1 ? "event" : "events"} · live`
                : "Sign in to activate"}
            </div>
          </div>
          <ChevronRight
            className={`h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
          />
        </button>

        {open && (
          <div className="border-t border-border/60">
            {!isLoggedIn ? (
              <div className="p-4 sm:p-5 text-center space-y-2.5">
                <div className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-primary">
                  <LogIn className="h-4.5 w-4.5" />
                </div>
                <div className="space-y-1">
                  <div className="text-xs sm:text-sm font-semibold">Sign in required</div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Please sign in to use this feature.
                  </p>
                </div>
              </div>
            ) : (
              <ScrollArea className="h-64">
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
        )}
      </div>
    </div>
  );
}
