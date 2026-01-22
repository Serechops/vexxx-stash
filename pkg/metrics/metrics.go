// Package metrics provides application metrics using expvar.
package metrics

import (
	"encoding/json"
	"expvar"
	"sync/atomic"
	"time"
)

// Database metrics
var (
	DBQueriesTotal     = expvar.NewInt("db_queries_total")
	DBSlowQueriesTotal = expvar.NewInt("db_slow_queries_total")
	DBErrorsTotal      = expvar.NewInt("db_errors_total")
)

// Cache metrics
var (
	CacheHitsTotal   = expvar.NewInt("cache_hits_total")
	CacheMissesTotal = expvar.NewInt("cache_misses_total")
	CacheSize        = expvar.NewInt("cache_size")
)

// Job metrics
var (
	JobsRunning   = expvar.NewInt("jobs_running")
	JobsCompleted = expvar.NewInt("jobs_completed")
	JobsFailed    = expvar.NewInt("jobs_failed")
	JobsQueued    = expvar.NewInt("jobs_queued")
)

// API metrics
var (
	APIRequestsTotal = expvar.NewInt("api_requests_total")
	APIErrorsTotal   = expvar.NewInt("api_errors_total")
)

// SlowQueryThreshold defines the threshold for logging slow queries.
const SlowQueryThreshold = 100 * time.Millisecond

// Timer is a helper for measuring operation duration.
type Timer struct {
	start   time.Time
	counter *expvar.Int
}

// NewTimer creates a new timer and records the start time.
func NewTimer(counter *expvar.Int) *Timer {
	return &Timer{
		start:   time.Now(),
		counter: counter,
	}
}

// Done stops the timer and increments the counter.
// Returns the elapsed duration.
func (t *Timer) Done() time.Duration {
	duration := time.Since(t.start)
	if t.counter != nil {
		t.counter.Add(1)
	}
	return duration
}

// Counter is a simple atomic counter.
type Counter struct {
	value int64
}

// NewCounter creates a new counter.
func NewCounter() *Counter {
	return &Counter{}
}

// Inc increments the counter by 1.
func (c *Counter) Inc() {
	atomic.AddInt64(&c.value, 1)
}

// Add adds delta to the counter.
func (c *Counter) Add(delta int64) {
	atomic.AddInt64(&c.value, delta)
}

// Value returns the current counter value.
func (c *Counter) Value() int64 {
	return atomic.LoadInt64(&c.value)
}

// Reset resets the counter to 0.
func (c *Counter) Reset() {
	atomic.StoreInt64(&c.value, 0)
}

// Gauge is a value that can go up and down.
type Gauge struct {
	value int64
}

// NewGauge creates a new gauge.
func NewGauge() *Gauge {
	return &Gauge{}
}

// Set sets the gauge to the given value.
func (g *Gauge) Set(value int64) {
	atomic.StoreInt64(&g.value, value)
}

// Inc increments the gauge by 1.
func (g *Gauge) Inc() {
	atomic.AddInt64(&g.value, 1)
}

// Dec decrements the gauge by 1.
func (g *Gauge) Dec() {
	atomic.AddInt64(&g.value, -1)
}

// Add adds delta to the gauge.
func (g *Gauge) Add(delta int64) {
	atomic.AddInt64(&g.value, delta)
}

// Value returns the current gauge value.
func (g *Gauge) Value() int64 {
	return atomic.LoadInt64(&g.value)
}

// Histogram tracks the distribution of values.
type Histogram struct {
	count int64
	sum   int64
	min   int64
	max   int64
}

// NewHistogram creates a new histogram.
func NewHistogram() *Histogram {
	return &Histogram{
		min: int64(^uint64(0) >> 1), // max int64
	}
}

// Observe records a value in the histogram.
func (h *Histogram) Observe(value int64) {
	atomic.AddInt64(&h.count, 1)
	atomic.AddInt64(&h.sum, value)

	// Update min (not perfectly atomic, but good enough for metrics)
	for {
		old := atomic.LoadInt64(&h.min)
		if value >= old {
			break
		}
		if atomic.CompareAndSwapInt64(&h.min, old, value) {
			break
		}
	}

	// Update max
	for {
		old := atomic.LoadInt64(&h.max)
		if value <= old {
			break
		}
		if atomic.CompareAndSwapInt64(&h.max, old, value) {
			break
		}
	}
}

