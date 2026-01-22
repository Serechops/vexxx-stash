package cache

import (
	"context"
	"fmt"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// EntityCache combines LRU caching with singleflight to provide
// an efficient cache for database entities.
type EntityCache[T any] struct {
	lru        *LRU[int, T]
	sf         singleflight.Group
	loadFn     func(ctx context.Context, id int) (T, error)
	keyPrefix  string
	stats      EntityCacheStats
	statsMutex sync.RWMutex
}

// EntityCacheStats tracks cache performance metrics.
type EntityCacheStats struct {
	Hits       int64
	Misses     int64
	Loads      int64
	LoadErrors int64
}

// EntityCacheConfig holds configuration for EntityCache.
type EntityCacheConfig struct {
	// Capacity is the maximum number of entities to cache.
	Capacity int
	// TTL is the time-to-live for cached entities.
	TTL time.Duration
	// KeyPrefix is used for singleflight key generation.
	KeyPrefix string
}

// NewEntityCache creates a new entity cache.
func NewEntityCache[T any](config EntityCacheConfig, loadFn func(ctx context.Context, id int) (T, error)) *EntityCache[T] {
	if config.Capacity <= 0 {
		config.Capacity = 1000
	}
	if config.KeyPrefix == "" {
		config.KeyPrefix = "entity"
	}

	return &EntityCache[T]{
		lru: NewWithConfig[int, T](Config{
			Capacity: config.Capacity,
			TTL:      config.TTL,
		}),
		loadFn:    loadFn,
		keyPrefix: config.KeyPrefix,
	}
}

// Get retrieves an entity by ID, using the cache if available.
// Concurrent requests for the same ID are deduplicated via singleflight.
func (c *EntityCache[T]) Get(ctx context.Context, id int) (T, error) {
	// Try cache first
	if val, ok := c.lru.Get(id); ok {
		c.recordHit()
		return val, nil
	}

	c.recordMiss()

	// Use singleflight to prevent duplicate loads
	key := fmt.Sprintf("%s:%d", c.keyPrefix, id)
	v, err, _ := c.sf.Do(key, func() (interface{}, error) {
		c.recordLoad()

		// Double-check cache (another goroutine might have loaded it)
		if val, ok := c.lru.Get(id); ok {
			return val, nil
		}

		// Load from source
		val, err := c.loadFn(ctx, id)
		if err != nil {
			c.recordLoadError()
			return val, err
		}

		// Cache the result
		c.lru.Set(id, val)
		return val, nil
	})

	if err != nil {
		var zero T
		return zero, err
	}

	return v.(T), nil
}

// GetMany retrieves multiple entities by ID.
func (c *EntityCache[T]) GetMany(ctx context.Context, ids []int) ([]T, error) {
	results := make([]T, len(ids))
	var wg sync.WaitGroup
	var mu sync.Mutex
	var firstErr error

	for i, id := range ids {
		wg.Add(1)
		go func(idx, entityID int) {
			defer wg.Done()

			val, err := c.Get(ctx, entityID)

			mu.Lock()
			defer mu.Unlock()

			if err != nil && firstErr == nil {
				firstErr = err
			} else if err == nil {
				results[idx] = val
			}
		}(i, id)
	}

	wg.Wait()
	return results, firstErr
}

// Set manually sets a value in the cache.
func (c *EntityCache[T]) Set(id int, value T) {
	c.lru.Set(id, value)
}

// Invalidate removes an entity from the cache.
func (c *EntityCache[T]) Invalidate(id int) {
	c.lru.Delete(id)
	key := fmt.Sprintf("%s:%d", c.keyPrefix, id)
	c.sf.Forget(key)
}

// InvalidateMany removes multiple entities from the cache.
func (c *EntityCache[T]) InvalidateMany(ids []int) {
	for _, id := range ids {
		c.Invalidate(id)
	}
}

// Clear removes all entities from the cache.
func (c *EntityCache[T]) Clear() {
	c.lru.Clear()
}

// Stats returns cache statistics.
func (c *EntityCache[T]) Stats() EntityCacheStats {
	c.statsMutex.RLock()
	defer c.statsMutex.RUnlock()
	return c.stats
}

// ResetStats resets cache statistics.
func (c *EntityCache[T]) ResetStats() {
	c.statsMutex.Lock()
	defer c.statsMutex.Unlock()
	c.stats = EntityCacheStats{}
}

// HitRate returns the cache hit rate (0.0 to 1.0).
func (c *EntityCache[T]) HitRate() float64 {
	c.statsMutex.RLock()
	defer c.statsMutex.RUnlock()

	total := c.stats.Hits + c.stats.Misses
	if total == 0 {
		return 0
	}
	return float64(c.stats.Hits) / float64(total)
}

func (c *EntityCache[T]) recordHit() {
	c.statsMutex.Lock()
	c.stats.Hits++
	c.statsMutex.Unlock()
}

func (c *EntityCache[T]) recordMiss() {
	c.statsMutex.Lock()
	c.stats.Misses++
	c.statsMutex.Unlock()
}

func (c *EntityCache[T]) recordLoad() {
	c.statsMutex.Lock()
	c.stats.Loads++
	c.statsMutex.Unlock()
}

func (c *EntityCache[T]) recordLoadError() {
	c.statsMutex.Lock()
	c.stats.LoadErrors++
	c.statsMutex.Unlock()
}
