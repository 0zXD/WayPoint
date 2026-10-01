import { useEffect, useState, useCallback } from "react";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Inbox, Upload, X } from "lucide-react";
import { listDrafts, deleteDraft } from "@/lib/drafts";
import { uploadMemory } from "@/lib/memories";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function DraftSyncBanner() {
  const [draftCount, setDraftCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const token = useAppStore((s) => s.token);
  const qc = useQueryClient();

  const refreshCount = useCallback(async () => {
    const drafts = await listDrafts();
    setDraftCount(drafts.length);
  }, []);

  // Sync all pending drafts
  const syncDrafts = useCallback(async () => {
    if (syncing || !token) return;
    const drafts = await listDrafts();
    if (drafts.length === 0) return;

    setSyncing(true);
    let successCount = 0;

    for (const draft of drafts) {
      try {
        const fd = new FormData();
        draft.photos.forEach((buf, i) => {
          const blob = new Blob([buf], { type: draft.mimeTypes[i] || "image/jpeg" });
          fd.append("images", blob, `photo-${i}.jpg`);
        });
        fd.append("title", draft.title);
        fd.append("narrative", draft.narrative);
        fd.append("locationTag", draft.locationTag);
        fd.append("lat", draft.lat);
        fd.append("lng", draft.lng);

        await uploadMemory(fd);
        await deleteDraft(draft.id);
        successCount++;
      } catch {
        // Keep draft if upload fails again
      }
    }

    setSyncing(false);
    await refreshCount();
    qc.invalidateQueries({ queryKey: ["memories"] });
    qc.invalidateQueries({ queryKey: ["drafts"] });

    if (successCount > 0) {
      toast.success(
        `${successCount} draft ${successCount === 1 ? "memory" : "memories"} uploaded to your map!`
      );
      setDismissed(true);
    }
  }, [syncing, token, refreshCount, qc]);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  // Listen for online/offline
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      setDismissed(false);
      // Auto-sync when we come back online
      syncDrafts();
    };
    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [syncDrafts]);

  // Listen for background sync signal from service worker
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "SYNC_DRAFTS") {
        setDismissed(false);
        syncDrafts();
      }
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [syncDrafts]);

  if (draftCount === 0 || dismissed) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed left-1/2 z-[500] w-[92%] max-w-md -translate-x-1/2",
        "top-20 sm:top-24"
      )}
    >
      <div
        className={cn(
          "glass pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-3 shadow-xl border border-border/60",
          "animate-in fade-in slide-in-from-top-2 duration-300"
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15">
          <Inbox className="h-4 w-4 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground">
            {draftCount} unsynced {draftCount === 1 ? "memory" : "memories"}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {isOnline ? "Ready to upload — tap to sync now" : "Waiting for connection…"}
          </p>
        </div>

        {isOnline && token && (
          <button
            onClick={syncDrafts}
            disabled={syncing}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {syncing ? (
              <span className="animate-spin inline-block h-3 w-3 border-2 border-primary border-t-transparent rounded-full" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            {syncing ? "Syncing…" : "Upload"}
          </button>
        )}

        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
          title="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
