package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"waypoint-backend/internal/config"
)

type binaryAsset struct {
	data        []byte
	contentType string
}

type BinaryCache struct {
	mu       sync.RWMutex
	items    map[string]*binaryAsset
	order    []string
	capacity int
}

func NewBinaryCache(capacity int) *BinaryCache {
	return &BinaryCache{
		items:    make(map[string]*binaryAsset, capacity),
		order:    make([]string, 0, capacity),
		capacity: capacity,
	}
}

func (c *BinaryCache) Get(key string) (*binaryAsset, bool) {
	c.mu.RLock()
	item, ok := c.items[key]
	c.mu.RUnlock()
	return item, ok
}

func (c *BinaryCache) Set(key string, asset *binaryAsset) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if _, exists := c.items[key]; exists {
		c.items[key] = asset
		return
	}

	if len(c.order) >= c.capacity {
		// Evict oldest 10% to prevent continuous re-allocation
		evictCount := c.capacity / 10
		if evictCount < 1 {
			evictCount = 1
		}
		for i := 0; i < evictCount; i++ {
			delete(c.items, c.order[i])
		}
		c.order = c.order[evictCount:]
	}

	c.items[key] = asset
	c.order = append(c.order, key)
}

type inFlightCall struct {
	done    chan struct{}
	val     *binaryAsset
	err     error
	cancel  context.CancelFunc
	waiters int32
}

type MapHandler struct {
	cfg              *config.Config
	jsonClient       *http.Client // decompresses gzip for JSON rewriting
	binClient        *http.Client // passes binary data through untouched
	styleCache       sync.Map     // caches rewritten style.json string by styleID
	jsonCache        sync.Map     // caches rewritten tiles.json and other metadata
	binCache         *BinaryCache // high-speed in-memory LRU cache for binary tiles, sprites & glyphs
	prefetchQueue    chan string  // buffered channel for predictive satellite tile prefetching
	prefetchInFlight sync.Map     // deduplicates in-flight prefetch requests
	inFlight         sync.Map     // singleflight deduplication for concurrent foreground & prefetch requests
	prefetchMu       sync.Mutex
	prefetchCancel   context.CancelFunc
}

// Shared transport with connection pooling and HTTP/2 multiplexing.
var sharedTransport = &http.Transport{
	MaxIdleConns:        500,
	MaxIdleConnsPerHost: 100,
	MaxConnsPerHost:     250,
	IdleConnTimeout:     90 * time.Second,
	ForceAttemptHTTP2:   true,
}

var noDecompressTransport = &http.Transport{
	MaxIdleConns:        500,
	MaxIdleConnsPerHost: 100,
	MaxConnsPerHost:     250,
	IdleConnTimeout:     90 * time.Second,
	DisableCompression:  true,
	ForceAttemptHTTP2:   true,
}

func NewMapHandler(cfg *config.Config) *MapHandler {
	h := &MapHandler{
		cfg:           cfg,
		jsonClient:    &http.Client{Transport: sharedTransport, Timeout: 10 * time.Second},
		binClient:     &http.Client{Transport: noDecompressTransport, Timeout: 15 * time.Second},
		binCache:      NewBinaryCache(5000), // Cache up to 5,000 binary assets (~125MB RAM)
		prefetchQueue: make(chan string, 64),
	}

	// Launch 8 concurrent background workers to warm up satellite tiles in parallel (~300ms)
	for i := 0; i < 8; i++ {
		go h.startPrefetchWorker()
	}

	return h
}

func (h *MapHandler) startPrefetchWorker() {
	for satPath := range h.prefetchQueue {
		h.fetchAndCacheSatelliteTile(satPath)
	}
}

