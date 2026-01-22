package sqlite

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestBatchExec(t *testing.T) {
	ids := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
	var batches [][]int

	err := batchExec(ids, 3, func(batch []int) error {
		batches = append(batches, batch)
		return nil
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(batches) != 4 {
		t.Errorf("expected 4 batches, got %d", len(batches))
	}

	// Verify batch contents
	expected := [][]int{{1, 2, 3}, {4, 5, 6}, {7, 8, 9}, {10}}
	for i, batch := range batches {
		if len(batch) != len(expected[i]) {
			t.Errorf("batch %d: expected length %d, got %d", i, len(expected[i]), len(batch))
		}
		for j, v := range batch {
			if v != expected[i][j] {
				t.Errorf("batch %d, element %d: expected %d, got %d", i, j, expected[i][j], v)
			}
		}
	}
}

func TestBatchExecConcurrent(t *testing.T) {
	ctx := context.Background()
	ids := make([]int, 100)
	for i := range ids {
		ids[i] = i
	}

	var processed int64

	err := batchExecConcurrent(ctx, ids, 10, 4, func(ctx context.Context, batch []int) error {
		atomic.AddInt64(&processed, int64(len(batch)))
		return nil
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if processed != 100 {
		t.Errorf("expected 100 processed items, got %d", processed)
	}
}

func TestBatchExecConcurrentError(t *testing.T) {
	ctx := context.Background()
	ids := make([]int, 100)
	for i := range ids {
		ids[i] = i
	}

	testErr := errors.New("test error")
	var processed int64

	err := batchExecConcurrent(ctx, ids, 10, 4, func(ctx context.Context, batch []int) error {
		count := atomic.AddInt64(&processed, 1)
		if count == 3 {
			return testErr
		}
		return nil
	})

	if !errors.Is(err, testErr) {
		t.Errorf("expected test error, got: %v", err)
	}
}

func TestBatchExecConcurrentCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	ids := make([]int, 100)
	for i := range ids {
		ids[i] = i
	}

	var started int64

	err := batchExecConcurrent(ctx, ids, 10, 4, func(ctx context.Context, batch []int) error {
		atomic.AddInt64(&started, 1)
		if atomic.LoadInt64(&started) >= 3 {
			cancel()
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
			return nil
		}
	})

	if !errors.Is(err, context.Canceled) {
		t.Errorf("expected context.Canceled, got: %v", err)
	}
}

func TestParallelProcess(t *testing.T) {
	ctx := context.Background()
	items := []int{1, 2, 3, 4, 5}

	results, err := parallelProcess(ctx, items, 2, func(ctx context.Context, item int) (int, error) {
		return item * 2, nil
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := []int{2, 4, 6, 8, 10}
	for i, r := range results {
		if r != expected[i] {
			t.Errorf("result %d: expected %d, got %d", i, expected[i], r)
		}
	}
}

func TestParallelProcessPreservesOrder(t *testing.T) {
	ctx := context.Background()
	items := make([]int, 100)
	for i := range items {
		items[i] = i
	}

	results, err := parallelProcess(ctx, items, 10, func(ctx context.Context, item int) (int, error) {
		// Add some jitter to test ordering
		time.Sleep(time.Duration(item%10) * time.Microsecond)
		return item * 2, nil
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for i, r := range results {
		expected := i * 2
		if r != expected {
			t.Errorf("result %d: expected %d, got %d", i, expected, r)
		}
	}
}

func TestWorkerPool(t *testing.T) {
	pool := NewWorkerPool(4, func(ctx context.Context, item string) (int, error) {
		return len(item), nil
	})

	ctx := context.Background()
	items := []string{"a", "bb", "ccc", "dddd", "eeeee"}

	results, err := pool.Process(ctx, items)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := []int{1, 2, 3, 4, 5}
	for i, r := range results {
		if r != expected[i] {
			t.Errorf("result %d: expected %d, got %d", i, expected[i], r)
		}
	}
}

func TestMapConcurrent(t *testing.T) {
	ctx := context.Background()
	items := map[string]int{"a": 1, "b": 2, "c": 3}

	results, err := MapConcurrent(ctx, items, 2, func(ctx context.Context, key string, value int) (string, error) {
		return key + "!", nil
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(results) != 3 {
		t.Errorf("expected 3 results, got %d", len(results))
	}

	for k := range items {
		if results[k] != k+"!" {
			t.Errorf("result for %s: expected %s, got %s", k, k+"!", results[k])
		}
	}
}

func TestBatchExecEmpty(t *testing.T) {
	var called bool
	err := batchExec([]int{}, 10, func(batch []int) error {
		called = true
		return nil
	})

	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if called {
		t.Error("function should not be called for empty slice")
	}
}

func TestBatchExecConcurrentEmpty(t *testing.T) {
	ctx := context.Background()
	var called bool
	err := batchExecConcurrent(ctx, []int{}, 10, 4, func(ctx context.Context, batch []int) error {
		called = true
		return nil
	})

	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if called {
		t.Error("function should not be called for empty slice")
	}
}

// Benchmarks

func BenchmarkBatchExec(b *testing.B) {
	ids := make([]int, 10000)
	for i := range ids {
		ids[i] = i
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = batchExec(ids, 1000, func(batch []int) error {
			// Simulate some work
			sum := 0
			for _, v := range batch {
				sum += v
			}
			return nil
		})
	}
}

func BenchmarkBatchExecConcurrent(b *testing.B) {
	ids := make([]int, 10000)
	for i := range ids {
		ids[i] = i
	}
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = batchExecConcurrent(ctx, ids, 1000, 4, func(ctx context.Context, batch []int) error {
			// Simulate some work
			sum := 0
			for _, v := range batch {
				sum += v
			}
			return nil
		})
	}
}

func BenchmarkParallelProcess(b *testing.B) {
	items := make([]int, 1000)
	for i := range items {
		items[i] = i
	}
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = parallelProcess(ctx, items, 4, func(ctx context.Context, item int) (int, error) {
			return item * 2, nil
		})
	}
}
