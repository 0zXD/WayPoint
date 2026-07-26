import { WS_BASE, API_CONFIGURED } from "./api";
import type { ActivityEvent } from "./types";

export type WSStatus = "idle" | "connecting" | "open" | "closed" | "demo";

export interface WSHandle {
  close: () => void;
}

export function connectActivity(
  token: string | null,
  onEvent: (e: ActivityEvent) => void,
  onStatus: (s: WSStatus) => void,
): WSHandle {
  if (!API_CONFIGURED) {
    onStatus("demo");
    // Emit synthetic events every few seconds so the feed feels live
    const names = ["Ines", "Jonah", "Ren", "Priya", "Milo"];
    const titles = [
      "Sunrise over Notre-Dame",
      "Late shift at Blue Bottle",
      "Wet stones, Shibuya",
      "Fog rolling into the bay",
    ];
    const timer = setInterval(() => {
      onEvent({
        id: `demo-${Date.now()}`,
        type: "memory.commented",
        actorName: names[Math.floor(Math.random() * names.length)],
        memoryTitle: titles[Math.floor(Math.random() * titles.length)],
        createdAt: new Date().toISOString(),
      });
    }, 12000);
    return { close: () => clearInterval(timer) };
  }

  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;

  const open = () => {
    onStatus("connecting");
    const url = `${WS_BASE}/api/v1/ws`;
    ws = token ? new WebSocket(url, [`bearer.${token}`]) : new WebSocket(url);
    ws.onopen = () => {
      attempt = 0;
      onStatus("open");
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as ActivityEvent;
        onEvent(data);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      onStatus("closed");
      if (!closed) {
        attempt = Math.min(attempt + 1, 6);
        setTimeout(open, 500 * 2 ** attempt);
      }
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return {
    close: () => {
      closed = true;
      ws?.close();
    },
  };
}
