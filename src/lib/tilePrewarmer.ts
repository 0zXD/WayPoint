/**
 * WayPoint Continuous Predictive Prewarming Engine
 * 
 * Architecture:
 * 1. Prediction Engine: Continuously calculates camera trajectory and destination
 * 2. Tile Prioritizer: Assigns dynamic scores to candidate tiles based on 5 Tiers
 * 3. Prewarm Scheduler: Dispatches network requests with bandwidth budgets
 */

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface BoundingBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface ViewportSample {
  lng: number;
  lat: number;
  zoom: number;
  time: number;
}

export interface ViewportVelocity {
  vLng: number; // degrees per millisecond
  vLat: number; // degrees per millisecond
  vZoom: number; // zoom levels per millisecond
  speed: number; // degrees per millisecond
}

export interface PredictionSummary {
  currentCenter: { lng: number; lat: number };
  predictedCenter: { lng: number; lat: number };
  zoom: number;
  coastDurationMs: number;
  speed: number;
  highResTilesQueued: number;
  baseTilesQueued: number;
  timestamp: number;
}

export function lon2tile(lon: number, zoom: number): number {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  return Math.max(0, Math.min(n - 1, x));
}

export function lat2tile(lat: number, zoom: number): number {
  const n = Math.pow(2, zoom);
  const clampedLat = Math.max(-85.051128, Math.min(85.051128, lat));
  const rad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  );
  return Math.max(0, Math.min(n - 1, y));
}

export function buildSatelliteTileUrl(tile: TileCoord, apiKey: string, isBase = false): string {
  if (isBase) {
    const baseZ = Math.min(tile.z, 12);
    const scale = Math.pow(2, tile.z - baseZ);
    const baseX = Math.floor(tile.x / scale);
    const baseY = Math.floor(tile.y / scale);
    return `https://api.maptiler.com/tiles/satellite-v2/${baseZ}/${baseX}/${baseY}.jpg?key=${apiKey}&base=true`;
  }
  return `https://api.maptiler.com/tiles/satellite-v2/${tile.z}/${tile.x}/${tile.y}.jpg?key=${apiKey}`;
}

export class ViewportVelocityTracker {
  private samples: ViewportSample[] = [];
  private readonly windowMs = 180; 

  public record(lng: number, lat: number, zoom: number, time: number = performance.now()): void {
    this.samples.push({ lng, lat, zoom, time });
    const cutoff = time - this.windowMs;
    while (this.samples.length > 2 && this.samples[0].time < cutoff) {
      this.samples.shift();
    }
  }

  public getVelocityAndConfidence(): { velocity: ViewportVelocity, confidence: number } | null {
    if (this.samples.length < 2) return null;
    const oldest = this.samples[0];
    const newest = this.samples[this.samples.length - 1];
    const dt = newest.time - oldest.time;
    if (dt < 25) return null; 

    const vLng = (newest.lng - oldest.lng) / dt;
    const vLat = (newest.lat - oldest.lat) / dt;
    const vZoom = (newest.zoom - oldest.zoom) / dt;
    const speed = Math.sqrt(vLng * vLng + vLat * vLat);

    let pathLength = 0;
    for (let i = 1; i < this.samples.length; i++) {
        const dx = this.samples[i].lng - this.samples[i-1].lng;
        const dy = this.samples[i].lat - this.samples[i-1].lat;
        pathLength += Math.sqrt(dx*dx + dy*dy);
    }
    const dxTotal = newest.lng - oldest.lng;
    const dyTotal = newest.lat - oldest.lat;
    const displacement = Math.sqrt(dxTotal*dxTotal + dyTotal*dyTotal);
    
    const confidence = pathLength > 1e-6 ? displacement / pathLength : 1.0;
    return { velocity: { vLng, vLat, vZoom, speed }, confidence };
  }

  public clear(): void {
    this.samples = [];
  }
}

export { ViewportVelocityTracker as PanVelocityTracker };

interface QueuedTile {
  url: string;
  cacheKey: string;
  isHighRes: boolean;
  tier: number;
  priorityScore: number;
}

interface ActiveRequestTracker {
  cacheKey: string;
  url: string;
  tier: number;
  priorityScore: number;
  startTime: number;
  abortController: AbortController;
}

