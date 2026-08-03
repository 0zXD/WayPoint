import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { Header } from "@/components/Header";
import { UploadModal } from "@/components/UploadModal";
import { ClusterDrawer } from "@/components/ClusterDrawer";
import { DraftSyncBanner } from "@/components/DraftSyncBanner";

import { ActivityFeed } from "@/components/ActivityFeed";
import { API_CONFIGURED } from "@/lib/api";
import type { Memory } from "@/lib/types";
import type { WSStatus } from "@/lib/ws";

const MapCanvas = lazy(() =>
  import("@/components/MapCanvas").then((m) => ({ default: m.MapCanvas })),
);

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "WayPoint — Your places on the map" },
      {
        name: "description",
        content:
          "A live, minimalist map for the memories worth pinning. Pan, zoom, and share the places that stuck.",
      },
      { property: "og:title", content: "WayPoint — Your places on the map" },
      {
        property: "og:description",
        content: "A live, minimalist map for the memories worth pinning.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [wsStatus, setWsStatus] = useState<WSStatus>("idle");
  const [, setQuery] = useState("");

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <Suspense
        fallback={
          <div className="grid h-screen w-screen place-items-center bg-background text-sm text-muted-foreground">
            Loading map…
          </div>
        }
      >
        <MapCanvas onMemories={setMemories} onCenter={setCenter} />
      </Suspense>

      <Header wsStatus={wsStatus} onSearch={setQuery} />

      {!API_CONFIGURED && (
        <div className="pointer-events-none fixed left-1/2 top-20 z-[500] w-[92%] max-w-md -translate-x-1/2 sm:top-24">
          <div className="glass pointer-events-auto rounded-full px-4 py-2 text-center text-xs text-muted-foreground">
            Demo mode · set{" "}
            <code className="rounded bg-primary/10 px-1 py-0.5 text-primary">VITE_API_BASE_URL</code>{" "}
            to hit your Go backend
          </div>
        </div>
      )}

      <ActivityFeed onStatus={setWsStatus} />
      <UploadModal mapCenter={center} />
      <DraftSyncBanner />
      <ClusterDrawer memories={memories} />
    </div>
  );
}
