// Package debug provides HTTP endpoints for profiling and metrics.
// These endpoints are intended for development and debugging purposes.
package debug

import (
	"expvar"
	"net/http"
	"net/http/pprof"
	"runtime"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stashapp/stash/pkg/metrics"
)

// Config holds configuration for debug endpoints.
type Config struct {
	// Enabled determines if debug endpoints are available.
	Enabled bool
	// EnablePprof determines if pprof profiling endpoints are available.
	EnablePprof bool
	// EnableMetrics determines if metrics endpoints are available.
	EnableMetrics bool
}

// DefaultConfig returns a default debug configuration.
// By default, debug endpoints are disabled for security.
func DefaultConfig() Config {
	return Config{
		Enabled:       false,
		EnablePprof:   false,
		EnableMetrics: true,
	}
}

// Handler returns an HTTP handler for debug endpoints.
func Handler(cfg Config) http.Handler {
	r := chi.NewRouter()

	if !cfg.Enabled {
		r.HandleFunc("/*", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Debug endpoints disabled", http.StatusNotFound)
		})
		return r
	}

	// Basic stats endpoint
	r.Get("/stats", statsHandler)

	// Metrics endpoint (expvar)
	if cfg.EnableMetrics {
		r.Get("/vars", expvar.Handler().ServeHTTP)
		r.Get("/metrics", metricsHandler)
	}

	// pprof endpoints
	if cfg.EnablePprof {
		r.HandleFunc("/pprof/", pprof.Index)
		r.HandleFunc("/pprof/cmdline", pprof.Cmdline)
		r.HandleFunc("/pprof/profile", pprof.Profile)
		r.HandleFunc("/pprof/symbol", pprof.Symbol)
		r.HandleFunc("/pprof/trace", pprof.Trace)
		r.Handle("/pprof/goroutine", pprof.Handler("goroutine"))
		r.Handle("/pprof/heap", pprof.Handler("heap"))
		r.Handle("/pprof/threadcreate", pprof.Handler("threadcreate"))
		r.Handle("/pprof/block", pprof.Handler("block"))
		r.Handle("/pprof/allocs", pprof.Handler("allocs"))
		r.Handle("/pprof/mutex", pprof.Handler("mutex"))
	}

	// GC trigger endpoint (useful for testing memory)
	r.Post("/gc", gcHandler)

	return r
}

// RuntimeStats holds runtime statistics.
type RuntimeStats struct {
	Goroutines   int    `json:"goroutines"`
	HeapAlloc    uint64 `json:"heap_alloc"`
	HeapSys      uint64 `json:"heap_sys"`
	HeapObjects  uint64 `json:"heap_objects"`
	StackInUse   uint64 `json:"stack_in_use"`
	NumGC        uint32 `json:"num_gc"`
	LastGC       int64  `json:"last_gc_unix"`
	PauseNs      uint64 `json:"pause_ns"`
	GCCPUPercent float64 `json:"gc_cpu_percent"`
	Uptime       int64  `json:"uptime_seconds"`
}

var startTime = time.Now()

func statsHandler(w http.ResponseWriter, r *http.Request) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	stats := RuntimeStats{
		Goroutines:   runtime.NumGoroutine(),
		HeapAlloc:    m.HeapAlloc,
		HeapSys:      m.HeapSys,
		HeapObjects:  m.HeapObjects,
		StackInUse:   m.StackInuse,
		NumGC:        m.NumGC,
		LastGC:       int64(m.LastGC),
		PauseNs:      m.PauseNs[(m.NumGC+255)%256],
		GCCPUPercent: m.GCCPUFraction * 100,
		Uptime:       int64(time.Since(startTime).Seconds()),
	}

	w.Header().Set("Content-Type", "application/json")
	metrics.WriteJSONResponse(w, stats)
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	metrics.WriteJSONResponse(w, metrics.Snapshot())
}

func gcHandler(w http.ResponseWriter, r *http.Request) {
	before := getHeapAlloc()
	runtime.GC()
	after := getHeapAlloc()

	response := map[string]interface{}{
		"freed_bytes": before - after,
		"heap_before": before,
		"heap_after":  after,
	}

	w.Header().Set("Content-Type", "application/json")
	metrics.WriteJSONResponse(w, response)
}

func getHeapAlloc() uint64 {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return m.HeapAlloc
}
