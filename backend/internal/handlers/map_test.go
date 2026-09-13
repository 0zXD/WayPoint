package handlers

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"waypoint-backend/internal/config"
)

type roundTripFunc func(req *http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestBinaryCache_SetAndGet(t *testing.T) {
	cache := NewBinaryCache(10)

	asset := &binaryAsset{
		data:        []byte("test image data"),
		contentType: "image/jpeg",
	}

	cache.Set("test/key.jpg", asset)

	got, ok := cache.Get("test/key.jpg")
	if !ok {
		t.Fatalf("expected key to exist in cache")
	}
	if string(got.data) != "test image data" {
		t.Fatalf("got data %q, want 'test image data'", string(got.data))
	}
	if got.contentType != "image/jpeg" {
		t.Fatalf("got contentType %q, want 'image/jpeg'", got.contentType)
	}
}

func TestBinaryCache_Eviction(t *testing.T) {
	capacity := 10
	cache := NewBinaryCache(capacity)

	// Fill to capacity
	for i := 0; i < capacity; i++ {
		cache.Set(fmt.Sprintf("key-%d", i), &binaryAsset{
			data:        []byte(fmt.Sprintf("val-%d", i)),
			contentType: "application/octet-stream",
		})
	}

	if len(cache.items) != capacity {
		t.Fatalf("expected cache size %d, got %d", capacity, len(cache.items))
	}

	// Add 1 more item, should trigger eviction of 10% (1 item)
	cache.Set("overflow-key", &binaryAsset{
		data:        []byte("overflow-val"),
		contentType: "application/octet-stream",
	})

	// Oldest item ("key-0") should have been evicted
	if _, ok := cache.Get("key-0"); ok {
		t.Fatalf("expected key-0 to have been evicted")
	}

	// Newer item should be present
	if _, ok := cache.Get("overflow-key"); !ok {
		t.Fatalf("expected overflow-key to be present")
	}
}

func TestMapHandler_BinaryCacheProxy(t *testing.T) {
	requestCount := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.Header().Set("Content-Type", "image/jpeg")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("mock tile image bytes"))
	}))
	defer upstream.Close()

	cfg := &config.Config{
		MapTilerAPIKey: "test-api-key",
	}
	h := NewMapHandler(cfg)

	// Override url by pointing directly through an HTTP handler test
	// We test the cache mechanism directly on h.binCache
	tileKey := "tiles/satellite-v2/3/4/2.jpg"
	h.binCache.Set(tileKey, &binaryAsset{
		data:        []byte("cached satellite jpeg"),
		contentType: "image/jpeg",
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/map/proxy/"+tileKey, nil)
	req.SetPathValue("path", tileKey)
	rec := httptest.NewRecorder()

	h.Proxy(rec, req)

	res := rec.Result()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", res.StatusCode)
	}
	if res.Header.Get("X-Cache") != "HIT" {
		t.Fatalf("expected X-Cache: HIT, got %q", res.Header.Get("X-Cache"))
	}
	if res.Header.Get("Content-Type") != "image/jpeg" {
		t.Fatalf("expected Content-Type: image/jpeg, got %q", res.Header.Get("Content-Type"))
	}
	if rec.Body.String() != "cached satellite jpeg" {
		t.Fatalf("got body %q, want 'cached satellite jpeg'", rec.Body.String())
	}
}