// Count returns the number of observations.
func (h *Histogram) Count() int64 {
	return atomic.LoadInt64(&h.count)
}

// Sum returns the sum of all observations.
func (h *Histogram) Sum() int64 {
	return atomic.LoadInt64(&h.sum)
}

// Mean returns the mean of all observations.
func (h *Histogram) Mean() float64 {
	count := atomic.LoadInt64(&h.count)
	if count == 0 {
		return 0
	}
	return float64(atomic.LoadInt64(&h.sum)) / float64(count)
}

// Min returns the minimum observed value.
func (h *Histogram) Min() int64 {
	min := atomic.LoadInt64(&h.min)
	if min == int64(^uint64(0)>>1) {
		return 0
	}
	return min
}

// Max returns the maximum observed value.
func (h *Histogram) Max() int64 {
	return atomic.LoadInt64(&h.max)
}

// Reset resets the histogram.
func (h *Histogram) Reset() {
	atomic.StoreInt64(&h.count, 0)
	atomic.StoreInt64(&h.sum, 0)
	atomic.StoreInt64(&h.min, int64(^uint64(0)>>1))
	atomic.StoreInt64(&h.max, 0)
}

// RecordDBQuery is a helper for recording database query metrics.
func RecordDBQuery(duration time.Duration, err error) {
	DBQueriesTotal.Add(1)
	if duration > SlowQueryThreshold {
		DBSlowQueriesTotal.Add(1)
	}
	if err != nil {
		DBErrorsTotal.Add(1)
	}
}

// RecordCacheAccess is a helper for recording cache access metrics.
func RecordCacheAccess(hit bool) {
	if hit {
		CacheHitsTotal.Add(1)
	} else {
		CacheMissesTotal.Add(1)
	}
}

// RecordJobStart is a helper for recording job start.
func RecordJobStart() {
	JobsRunning.Add(1)
}

// RecordJobComplete is a helper for recording job completion.
func RecordJobComplete(success bool) {
	JobsRunning.Add(-1)
	if success {
		JobsCompleted.Add(1)
	} else {
		JobsFailed.Add(1)
	}
}

// MetricsSnapshot holds a snapshot of all metrics.
type MetricsSnapshot struct {
	Database struct {
		QueriesTotal     int64 `json:"queries_total"`
		SlowQueriesTotal int64 `json:"slow_queries_total"`
		ErrorsTotal      int64 `json:"errors_total"`
	} `json:"database"`
	Cache struct {
		HitsTotal   int64 `json:"hits_total"`
		MissesTotal int64 `json:"misses_total"`
		Size        int64 `json:"size"`
	} `json:"cache"`
	Jobs struct {
		Running   int64 `json:"running"`
		Completed int64 `json:"completed"`
		Failed    int64 `json:"failed"`
		Queued    int64 `json:"queued"`
	} `json:"jobs"`
	API struct {
		RequestsTotal int64 `json:"requests_total"`
		ErrorsTotal   int64 `json:"errors_total"`
	} `json:"api"`
}

// Snapshot returns a snapshot of all metrics.
func Snapshot() MetricsSnapshot {
	var s MetricsSnapshot
	s.Database.QueriesTotal = DBQueriesTotal.Value()
	s.Database.SlowQueriesTotal = DBSlowQueriesTotal.Value()
	s.Database.ErrorsTotal = DBErrorsTotal.Value()
	s.Cache.HitsTotal = CacheHitsTotal.Value()
	s.Cache.MissesTotal = CacheMissesTotal.Value()
	s.Cache.Size = CacheSize.Value()
	s.Jobs.Running = JobsRunning.Value()
	s.Jobs.Completed = JobsCompleted.Value()
	s.Jobs.Failed = JobsFailed.Value()
	s.Jobs.Queued = JobsQueued.Value()
	s.API.RequestsTotal = APIRequestsTotal.Value()
	s.API.ErrorsTotal = APIErrorsTotal.Value()
	return s
}

// WriteJSONResponse writes a JSON response to the writer.
func WriteJSONResponse(w interface{ Write([]byte) (int, error) }, v interface{}) {
	// Use standard encoding/json for now; could optimize with pooled encoder later
	data, err := json.Marshal(v)
	if err != nil {
		w.Write([]byte(`{"error":"` + err.Error() + `"}`))
		return
	}
	w.Write(data)
}
