package api

import (
	"context"
	"runtime"
)

func (r *queryResolver) SystemStats(ctx context.Context) (*SystemStats, error) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	ret := &SystemStats{
		// Alloc is bytes of allocated heap objects.
		// converting bytes to megabytes
		Memory:     float64(m.Alloc) / 1024 / 1024,
		Goroutines: runtime.NumGoroutine(),
	}

	return ret, nil
}