func TestMapHandler_PredictivePrefetch(t *testing.T) {
	satHit := make(chan string, 1)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		satHit <- r.URL.Path
		w.Header().Set("Content-Type", "image/jpeg")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("satellite tile data"))
	}))
	defer upstream.Close()

	cfg := &config.Config{
		MapTilerAPIKey: "test-api-key",
	}
	h := NewMapHandler(cfg)

	// Redirect outbound requests to our mock server
	h.binClient = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			req.URL.Scheme = "http"
			req.URL.Host = upstream.Listener.Addr().String()
			return http.DefaultTransport.RoundTrip(req)
		}),
	}

	// Requesting a vector tile (v3/10/100/200.pbf) should asynchronously enqueue
	// and fetch the matching satellite tile (satellite-v2/10/100/200.jpg) via worker pool
	vectorPath := "tiles/v3/10/100/200.pbf"
	satPath := "tiles/satellite-v2/10/100/200.jpg"

	h.triggerSatellitePrefetch(vectorPath)

	select {
	case hit := <-satHit:
		if !strings.Contains(hit, "satellite-v2/10/100/200.jpg") {
			t.Fatalf("expected satellite fetch for 10/100/200, got %q", hit)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for predictive satellite prefetch")
	}

	// Verify it was stored in memory cache
	time.Sleep(50 * time.Millisecond)
	cached, ok := h.binCache.Get(satPath)
	if !ok {
		t.Fatalf("expected %s to be cached in binCache", satPath)
	}
	if string(cached.data) != "satellite tile data" {
		t.Fatalf("got data %q, want 'satellite tile data'", string(cached.data))
	}
}

func TestMapHandler_PrefetchEndpoint(t *testing.T) {
	fetchHit := make(chan string, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fetchHit <- r.URL.Path
		w.Header().Set("Content-Type", "image/jpeg")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("tokyo satellite image"))
	}))
	defer upstream.Close()

	cfg := &config.Config{
		MapTilerAPIKey: "test-api-key",
	}
	h := NewMapHandler(cfg)
	h.binClient = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			req.URL.Scheme = "http"
			req.URL.Host = upstream.Listener.Addr().String()
			return http.DefaultTransport.RoundTrip(req)
		}),
	}

	tile := "tiles/satellite-v2/14/14553/6451.jpg"
	body := fmt.Sprintf(`{"tiles":["%s"]}`, tile)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/map/prefetch", strings.NewReader(body))
	rec := httptest.NewRecorder()

	h.Prefetch(rec, req)

	res := rec.Result()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK from Prefetch, got %d", res.StatusCode)
	}

	select {
	case hit := <-fetchHit:
		if !strings.Contains(hit, "14/14553/6451.jpg") {
			t.Fatalf("expected fetch for tokyo tile, got %q", hit)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for Prefetch endpoint to fetch tile")
	}

	time.Sleep(50 * time.Millisecond)
	cached, ok := h.binCache.Get(tile)
	if !ok {
		t.Fatalf("expected tile to be cached in binCache after Prefetch")
	}
	if string(cached.data) != "tokyo satellite image" {
		t.Fatalf("got %q, want 'tokyo satellite image'", string(cached.data))
	}
}

func TestMapHandler_PrefetchEndpoint_VectorTile(t *testing.T) {
	fetchHit := make(chan string, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fetchHit <- r.URL.Path
		w.Header().Set("Content-Type", "application/x-protobuf")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("tokyo vector tile pbf data"))
	}))
	defer upstream.Close()

	cfg := &config.Config{
		MapTilerAPIKey: "test-api-key",
	}
	h := NewMapHandler(cfg)
	h.binClient = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			req.URL.Scheme = "http"
			req.URL.Host = upstream.Listener.Addr().String()
			return http.DefaultTransport.RoundTrip(req)
		}),
	}

	tile := "tiles/v3/14/14553/6451.pbf"
	body := fmt.Sprintf(`{"paths":["%s"]}`, tile)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/map/prefetch", strings.NewReader(body))
	rec := httptest.NewRecorder()

	h.Prefetch(rec, req)

	res := rec.Result()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK from Prefetch, got %d", res.StatusCode)
	}

	select {
	case hit := <-fetchHit:
		if !strings.Contains(hit, "14/14553/6451.pbf") {
			t.Fatalf("expected fetch for vector tile, got %q", hit)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for Prefetch endpoint to fetch vector tile")
	}

	time.Sleep(50 * time.Millisecond)
	cached, ok := h.binCache.Get(tile)
	if !ok {
		t.Fatalf("expected vector tile to be cached in binCache after Prefetch")
	}
	if string(cached.data) != "tokyo vector tile pbf data" {
		t.Fatalf("got %q, want 'tokyo vector tile pbf data'", string(cached.data))
	}
}