// fetchBinaryAsset implements context-aware singleflight deduplication.
// Both background prefetch workers and foreground client requests share the same in-flight fetch.
// If all waiting client requests are canceled (e.g. user swiped away), the upstream MapTiler fetch is canceled immediately!
func (h *MapHandler) fetchBinaryAsset(ctx context.Context, cacheKey, url string) (*binaryAsset, error) {
	if cached, ok := h.binCache.Get(cacheKey); ok {
		return cached, nil
	}

	fetchCtx, fetchCancel := context.WithTimeout(context.Background(), 12*time.Second)

	newCall := &inFlightCall{
		done:    make(chan struct{}),
		cancel:  fetchCancel,
		waiters: 1,
	}

	actual, loaded := h.inFlight.LoadOrStore(cacheKey, newCall)
	call := actual.(*inFlightCall)
	if loaded {
		fetchCancel() // discard unused context
		atomic.AddInt32(&call.waiters, 1)

		select {
		case <-call.done:
			return call.val, call.err
		case <-ctx.Done():
			if atomic.AddInt32(&call.waiters, -1) <= 0 && call.cancel != nil {
				call.cancel()
			}
			return nil, ctx.Err()
		}
	}

	defer func() {
		h.inFlight.Delete(cacheKey)
		close(call.done)
	}()

	// If the original initiator cancels and no other callers are waiting, abort upstream fetch
	go func() {
		select {
		case <-ctx.Done():
			if atomic.AddInt32(&call.waiters, -1) <= 0 && call.cancel != nil {
				call.cancel()
			}
		case <-call.done:
		}
	}()

	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, url, nil)
	if err != nil {
		call.err = err
		return nil, err
	}

	resp, err := h.binClient.Do(req)
	if err != nil {
		call.err = err
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		call.err = fmt.Errorf("status %d", resp.StatusCode)
		return nil, call.err
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		call.err = err
		return nil, err
	}

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		if strings.HasSuffix(cacheKey, ".jpg") || strings.HasSuffix(cacheKey, ".jpeg") {
			ct = "image/jpeg"
		} else if strings.HasSuffix(cacheKey, ".png") {
			ct = "image/png"
		} else if strings.HasSuffix(cacheKey, ".pbf") {
			ct = "application/x-protobuf"
		}
	}

	asset := &binaryAsset{data: data, contentType: ct}
	h.binCache.Set(cacheKey, asset)
	call.val = asset
	return asset, nil
}

func (h *MapHandler) fetchAndCacheSatelliteTile(satPath string) {
	defer h.prefetchInFlight.Delete(satPath)

	// Quick check: if already in RAM, do nothing
	if _, ok := h.binCache.Get(satPath); ok {
		return
	}

	if h.cfg.MapTilerAPIKey == "" {
		return
	}

	url := "https://api.maptiler.com/" + satPath + "?key=" + h.cfg.MapTilerAPIKey
	_, _ = h.fetchBinaryAsset(context.Background(), satPath, url)
}

func (h *MapHandler) triggerSatellitePrefetch(path string) {
	// If user is requesting a vector tile (v3/{z}/{x}/{y}.pbf),
	// predictively warm up the exact matching satellite tile in the background!
	if strings.HasPrefix(path, "tiles/v3/") && strings.HasSuffix(path, ".pbf") {
		coord := strings.TrimSuffix(strings.TrimPrefix(path, "tiles/v3/"), ".pbf")
		satPath := "tiles/satellite-v2/" + coord + ".jpg"

		// If already in RAM, skip immediately
		if _, ok := h.binCache.Get(satPath); ok {
			return
		}

		// Avoid duplicate concurrent in-flight requests for the same tile
		if _, inFlight := h.prefetchInFlight.LoadOrStore(satPath, struct{}{}); inFlight {
			return
		}
		// Non-blocking enqueue: if queue is full under rapid global scrolling, drop gracefully
		select {
		case h.prefetchQueue <- satPath:
		default:
			h.prefetchInFlight.Delete(satPath)
		}
	}
}

type PrefetchRequest struct {
	Tiles []string `json:"tiles"`
	Paths []string `json:"paths"`
}

