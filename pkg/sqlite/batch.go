package sqlite

import (
	"context"
	"runtime"
	"sync"

	"golang.org/x/sync/errgroup"
)

const defaultBatchSize = 1000

// batchExec executes the provided function in batches of the provided size.
func batchExec[T any](ids []T, batchSize int, fn func(batch []T) error) error {
	for i := 0; i < len(ids); i += batchSize {
		end := i + batchSize
		if end > len(ids) {
			end = len(ids)
		}

		batch := ids[i:end]
		if err := fn(batch); err != nil {
			return err
		}
	}

	return nil
}

// batchExecConcurrent executes the provided function in batches concurrently.
// It uses errgroup to limit concurrency and collect errors.
// This is useful for operations that are safe to run in parallel (e.g., read-only queries).
// Note: SQLite has limited write concurrency, so this is primarily for read operations.
func batchExecConcurrent[T any](ctx context.Context, ids []T, batchSize int, maxWorkers int, fn func(ctx context.Context, batch []T) error) error {
	if len(ids) == 0 {
		return nil
	}

	// Limit workers to available CPUs and batch count
	if maxWorkers <= 0 {
		maxWorkers = runtime.NumCPU()
	}
	batchCount := (len(ids) + batchSize - 1) / batchSize
	if maxWorkers > batchCount {
		maxWorkers = batchCount
	}

	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(maxWorkers)

	for i := 0; i < len(ids); i += batchSize {
		start := i
		end := i + batchSize
		if end > len(ids) {
			end = len(ids)
		}

		g.Go(func() error {
			return fn(ctx, ids[start:end])
		})
	}

	return g.Wait()
}

// parallelProcess processes items concurrently using a worker pool.
// Results are returned in the same order as the input.
// This is useful for operations like loading related data for multiple entities.
func parallelProcess[T any, R any](ctx context.Context, items []T, maxWorkers int, process func(ctx context.Context, item T) (R, error)) ([]R, error) {
	if len(items) == 0 {
		return nil, nil
	}

	if maxWorkers <= 0 {
		maxWorkers = runtime.NumCPU()
	}
	if maxWorkers > len(items) {
		maxWorkers = len(items)
	}

	results := make([]R, len(items))
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(maxWorkers)

	for i, item := range items {
		i, item := i, item // capture loop variables
		g.Go(func() error {
			result, err := process(ctx, item)
			if err != nil {
				return err
			}
			results[i] = result
			return nil
		})
	}

	if err := g.Wait(); err != nil {
		return nil, err
	}

	return results, nil
}

// WorkerPool manages a pool of workers for processing items.
type WorkerPool[T any, R any] struct {
	maxWorkers int
	process    func(ctx context.Context, item T) (R, error)
}

// NewWorkerPool creates a new worker pool.
func NewWorkerPool[T any, R any](maxWorkers int, process func(ctx context.Context, item T) (R, error)) *WorkerPool[T, R] {
	if maxWorkers <= 0 {
		maxWorkers = runtime.NumCPU()
	}
	return &WorkerPool[T, R]{
		maxWorkers: maxWorkers,
		process:    process,
	}
}

// Process processes all items using the worker pool.
func (p *WorkerPool[T, R]) Process(ctx context.Context, items []T) ([]R, error) {
	return parallelProcess(ctx, items, p.maxWorkers, p.process)
}

// MapConcurrent applies a function to each item concurrently and returns results in a map.
func MapConcurrent[K comparable, V any, R any](ctx context.Context, items map[K]V, maxWorkers int, fn func(ctx context.Context, key K, value V) (R, error)) (map[K]R, error) {
	if len(items) == 0 {
		return nil, nil
	}

	if maxWorkers <= 0 {
		maxWorkers = runtime.NumCPU()
	}
	if maxWorkers > len(items) {
		maxWorkers = len(items)
	}

	results := make(map[K]R, len(items))
	var mu sync.Mutex

	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(maxWorkers)

	for k, v := range items {
		k, v := k, v
		g.Go(func() error {
			result, err := fn(ctx, k, v)
			if err != nil {
				return err
			}
			mu.Lock()
			results[k] = result
			mu.Unlock()
			return nil
		})
	}

	if err := g.Wait(); err != nil {
		return nil, err
	}

	return results, nil
}
