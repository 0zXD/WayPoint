import { useEffect, useState } from "react";

export type AdaptiveTier = "fast" | "good" | "moderate" | "constrained";

export interface AdaptiveViewportConfig {
  tier: AdaptiveTier;
  /**
   * Surrounding buffer expansion ratio.
   * e.g. 0.62 adds 62% in all directions, virtually expanding 224x224 to 500x500 (~2.24x)
   */
  bufferRatio: number;
  /** Max satellite and vector tiles to pre-warm in one batch */
  maxTiles: number;
  /** Debounce delay before stationary preheating triggers */
  debounceMs: number;
  effectiveType: string;
  downlink: number;
  rtt: number;
  saveData: boolean;
  cpuCores: number;
  deviceMemoryGb: number;
}

// Rolling latency tracker for real-world backend prefetch response times
let rollingLatencySum = 0;
let rollingLatencyCount = 0;
const MAX_LATENCY_SAMPLES = 8;
const recentLatencies: number[] = [];

/**
 * Feed actual round-trip prefetch latency back into the adaptive engine.
 * If backend round-trips take longer than 400ms, the engine automatically steps down the virtual buffer.
 */
export function recordPrefetchLatency(latencyMs: number) {
  if (latencyMs <= 0 || latencyMs > 10_000) return;
  recentLatencies.push(latencyMs);
  rollingLatencySum += latencyMs;
  rollingLatencyCount++;

  if (recentLatencies.length > MAX_LATENCY_SAMPLES) {
    const oldest = recentLatencies.shift()!;
    rollingLatencySum -= oldest;
    rollingLatencyCount--;
  }
}

function getAverageLatency(): number {
  if (rollingLatencyCount === 0) return 0;
  return rollingLatencySum / rollingLatencyCount;
}

export function computeAdaptiveConfig(): AdaptiveViewportConfig {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      tier: "good",
      bufferRatio: 0.4,
      maxTiles: 25,
      debounceMs: 400,
      effectiveType: "4g",
      downlink: 10,
      rtt: 50,
      saveData: false,
      cpuCores: 4,
      deviceMemoryGb: 8,
    };
  }

  const conn =
    (navigator as any).connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection;

  const effectiveType: string = conn?.effectiveType || "4g";
  const downlink: number = typeof conn?.downlink === "number" ? conn.downlink : 10;
  const rtt: number = typeof conn?.rtt === "number" ? conn.rtt : 50;
  const saveData: boolean = Boolean(conn?.saveData);

  const cpuCores: number = navigator.hardwareConcurrency || 4;
  const deviceMemoryGb: number = (navigator as any).deviceMemory || 4;

  const avgLatency = getAverageLatency();

  // Tier 1: Constrained / Data Saver / High Network Latency
  if (
    saveData ||
    effectiveType === "slow-2g" ||
    effectiveType === "2g" ||
    downlink < 1.2 ||
    rtt > 400 ||
    avgLatency > 600
  ) {
    return {
      tier: "constrained",
      bufferRatio: 0.0, // Strictly physical screen only (1.0x)
      maxTiles: 9,
      debounceMs: 650,
      effectiveType,
      downlink,
      rtt,
      saveData,
      cpuCores,
      deviceMemoryGb,
    };
  }

  // Tier 2: Moderate / 3G / Low-End Hardware
  if (
    effectiveType === "3g" ||
    downlink < 3.5 ||
    rtt > 220 ||
    cpuCores <= 2 ||
    deviceMemoryGb <= 2 ||
    avgLatency > 400
  ) {
    return {
      tier: "moderate",
      bufferRatio: 0.2, // ~1.4x virtual screen
      maxTiles: 16,
      debounceMs: 500,
      effectiveType,
      downlink,
      rtt,
      saveData,
      cpuCores,
      deviceMemoryGb,
    };
  }

  // Tier 3: Good 4G / Standard Hardware
  if (downlink < 7.0 || rtt > 120 || cpuCores <= 4 || avgLatency > 250) {
    return {
      tier: "good",
      bufferRatio: 0.42, // ~1.84x virtual screen
      maxTiles: 28,
      debounceMs: 380,
      effectiveType,
      downlink,
      rtt,
      saveData,
      cpuCores,
      deviceMemoryGb,
    };
  }

  // Tier 4: Ultra / Fast Broadband or 5G with High CPU/RAM
  // Virtually expands 224x224 to 500x500 (~2.24x multiplier)
  return {
    tier: "fast",
    bufferRatio: 0.62, // +62% padding on all 4 borders -> 1 + 2*0.62 = 2.24x virtual dimension
    maxTiles: 45,
    debounceMs: 300,
    effectiveType,
    downlink,
    rtt,
    saveData,
    cpuCores,
    deviceMemoryGb,
  };
}

export function useAdaptiveViewport(): AdaptiveViewportConfig {
  const [config, setConfig] = useState<AdaptiveViewportConfig>(computeAdaptiveConfig);

  useEffect(() => {
    const update = () => setConfig(computeAdaptiveConfig());

    const conn =
      (navigator as any).connection ||
      (navigator as any).mozConnection ||
      (navigator as any).webkitConnection;

    if (conn) {
      conn.addEventListener("change", update);
    }

    // Re-check every 15s to factor in rolling latency changes smoothly
    const interval = window.setInterval(update, 15_000);

    return () => {
      if (conn) {
        conn.removeEventListener("change", update);
      }
      window.clearInterval(interval);
    };
  }, []);

  return config;
}
