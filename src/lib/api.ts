import { useAppStore } from "./store";

export const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:8000";

export const WS_BASE =
  (import.meta.env.VITE_WS_BASE_URL as string | undefined)?.replace(/\/$/, "") ??
  API_BASE.replace(/^http/, "ws");

export const API_CONFIGURED = import.meta.env.VITE_DEMO_MODE !== "true";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class NetworkTimeoutError extends Error {
  constructor() {
    super('Network request timed out. You may be offline.');
    this.name = 'NetworkTimeoutError';
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 20_000,
): Promise<T> {
  const token = useAppStore.getState().token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(init.body instanceof FormData) && init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, text || res.statusText);
    }
    const ct = res.headers.get("content-type") ?? "";
    return (ct.includes("application/json") ? await res.json() : ((await res.text()) as unknown)) as T;
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === 'AbortError') {
      throw new NetworkTimeoutError();
    }
    throw err;
  }
}
