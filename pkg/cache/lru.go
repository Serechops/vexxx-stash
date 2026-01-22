// Package cache provides LRU caching utilities for database entities.
package cache

import (
	"container/list"
	"sync"
	"time"
)

// LRU is a thread-safe LRU cache with optional TTL support.
type LRU[K comparable, V any] struct {
	mu       sync.RWMutex
	capacity int
	items    map[K]*list.Element
	order    *list.List
	ttl      time.Duration
	onEvict  func(key K, value V)
}

type entry[K comparable, V any] struct {
	key       K
	value     V
	expiresAt time.Time
}

// Config holds configuration options for the LRU cache.
type Config struct {
	// Capacity is the maximum number of items in the cache.
	Capacity int
	// TTL is the time-to-live for cache entries. Zero means no expiration.
	TTL time.Duration
}

// New creates a new LRU cache with the given capacity.
func New[K comparable, V any](capacity int) *LRU[K, V] {
	return NewWithConfig[K, V](Config{Capacity: capacity})
}

// NewWithConfig creates a new LRU cache with the given configuration.
func NewWithConfig[K comparable, V any](config Config) *LRU[K, V] {
	if config.Capacity <= 0 {
		config.Capacity = 1000
	}
	return &LRU[K, V]{
		capacity: config.Capacity,
		items:    make(map[K]*list.Element),
		order:    list.New(),
		ttl:      config.TTL,
	}
}

// OnEvict sets a callback that is called when an item is evicted from the cache.
func (c *LRU[K, V]) OnEvict(fn func(key K, value V)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onEvict = fn
}

// Get retrieves a value from the cache.
// Returns the value and true if found, zero value and false otherwise.
func (c *LRU[K, V]) Get(key K) (V, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if elem, ok := c.items[key]; ok {
		e := elem.Value.(*entry[K, V])

		// Check TTL
		if c.ttl > 0 && time.Now().After(e.expiresAt) {
			c.removeElement(elem)
			var zero V
			return zero, false
		}

		// Move to front (most recently used)
		c.order.MoveToFront(elem)
		return e.value, true
	}

	var zero V
	return zero, false
}

// Peek retrieves a value without updating its position in the LRU order.
func (c *LRU[K, V]) Peek(key K) (V, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if elem, ok := c.items[key]; ok {
		e := elem.Value.(*entry[K, V])

		// Check TTL
		if c.ttl > 0 && time.Now().After(e.expiresAt) {
			var zero V
			return zero, false
		}

		return e.value, true
	}

	var zero V
	return zero, false
}

// Set adds or updates a value in the cache.
func (c *LRU[K, V]) Set(key K, value V) {
	c.mu.Lock()
	defer c.mu.Unlock()

	var expiresAt time.Time
	if c.ttl > 0 {
		expiresAt = time.Now().Add(c.ttl)
	}

	// Update existing entry
	if elem, ok := c.items[key]; ok {
		c.order.MoveToFront(elem)
		e := elem.Value.(*entry[K, V])
		e.value = value
		e.expiresAt = expiresAt
		return
	}

	// Add new entry
	e := &entry[K, V]{
		key:       key,
		value:     value,
		expiresAt: expiresAt,
	}
	elem := c.order.PushFront(e)
	c.items[key] = elem

	// Evict oldest if over capacity
	for c.order.Len() > c.capacity {
		c.removeOldest()
	}
}

// Delete removes a key from the cache.
func (c *LRU[K, V]) Delete(key K) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if elem, ok := c.items[key]; ok {
		c.removeElement(elem)
	}
}

// Clear removes all items from the cache.
func (c *LRU[K, V]) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.onEvict != nil {
		for _, elem := range c.items {
			e := elem.Value.(*entry[K, V])
			c.onEvict(e.key, e.value)
		}
	}

	c.items = make(map[K]*list.Element)
	c.order.Init()
}

// Len returns the number of items in the cache.
func (c *LRU[K, V]) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.order.Len()
}

// Keys returns all keys in the cache (most recent first).
func (c *LRU[K, V]) Keys() []K {
	c.mu.RLock()
	defer c.mu.RUnlock()

	keys := make([]K, 0, c.order.Len())
	for elem := c.order.Front(); elem != nil; elem = elem.Next() {
		e := elem.Value.(*entry[K, V])
		if c.ttl == 0 || time.Now().Before(e.expiresAt) {
			keys = append(keys, e.key)
		}
	}
	return keys
}

// Contains checks if a key exists in the cache (does not update LRU order).
func (c *LRU[K, V]) Contains(key K) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	elem, ok := c.items[key]
	if !ok {
		return false
	}

	// Check TTL
	if c.ttl > 0 {
		e := elem.Value.(*entry[K, V])
		return time.Now().Before(e.expiresAt)
	}

	return true
}

// GetOrSet retrieves a value from the cache, or sets it using the provided function if not found.
func (c *LRU[K, V]) GetOrSet(key K, fn func() (V, error)) (V, error) {
	// First try a read-only check
	if val, ok := c.Get(key); ok {
		return val, nil
	}

	// Not found, need to compute and store
	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check after acquiring write lock
	if elem, ok := c.items[key]; ok {
		e := elem.Value.(*entry[K, V])
		if c.ttl == 0 || time.Now().Before(e.expiresAt) {
			c.order.MoveToFront(elem)
			return e.value, nil
		}
		// Expired, remove it
		c.removeElement(elem)
	}

	// Compute value
	value, err := fn()
	if err != nil {
		var zero V
		return zero, err
	}

	// Store computed value
	var expiresAt time.Time
	if c.ttl > 0 {
		expiresAt = time.Now().Add(c.ttl)
	}

	e := &entry[K, V]{
		key:       key,
		value:     value,
		expiresAt: expiresAt,
	}
	elem := c.order.PushFront(e)
	c.items[key] = elem

	// Evict oldest if over capacity
	for c.order.Len() > c.capacity {
		c.removeOldest()
	}

	return value, nil
}

func (c *LRU[K, V]) removeOldest() {
	elem := c.order.Back()
	if elem != nil {
		c.removeElement(elem)
	}
}

func (c *LRU[K, V]) removeElement(elem *list.Element) {
	c.order.Remove(elem)
	e := elem.Value.(*entry[K, V])
	delete(c.items, e.key)

	if c.onEvict != nil {
		c.onEvict(e.key, e.value)
	}
}

// Stats returns cache statistics.
type Stats struct {
	Capacity int
	Size     int
	TTL      time.Duration
}

// Stats returns current cache statistics.
func (c *LRU[K, V]) Stats() Stats {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return Stats{
		Capacity: c.capacity,
		Size:     c.order.Len(),
		TTL:      c.ttl,
	}
}