interface NetworkCapabilities {
  effectiveType: string;
  rtt: number;
  downlink: number;
  saveData: boolean;
}

export class PredictiveSatellitePrewarmer {
  private apiKey: string;
  private seenTiles = new Map<string, { tier: number, timestamp: number, upgradedToTier1: boolean }>();
  private cancelledTiles = new Set<string>();
  private activeFetches = 0;
  
  // Adaptive Resource Manager limits
  private baseMaxConcurrency = 6;
  public maxConcurrency = 6;
  private maxPendingQueueSize = 100;
  private maxIdleBackgroundWorkMs = 5000;
  private idleTimer: number | null = null;
  private foregroundPressureCheck: (() => boolean) | null = null;
  private networkCheckInterval: number | null = null;
  private networkCaps: NetworkCapabilities = { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false };
  private telemetryContainer: HTMLElement | null = null;

  private fetchQueue: QueuedTile[] = [];
  private activeRequests = new Map<string, ActiveRequestTracker>();
  private lastPredictionTime = 0;
  private lastVelocity: ViewportVelocity | null = null;

  public static readonly MAX_PREDICTED_HIGH_RES_TILES = 12;
  public static readonly MAX_PREDICTED_BASE_TILES = 2;

  public stats = {
    tier1Warmed: 0,
    tier2Warmed: 0,
    tier3Warmed: 0,
    tier4Warmed: 0,
    tier5Warmed: 0,
    predictionsTriggered: 0,
    satelliteHighResWarmed: 0,
    satelliteBaseWarmed: 0,
    cacheSkipped: 0,
    totalRequestsIssued: 0,
    usefulSpeculativeRequests: 0,
    wastedSpeculativeRequests: 0,
    requestsCancelled: 0,
    reRequestedAfterCancellation: 0,
    lastPrediction: null as PredictionSummary | null,
  };

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    if (typeof window !== "undefined") {
      (window as any).__satellitePrewarmer = this;
      (window as any).__prewarmer = this;
      this.initAdaptiveNetwork();
      this.initTelemetryPanel();
    }
  }

  public setForegroundPressureCallback(callback: () => boolean) {
    this.foregroundPressureCheck = callback;
  }

  private initAdaptiveNetwork() {
    const updateNetwork = () => {
      const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      if (conn) {
        this.networkCaps = {
          effectiveType: conn.effectiveType || '4g',
          rtt: conn.rtt || 50,
          downlink: conn.downlink || 10,
          saveData: conn.saveData || false,
        };
      }
      
      // Determine baseline concurrency based on explicit network capabilities
      if (this.networkCaps.saveData || this.networkCaps.effectiveType === '2g' || this.networkCaps.effectiveType === 'slow-2g') {
        this.baseMaxConcurrency = 1; // Severely throttle background work to save bandwidth
        this.maxPendingQueueSize = 20;
      } else if (this.networkCaps.effectiveType === '3g' || this.networkCaps.rtt > 300) {
        this.baseMaxConcurrency = 3;
        this.maxPendingQueueSize = 50;
      } else {
        this.baseMaxConcurrency = 6;
        this.maxPendingQueueSize = 100;
      }
      
      this.maxConcurrency = this.baseMaxConcurrency;
      this.renderTelemetry();
    };
    
    updateNetwork();
    if (typeof window !== "undefined" && (navigator as any).connection) {
      (navigator as any).connection.addEventListener('change', updateNetwork);
    }
    
    // Fallback polling for browsers that don't emit change events properly
    if (typeof window !== "undefined") {
      this.networkCheckInterval = window.setInterval(updateNetwork, 10000);
    }
  }

  private initTelemetryPanel() {
    if (process.env.NODE_ENV !== 'development' && !window.location.search.includes('debug')) return;
    if (document.getElementById('prewarmer-telemetry')) return;
    
    this.telemetryContainer = document.createElement('div');
    this.telemetryContainer.id = 'prewarmer-telemetry';
    this.telemetryContainer.style.cssText = `
      position: absolute; bottom: 10px; right: 10px; z-index: 9999;
      background: rgba(0, 0, 0, 0.85); color: #00ffcc; font-family: monospace;
      font-size: 11px; padding: 12px; border-radius: 6px; width: 320px;
      pointer-events: none; backdrop-filter: blur(4px); border: 1px solid rgba(0,255,204,0.3);
    `;
    document.body.appendChild(this.telemetryContainer);
  }

  private renderTelemetry() {
    if (!this.telemetryContainer) return;
    
    const isForegroundBusy = this.foregroundPressureCheck ? !this.foregroundPressureCheck() : false;
    
    this.telemetryContainer.innerHTML = `
      <div style="font-weight:bold;margin-bottom:6px;color:#fff;">PRODUCTION TELEMETRY</div>
      <div>NETWORK: <span style="color:#aaa">${this.networkCaps.effectiveType.toUpperCase()} | RTT: ${this.networkCaps.rtt}ms | ${this.networkCaps.downlink}Mbps</span></div>
      <div>CONCURRENCY: <span style="color:#aaa">${this.activeFetches} / ${this.maxConcurrency} (Base: ${this.baseMaxConcurrency})</span></div>
      <div>FOREGROUND PRESSURE: <span style="color:${isForegroundBusy ? '#ff4444' : '#44ff44'}">${isForegroundBusy ? 'HIGH' : 'LOW'}</span></div>
      <div>PENDING QUEUE: <span style="color:#aaa">${this.fetchQueue.length} / ${this.maxPendingQueueSize}</span></div>
      <div style="margin-top:6px;border-top:1px solid #333;padding-top:6px;"></div>
      <div>PREWORMED TOTAL: <span style="color:#aaa">${this.stats.satelliteHighResWarmed + this.stats.satelliteBaseWarmed} tiles</span></div>
      <div>ACTIVE CANCELLED: <span style="color:#aaa">${this.stats.requestsCancelled} tiles</span></div>
      <div>RE-REQUESTED (DEDUP): <span style="color:#aaa">${this.stats.reRequestedAfterCancellation} tiles</span></div>
      <div>USEFUL COMPLETIONS: <span style="color:#aaa">${this.stats.usefulSpeculativeRequests} (approx)</span></div>
    `;
  }

  public setApiKey(key: string): void {
    this.apiKey = key;
  }

  /**
   * Continuous Prediction Engine
   * Calculates trajectories for Tiers 3 and 4 based on pan and zoom velocities.
   */
  public prefetchPredictedViewport(
    currentCenter: { lng: number; lat: number },
    currentBbox: BoundingBox,
    currentZoom: number,
    velocity: ViewportVelocity,
    confidence: number = 1.0
  ): boolean {
    const now = performance.now();
    const isReversal =
      this.lastVelocity !== null &&
      (velocity.vLng * this.lastVelocity.vLng + velocity.vLat * this.lastVelocity.vLat) < 0;

    // 7. Direction Changes: Throttle
    if (!isReversal && now - this.lastPredictionTime < 100) return false;

    // 16. Idle Behavior & Confidence Shedding
    if (velocity.speed < 0.0001) {
      if (!this.idleTimer && typeof window !== "undefined") {
        this.idleTimer = window.setTimeout(() => {
           // Idle timeout reached (e.g. 5 seconds of no movement):
           // Stop background prediction processing entirely to save battery/bandwidth.
           // Near-term active requests will finish naturally.
           this.abortPending();
        }, this.maxIdleBackgroundWorkMs);
      }
      return false; // Stop predicting while dead still
    } else {
      if (this.idleTimer) {
        window.clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
    }

    const pixelsPerDegree = 512 * Math.pow(2, currentZoom) / 360;
    const speedPxPerMs = velocity.speed * pixelsPerDegree;

    // 16. Confidence Model: Low confidence = stay closer to viewport
    if (confidence < 0.5 && !isReversal) return false; 
    const confidenceMultiplier = Math.max(0.2, Math.min(1.0, confidence));

    this.lastPredictionTime = now;
    this.lastVelocity = velocity;

    const panIntensity = speedPxPerMs * 450; 
    const zoomIntensity = Math.abs(velocity.vZoom) * 50_000;
    let coastDurationMs = Math.min(850, Math.max(350, Math.max(panIntensity, zoomIntensity)));
    coastDurationMs *= confidenceMultiplier;
    
    const distanceFactor = coastDurationMs * 0.6; // Integral of exponential decay
    
    // 15. Zoom Must Participate in the Same Model
    const predZoomDelta = Math.max(-1.0, Math.min(1.0, velocity.vZoom * distanceFactor));
    const targetZoom = Math.round(Math.max(0, Math.min(22, currentZoom + predZoomDelta)));

    // 3. Predictive Scrolling / Pan Model: Generate a trajectory (T1, T2, T3)
    const waypoints = [0.33, 0.66, 1.0]; // Represents T1, T2, T3 (fraction of distanceFactor)
    const candidateTiles = new Map<string, { tile: TileCoord, ttv: number, distToStop: number }>();

    let finalBbox: BoundingBox | null = null;
    let finalMidX = 0, finalMidY = 0;

    for (let i = 0; i < waypoints.length; i++) {
      const step = waypoints[i];
      const stepDist = distanceFactor * step;
      
      const stepLng = currentCenter.lng + velocity.vLng * stepDist;
      const stepLat = Math.max(-85.0511, Math.min(85.0511, currentCenter.lat + velocity.vLat * stepDist));
      const stepZoom = currentZoom + predZoomDelta * step;

      // 8. Predict the Viewport, Not Just the Center
      const scaleFactor = Math.pow(2, currentZoom - stepZoom);
      const spanLng = (currentBbox.maxLng - currentBbox.minLng) * scaleFactor;
      const spanLat = (currentBbox.maxLat - currentBbox.minLat) * scaleFactor;

      const stepBbox: BoundingBox = {
        minLng: stepLng - spanLng / 2, maxLng: stepLng + spanLng / 2,
        minLat: stepLat - spanLat / 2, maxLat: stepLat + spanLat / 2,
      };

      if (i === waypoints.length - 1) finalBbox = stepBbox;

      const x0 = lon2tile(stepBbox.minLng, targetZoom);
      const x1 = lon2tile(stepBbox.maxLng, targetZoom);
      const y0 = lat2tile(stepBbox.maxLat, targetZoom);
      const y1 = lat2tile(stepBbox.minLat, targetZoom);

      const minX = Math.min(x0, x1);
      const maxX = Math.max(x0, x1);
      const minY = Math.min(y0, y1);
      const maxY = Math.max(y0, y1);

      if (i === waypoints.length - 1) {
        finalMidX = (minX + maxX) / 2;
        finalMidY = (minY + maxY) / 2;
      }

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const key = `${targetZoom}_${x}_${y}`;
          if (!candidateTiles.has(key)) {
            // 10. Time-to-Visibility: Earlier waypoints mean the tile is needed sooner
            candidateTiles.set(key, { tile: { z: targetZoom, x, y }, ttv: step, distToStop: 0 });
          }
        }
      }
    }

    // 9. Trajectory Tile Prioritization
    const allTiles = Array.from(candidateTiles.values()).map(c => {
      // Destination relevance (distance to final predicted stop)
      c.distToStop = Math.sqrt(Math.pow(c.tile.x - finalMidX, 2) + Math.pow(c.tile.y - finalMidY, 2));
      return c;
    });

    allTiles.sort((a, b) => {
      // Formula: Priority = Temporal Urgency + Destination Relevance
      // Lower TTV is better (urgency). Lower dist is better (relevance).
      const scoreA = (a.ttv * 10) + a.distToStop;
      const scoreB = (b.ttv * 10) + b.distToStop;
      return scoreA - scoreB; // Ascending (lower score = higher priority)
    });

    // 21. Strict Resource Budgets
    const budgetedHighRes = allTiles.slice(0, PredictiveSatellitePrewarmer.MAX_PREDICTED_HIGH_RES_TILES);

    // Fallback Base Tiles for the final destination only
    const baseZoom = Math.min(targetZoom, 12);
    let budgetedBase: TileCoord[] = [];
    if (finalBbox) {
      const bx0 = lon2tile(finalBbox.minLng, baseZoom);
      const bx1 = lon2tile(finalBbox.maxLng, baseZoom);
      const by0 = lat2tile(finalBbox.maxLat, baseZoom);
      const by1 = lat2tile(finalBbox.minLat, baseZoom);

      for (let bx = Math.min(bx0, bx1); bx <= Math.max(bx0, bx1); bx++) {
        for (let by = Math.min(by0, by1); by <= Math.max(by0, by1); by++) {
          budgetedBase.push({ z: baseZoom, x: bx, y: by });
        }
      }
      budgetedBase = budgetedBase.slice(0, PredictiveSatellitePrewarmer.MAX_PREDICTED_BASE_TILES);
    }

    // Calculate scores for new candidate tiles to drive cancellation logic
    const newCandidateScores = new Map<string, number>();
    for (let i = 0; i < budgetedHighRes.length; i++) {
      const c = budgetedHighRes[i];
      const cacheKey = `sat_${targetZoom}_${c.tile.x}_${c.tile.y}`;
      const priority = 0.9 - (c.ttv * 0.2) - (i / budgetedHighRes.length * 0.2);
      newCandidateScores.set(cacheKey, priority);
    }
    for (const bt of budgetedBase) {
      const cacheKey = `sat_base_${baseZoom}_${bt.x}_${bt.y}`;
      newCandidateScores.set(cacheKey, 0.8);
    }

    const maxNewScore = newCandidateScores.size > 0 ? Math.max(...newCandidateScores.values()) : 0;
    const COMPLETION_THRESHOLD_MS = 140; // 4. Protect nearly-complete downloads (assuming ~200ms total)
    const HYSTERESIS_MARGIN = 0.3; // 8. Cancellation hysteresis

    // 2 & 3. Active-Request Cancellation Logic
    for (const [cacheKey, activeReq] of this.activeRequests.entries()) {
      if (activeReq.tier < 3) continue; // 6. Do not starve visible MapLibre requests

      const elapsed = now - activeReq.startTime;
      if (elapsed >= COMPLETION_THRESHOLD_MS) continue; // 4. Near completion, do not abort
      
      const newScore = newCandidateScores.get(cacheKey) ?? 0;
      
      // 5. Handle violent reversals
      if (isReversal) {
        if (newScore === 0) { // Old trajectory tile that isn't in new trajectory
          activeReq.abortController.abort();
          this.activeRequests.delete(cacheKey);
          this.seenTiles.delete(cacheKey);
          this.cancelledTiles.add(cacheKey);
          this.stats.requestsCancelled++;
        }
      } else {
        // Continuous pan hysteresis cancellation
        if (newScore < activeReq.priorityScore - 0.2) { // 1. Usefulness dropped substantially
          if (maxNewScore > newScore + HYSTERESIS_MARGIN) { // 3. Better requests waiting
            activeReq.abortController.abort();
            this.activeRequests.delete(cacheKey);
            this.seenTiles.delete(cacheKey);
            this.cancelledTiles.add(cacheKey);
            this.stats.requestsCancelled++;
          }
        }
      }
    }

    if (!isReversal) {
      // Continuous pan: We MUST clear the old pending speculative tiles from the queue so it doesn't bloat!
      this.fetchQueue = this.fetchQueue.filter(item => item.tier < 3);
    }

    // 7. Hard Resource Budget for Pending Queue
    if (this.fetchQueue.length > this.maxPendingQueueSize) {
      // Keep only the most valuable items based on existing priority sorts
      this.fetchQueue.sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        return b.priorityScore - a.priorityScore;
      });
      this.fetchQueue = this.fetchQueue.slice(0, this.maxPendingQueueSize);
    }

    this.stats.predictionsTriggered++;
    this.stats.lastPrediction = {
      currentCenter,
      predictedCenter: { lng: finalBbox!.minLng + (finalBbox!.maxLng - finalBbox!.minLng)/2, lat: finalBbox!.minLat + (finalBbox!.maxLat - finalBbox!.minLat)/2 },
      zoom: targetZoom,
      coastDurationMs,
      speed: velocity.speed,
      highResTilesQueued: budgetedHighRes.length,
      baseTilesQueued: budgetedBase.length,
      timestamp: Date.now(),
    };

    // 11. Tile Request Scheduler (Enqueueing with Priority Scores)
    for (const bt of budgetedBase) {
      this.enqueueTile(bt, true, 3, 0.8);
    }
    
    for (let i = 0; i < budgetedHighRes.length; i++) {
      const c = budgetedHighRes[i];
      const cacheKey = `sat_${targetZoom}_${c.tile.x}_${c.tile.y}`;
      const priority = newCandidateScores.get(cacheKey)!;
      this.enqueueTile(c.tile, false, 4, priority);
    }

    this.processQueue();
    return true;
  }

  /**
   * Tier 1 (Immediate Visible) and Tier 2 (Near Future Surroundings)
   */
  public prewarmTier1(bbox: BoundingBox, zoom: number): void {
    const targetZoom = Math.round(zoom);
    const maxTile = Math.pow(2, targetZoom) - 1;

    // Tier 2 Fallback: Regional Base
    const baseZoom = Math.min(targetZoom, 12);
    const baseMaxTile = Math.pow(2, baseZoom) - 1;
    const bx0 = Math.max(0, lon2tile(bbox.minLng, baseZoom) - 1);
    const bx1 = Math.min(baseMaxTile, lon2tile(bbox.maxLng, baseZoom) + 1);
    const by0 = Math.max(0, lat2tile(bbox.maxLat, baseZoom) - 1);
    const by1 = Math.min(baseMaxTile, lat2tile(bbox.minLat, baseZoom) + 1);

    for (let bx = Math.min(bx0, bx1); bx <= Math.max(bx0, bx1); bx++) {
      for (let by = Math.min(by0, by1); by <= Math.max(by0, by1); by++) {
        this.enqueueTile({ z: baseZoom, x: bx, y: by }, true, 2, 0.9);
      }
    }

    const x0 = lon2tile(bbox.minLng, targetZoom);
    const x1 = lon2tile(bbox.maxLng, targetZoom);
    const y0 = lat2tile(bbox.maxLat, targetZoom);
    const y1 = lat2tile(bbox.minLat, targetZoom);

    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);

    // Tier 1: Immediate Visible
    const visibleTiles: TileCoord[] = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        visibleTiles.push({ z: targetZoom, x, y });
      }
    }

    // Tier 2: Near Future Surroundings (Perimeter Ring)
    const surroundingsTiles: TileCoord[] = [];
    const outerMinX = Math.max(0, minX - 1);
    const outerMaxX = Math.min(maxTile, maxX + 1);
    const outerMinY = Math.max(0, minY - 1);
    const outerMaxY = Math.min(maxTile, maxY + 1);
    for (let x = outerMinX; x <= outerMaxX; x++) {
      for (let y = outerMinY; y <= outerMaxY; y++) {
        const isVisible = x >= minX && x <= maxX && y >= minY && y <= maxY;
        if (!isVisible) surroundingsTiles.push({ z: targetZoom, x, y });
      }
    }

    // Strict budgeting: 18 high-res tiles max
    for (const t of visibleTiles.slice(0, 18)) {
      this.enqueueTile(t, false, 1, 1.0);
    }
    const remainingBudget = Math.max(0, 18 - visibleTiles.length);
    for (const t of surroundingsTiles.slice(0, remainingBudget)) {
      this.enqueueTile(t, false, 2, 0.7);
    }

    this.processQueue();
  }

  /**
   * Tier 5: Application Prediction (e.g. user hovers over a memory marker)
   */
  public prewarmTier5(lng: number, lat: number, zoom: number): void {
    const targetZoom = Math.round(zoom);
    const x = lon2tile(lng, targetZoom);
    const y = lat2tile(lat, targetZoom);
    this.enqueueTile({ z: targetZoom, x, y }, false, 5, 0.4);
    this.processQueue();
  }

  private enqueueTile(tile: TileCoord, isBase: boolean, tier: number, priorityScore: number) {
    const prefix = isBase ? "sat_base" : "sat";
    const cacheKey = `${prefix}_${tile.z}_${tile.x}_${tile.y}`;
    const existing = this.seenTiles.get(cacheKey);

    if (!existing) {
      // 9. Preserve request deduplication
      if (this.cancelledTiles.has(cacheKey)) {
        this.stats.reRequestedAfterCancellation++;
        this.cancelledTiles.delete(cacheKey);
      }

      this.seenTiles.set(cacheKey, { tier, timestamp: performance.now(), upgradedToTier1: tier === 1 });
      const url = buildSatelliteTileUrl(tile, this.apiKey, isBase);
      this.fetchQueue.push({ url, cacheKey, isHighRes: !isBase, tier, priorityScore });
      
      if (tier === 1) this.stats.tier1Warmed++;
      else if (tier === 2) this.stats.tier2Warmed++;
      else if (tier === 3) this.stats.tier3Warmed++;
      else if (tier === 4) this.stats.tier4Warmed++;
      else if (tier === 5) this.stats.tier5Warmed++;
      
      if (isBase) this.stats.satelliteBaseWarmed++;
      else this.stats.satelliteHighResWarmed++;
    } else {
      if (tier === 1 && existing.tier > 1 && !existing.upgradedToTier1) {
        existing.upgradedToTier1 = true;
        this.stats.usefulSpeculativeRequests++;
      }
      this.stats.cacheSkipped++;
    }
  }

  private processQueue(): void {
    if (this.seenTiles.size > 3500) {
      const it = this.seenTiles.keys();
      for (let i = 0; i < 800; i++) {
        const key = it.next().value;
        if (key) {
          const entry = this.seenTiles.get(key);
          if (entry && entry.tier > 1 && !entry.upgradedToTier1) {
            this.stats.wastedSpeculativeRequests++;
          }
          this.seenTiles.delete(key);
        }
      }
    }

    // Adaptive Resource Management: Foreground Pressure Protection
    // If MapLibre is currently actively loading visible tiles, we drastically reduce background concurrency
    // so we don't saturate the browser's HTTP queue and lag the foreground map.
    if (this.foregroundPressureCheck) {
       const isMapIdle = this.foregroundPressureCheck();
       if (!isMapIdle) {
          // High foreground pressure: allow max 1 background speculative request
          this.maxConcurrency = Math.min(1, this.baseMaxConcurrency);
       } else {
          // Low foreground pressure: recover to network-defined maximum
          this.maxConcurrency = this.baseMaxConcurrency;
       }
    }
    this.renderTelemetry();

    // Prewarm Scheduler: Sort by Tier (lower is better), then Priority Score (higher is better)
    this.fetchQueue.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return b.priorityScore - a.priorityScore;
    });

    while (this.activeFetches < this.maxConcurrency && this.fetchQueue.length > 0) {
      const item = this.fetchQueue.shift();
      if (!item) continue;

      const abortController = new AbortController();
      this.activeRequests.set(item.cacheKey, {
        cacheKey: item.cacheKey,
        url: item.url,
        tier: item.tier,
        priorityScore: item.priorityScore,
        startTime: performance.now(),
        abortController
      });

      this.activeFetches++;
      this.stats.totalRequestsIssued++;

      // Adaptive Resource Management: Use priority="low" so visible vector requests always win
      fetch(item.url, {
        priority: "low" as any,
        signal: abortController.signal,
        // CRITICAL: Do NOT set an explicit Accept header here.
      })
        .catch(() => {})
        .finally(() => {
          this.activeFetches--;
          this.activeRequests.delete(item.cacheKey);
          this.renderTelemetry();
          if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
            window.requestAnimationFrame(() => this.processQueue());
          } else {
            setTimeout(() => this.processQueue(), 8);
          }
        });
    }
  }

  public getStats() {
    return {
      ...this.stats,
      inFlightRequests: this.activeFetches,
      queuedRequests: this.fetchQueue.length,
      cachedTileCount: this.seenTiles.size,
      activeRequestsCount: this.activeRequests.size,
      cancelledTilesCount: this.cancelledTiles.size,
    };
  }

  public abortPending(): void {
    for (const req of this.activeRequests.values()) {
      req.abortController.abort();
    }
    this.activeRequests.clear();
    this.fetchQueue = [];
  }

  public reset(): void {
    this.abortPending();
    this.seenTiles.clear();
  }
}

export { PredictiveSatellitePrewarmer as TilePrewarmer };
