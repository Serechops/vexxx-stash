// Package singleflight provides utilities to suppress duplicate function calls.
// This is useful for preventing duplicate database queries when multiple
// goroutines request the same resource simultaneously.
package singleflight

import (
	"context"
	"fmt"
	"sync"

	"golang.org/x/sync/singleflight"
)

// Group wraps golang.org/x/sync/singleflight.Group with additional utilities.
type Group struct {
	sf singleflight.Group
}

// NewGroup creates a new singleflight Group.
func NewGroup() *Group {
	return &Group{}
}

// Do executes fn if there's no call in-flight for this key; otherwise it waits
// for the in-flight call to complete and returns the same result.
func (g *Group) Do(key string, fn func() (interface{}, error)) (interface{}, error, bool) {
	return g.sf.Do(key, fn)
}

// DoChan is like Do but returns a channel that will receive the result.
func (g *Group) DoChan(key string, fn func() (interface{}, error)) <-chan singleflight.Result {
	return g.sf.DoChan(key, fn)
}

// Forget tells the singleflight to forget about a key.
func (g *Group) Forget(key string) {
	g.sf.Forget(key)
}

// EntityLoader is a generic loader that uses singleflight to deduplicate requests.
type EntityLoader[T any] struct {
	sf        singleflight.Group
	loadFn    func(ctx context.Context, id int) (T, error)
	keyPrefix string
}

// NewEntityLoader creates a new EntityLoader with the given load function.
func NewEntityLoader[T any](keyPrefix string, loadFn func(ctx context.Context, id int) (T, error)) *EntityLoader[T] {
	return &EntityLoader[T]{
		loadFn:    loadFn,
		keyPrefix: keyPrefix,
	}
}

// Load retrieves an entity by ID, deduplicating concurrent requests for the same ID.
func (l *EntityLoader[T]) Load(ctx context.Context, id int) (T, error) {
	key := fmt.Sprintf("%s:%d", l.keyPrefix, id)

	v, err, _ := l.sf.Do(key, func() (interface{}, error) {
		return l.loadFn(ctx, id)
	})

	if err != nil {
		var zero T
		return zero, err
	}

	return v.(T), nil
}

// LoadMany retrieves multiple entities by ID.
// Note: This does not deduplicate across IDs, only concurrent requests for the same ID.
func (l *EntityLoader[T]) LoadMany(ctx context.Context, ids []int) ([]T, error) {
	results := make([]T, len(ids))
	var mu sync.Mutex
	var wg sync.WaitGroup
	var firstErr error

	for i, id := range ids {
		wg.Add(1)
		go func(idx, entityID int) {
			defer wg.Done()

			result, err := l.Load(ctx, entityID)
			mu.Lock()
			defer mu.Unlock()

			if err != nil && firstErr == nil {
				firstErr = err
			} else if err == nil {
				results[idx] = result
			}
		}(i, id)
	}

	wg.Wait()
	return results, firstErr
}

// Forget removes the cached result for an ID.
func (l *EntityLoader[T]) Forget(id int) {
	key := fmt.Sprintf("%s:%d", l.keyPrefix, id)
	l.sf.Forget(key)
}

// StringKeyLoader is like EntityLoader but uses string keys.
type StringKeyLoader[T any] struct {
	sf        singleflight.Group
	loadFn    func(ctx context.Context, key string) (T, error)
	keyPrefix string
}

// NewStringKeyLoader creates a new StringKeyLoader with the given load function.
func NewStringKeyLoader[T any](keyPrefix string, loadFn func(ctx context.Context, key string) (T, error)) *StringKeyLoader[T] {
	return &StringKeyLoader[T]{
		loadFn:    loadFn,
		keyPrefix: keyPrefix,
	}
}

// Load retrieves an entity by string key, deduplicating concurrent requests.
func (l *StringKeyLoader[T]) Load(ctx context.Context, key string) (T, error) {
	fullKey := l.keyPrefix + ":" + key

	v, err, _ := l.sf.Do(fullKey, func() (interface{}, error) {
		return l.loadFn(ctx, key)
	})

	if err != nil {
		var zero T
		return zero, err
	}

	return v.(T), nil
}

// Forget removes the cached result for a key.
func (l *StringKeyLoader[T]) Forget(key string) {
	fullKey := l.keyPrefix + ":" + key
	l.sf.Forget(fullKey)
}
