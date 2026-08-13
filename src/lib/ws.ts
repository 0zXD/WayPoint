import { WS_BASE } from "./api";
import type { ActivityEvent } from "./types";

export type WSStatus = "idle" | "connecting" | "open" | "closed";

export interface WSHandle {
  close: () => void;
}

export function connectActivity(
  token: string | null,
  onEvent: (e: ActivityEvent) => void,
  onStatus: (s: WSStatus) => void,
): WSHandle {
  if (!token) {
    onStatus("idle");
    return { close: () => {} };
  }

  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;

  const open = () => {
    onStatus("connecting");
    const url = `${WS_BASE}/api/v1/ws`;
    ws = new WebSocket(url, [`bearer.${token}`]);
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