// Prefetch actively warms up specific satellite tiles in Go memory in parallel.
// Triggered by frontend when user is viewing/inspecting an area in vector mode (e.g. Tokyo).
func (h *MapHandler) Prefetch(w http.ResponseWriter, r *http.Request) {
	if h.cfg.MapTilerAPIKey == "" {
		http.Error(w, `{"error":"MAPTILER_API_KEY is not configured"}`, http.StatusInternalServerError)
		return
	}

	var req PrefetchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	if len(req.Tiles) == 0 && len(req.Paths) > 0 {
		req.Tiles = req.Paths
	}

	// Limit to max 60 tiles per prefetch request to accommodate adaptive virtual viewports
	if len(req.Tiles) > 60 {
		req.Tiles = req.Tiles[:60]
	}

	// Cancel any previously active background prefetch batch!
	// If the user moved to a new zone, immediately abort all previous prefetch workers
	// so they don't consume upstream MapTiler bandwidth or connections!
	h.prefetchMu.Lock()
	if h.prefetchCancel != nil {
		h.prefetchCancel()
	}
	batchCtx, cancel := context.WithCancel(context.Background())
	h.prefetchCancel = cancel
	h.prefetchMu.Unlock()

	// Use a worker semaphore to cap concurrent background fetches to MapTiler (max 8)
	// This ensures foreground tile requests always have immediate connection availability.
	sem := make(chan struct{}, 8)
	enqueued := 0

	for _, tile := range req.Tiles {
		tilePath := strings.TrimPrefix(tile, "/")
		if !strings.HasPrefix(tilePath, "tiles/satellite-v2/") && !strings.HasPrefix(tilePath, "tiles/v3/") {
			continue
		}

		// If already in RAM, skip immediately
		if _, ok := h.binCache.Get(tilePath); ok {
			continue
		}

		enqueued++
		go func(path string) {
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-batchCtx.Done():
				return
			}

			if batchCtx.Err() != nil {
				return
			}

			url := "https://api.maptiler.com/" + path + "?key=" + h.cfg.MapTilerAPIKey
			_, _ = h.fetchBinaryAsset(batchCtx, path, url)
		}(tilePath)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"ok","enqueued":%d}`, enqueued)
}

// GetStyle fetches the MapTiler style.json, strips the API key to keep it secure,
// and rewrites all api.maptiler.com URLs to point to our local proxy.
func (h *MapHandler) GetStyle(w http.ResponseWriter, r *http.Request) {
	if h.cfg.MapTilerAPIKey == "" {
		http.Error(w, `{"error":"MAPTILER_API_KEY is not configured"}`, http.StatusInternalServerError)
		return
	}

	styleID := r.URL.Query().Get("id")
	if styleID == "" {
		styleID = "dataviz-dark"
	}

	// Fast-path memory cache hit
	if cached, ok := h.styleCache.Load(styleID); ok {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Write([]byte(cached.(string)))
		return
	}

	url := "https://api.maptiler.com/maps/" + styleID + "/style.json?key=" + h.cfg.MapTilerAPIKey

	resp, err := h.jsonClient.Get(url)
	if err != nil {
		http.Error(w, `{"error":"Failed to fetch map style"}`, http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("MapTiler returned status %d for style %s: %s", resp.StatusCode, styleID, string(bodyBytes))
		http.Error(w, fmt.Sprintf(`{"error":"MapTiler returned status %d"}`, resp.StatusCode), resp.StatusCode)
		return
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, `{"error":"Failed to read map style"}`, http.StatusInternalServerError)
		return
	}

	bodyStr := string(bodyBytes)

	// Strip the API key
	bodyStr = strings.ReplaceAll(bodyStr, "?key="+h.cfg.MapTilerAPIKey, "")
	bodyStr = strings.ReplaceAll(bodyStr, "&key="+h.cfg.MapTilerAPIKey, "")

	// Rewrite URLs to relative proxy endpoint
	bodyStr = strings.ReplaceAll(bodyStr, "https://api.maptiler.com", "/api/v1/map/proxy")

	// Store in memory for instantaneous subsequent requests
	h.styleCache.Store(styleID, bodyStr)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Write([]byte(bodyStr))
}

// Proxy forwards tile, sprite, and glyph requests to MapTiler.
func (h *MapHandler) Proxy(w http.ResponseWriter, r *http.Request) {
	if h.cfg.MapTilerAPIKey == "" {
		http.Error(w, "MAPTILER_API_KEY is not configured", http.StatusInternalServerError)
		return
	}

	path := r.PathValue("path")
	if path == "" {
		http.Error(w, "Missing path", http.StatusBadRequest)
		return
	}

	// Concurrently pre-warm matching satellite tile in background (~300ms)
	h.triggerSatellitePrefetch(path)

	url := "https://api.maptiler.com/" + path + "?key=" + h.cfg.MapTilerAPIKey
	
	q := r.URL.Query()
	q.Del("offline")
	query := q.Encode()
	if query != "" {
		url += "&" + query
	}

	cacheKey := path
	if query != "" {
		cacheKey += "?" + query
	}

	isJSON := strings.HasSuffix(path, ".json")
	
	if isJSON {
		if cached, ok := h.jsonCache.Load(path); ok {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Write([]byte(cached.(string)))
			return
		}
	} else {
		// Fast-path in-memory cache hit for binary assets (satellite JPEGs, vector PBFs, sprite PNGs, glyphs)
		if cached, ok := h.binCache.Get(cacheKey); ok {
			w.Header().Set("Content-Type", cached.contentType)
			w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("X-Cache", "HIT")
			w.WriteHeader(http.StatusOK)
			w.Write(cached.data)
			return
		}

		// Coalesced singleflight fetch: shares in-flight fetch with background prefetch or concurrent requests!
		asset, err := h.fetchBinaryAsset(r.Context(), cacheKey, url)
		if err == nil && asset != nil {
			w.Header().Set("Content-Type", asset.contentType)
			w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("X-Cache", "MISS")
			w.WriteHeader(http.StatusOK)
			w.Write(asset.data)
			return
		}

		log.Printf("Proxy error for %s: %v", path, err)
		http.Error(w, "Failed to fetch from MapTiler", http.StatusInternalServerError)
		return
	}
	
	resp, err := h.jsonClient.Get(url)
	if err != nil {
		log.Printf("Proxy error for %s: %v", path, err)
		http.Error(w, "Failed to fetch from MapTiler", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("MapTiler returned status %d for %s: %s", resp.StatusCode, path, string(bodyBytes))
		http.Error(w, fmt.Sprintf("MapTiler returned status %d", resp.StatusCode), resp.StatusCode)
		return
	}

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "" {
		w.Header().Set("Cache-Control", cc)
	}
	
	// Add CORS headers so frontend offline workers can fetch
	w.Header().Set("Access-Control-Allow-Origin", "*")

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "Failed to read MapTiler response", http.StatusInternalServerError)
		return
	}
	
	bodyStr := string(bodyBytes)
	// Strip the API key
	bodyStr = strings.ReplaceAll(bodyStr, "?key="+h.cfg.MapTilerAPIKey, "")
	bodyStr = strings.ReplaceAll(bodyStr, "&key="+h.cfg.MapTilerAPIKey, "")
	
	// Rewrite URLs to our local proxy
	bodyStr = strings.ReplaceAll(bodyStr, "https://api.maptiler.com", "/api/v1/map/proxy")

	w.Header().Set("Content-Type", "application/json")
	// Cache rewritten JSON in Go memory
	h.jsonCache.Store(path, bodyStr)
	w.WriteHeader(resp.StatusCode)
	w.Write([]byte(bodyStr))
}
