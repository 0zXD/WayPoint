import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { Header } from "@/components/Header";
import { UploadModal } from "@/components/UploadModal";
import { ClusterDrawer } from "@/components/ClusterDrawer";
import { DraftSyncBanner } from "@/components/DraftSyncBanner";

import { ActivityFeed } from "@/components/ActivityFeed";
import type { Memory } from "@/lib/types";
import type { WSStatus } from "@/lib/ws";

const MapCanvas = lazy(() =>
  import("@/components/MapCanvas").then((m) => ({ default: m.MapCanvas })),
);

export const Route = createFileRoute("/")(({
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
}));

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

      <ActivityFeed onStatus={setWsStatus} />
      <UploadModal mapCenter={center} />
      <DraftSyncBanner />
      <ClusterDrawer memories={memories} />
    </div>
  );
}
