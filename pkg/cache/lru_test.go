package cache

import (
	"sync"
	"testing"
	"time"
)

func TestLRUBasicOperations(t *testing.T) {
	cache := New[string, int](3)

	// Test Set and Get
	cache.Set("a", 1)
	cache.Set("b", 2)
	cache.Set("c", 3)

	if v, ok := cache.Get("a"); !ok || v != 1 {
		t.Errorf("Get(a) = %v, %v; want 1, true", v, ok)
	}

	if v, ok := cache.Get("b"); !ok || v != 2 {
		t.Errorf("Get(b) = %v, %v; want 2, true", v, ok)
	}

	// Test eviction
	cache.Set("d", 4) // Should evict "c" (least recently used)

	if _, ok := cache.Get("c"); ok {
		t.Error("Get(c) should return false after eviction")
	}

	if v, ok := cache.Get("d"); !ok || v != 4 {
		t.Errorf("Get(d) = %v, %v; want 4, true", v, ok)
	}
}

func TestLRUUpdate(t *testing.T) {
	cache := New[string, int](2)

	cache.Set("a", 1)
	cache.Set("b", 2)

	// Update "a"
	cache.Set("a", 10)

	if v, ok := cache.Get("a"); !ok || v != 10 {
		t.Errorf("Get(a) = %v, %v; want 10, true", v, ok)
	}

	// "a" should now be most recently used, so "b" should be evicted next
	cache.Set("c", 3)

	if _, ok := cache.Get("b"); ok {
		t.Error("Get(b) should return false after eviction")
	}
}

func TestLRUDelete(t *testing.T) {
	cache := New[string, int](3)

	cache.Set("a", 1)
	cache.Set("b", 2)

	cache.Delete("a")

	if _, ok := cache.Get("a"); ok {
		t.Error("Get(a) should return false after deletion")
	}

	if cache.Len() != 1 {
		t.Errorf("Len() = %d; want 1", cache.Len())
	}
}

func TestLRUClear(t *testing.T) {
	cache := New[string, int](3)

	cache.Set("a", 1)
	cache.Set("b", 2)
	cache.Set("c", 3)

	cache.Clear()

	if cache.Len() != 0 {
		t.Errorf("Len() = %d; want 0", cache.Len())
	}

	if _, ok := cache.Get("a"); ok {
		t.Error("Get(a) should return false after clear")
	}
}

func TestLRUContains(t *testing.T) {
	cache := New[string, int](2)

	cache.Set("a", 1)

	if !cache.Contains("a") {
		t.Error("Contains(a) should return true")
	}

	if cache.Contains("b") {
		t.Error("Contains(b) should return false")
	}
}

func TestLRUPeek(t *testing.T) {
	cache := New[string, int](2)

	cache.Set("a", 1)
	cache.Set("b", 2)

	// Peek should not update LRU order
	if v, ok := cache.Peek("a"); !ok || v != 1 {
		t.Errorf("Peek(a) = %v, %v; want 1, true", v, ok)
	}

	// Add new item - "a" should be evicted since Peek didn't update order
	cache.Set("c", 3)

	if _, ok := cache.Get("a"); ok {
		t.Error("Get(a) should return false - Peek should not update LRU order")
	}
}

func TestLRUKeys(t *testing.T) {
	cache := New[string, int](3)

	cache.Set("a", 1)
	cache.Set("b", 2)
	cache.Set("c", 3)

	keys := cache.Keys()
	if len(keys) != 3 {
		t.Errorf("len(Keys()) = %d; want 3", len(keys))
	}

	// Most recent should be first
	if keys[0] != "c" {
		t.Errorf("Keys()[0] = %s; want c", keys[0])
	}
}

func TestLRUWithTTL(t *testing.T) {
	cache := NewWithConfig[string, int](Config{
		Capacity: 3,
		TTL:      50 * time.Millisecond,
	})

	cache.Set("a", 1)

	// Should exist initially
	if v, ok := cache.Get("a"); !ok || v != 1 {
		t.Errorf("Get(a) = %v, %v; want 1, true", v, ok)
	}

	// Wait for TTL to expire
	time.Sleep(60 * time.Millisecond)

	// Should be expired
	if _, ok := cache.Get("a"); ok {
		t.Error("Get(a) should return false after TTL expiration")
	}
}

func TestLRUOnEvict(t *testing.T) {
	evicted := make(map[string]int)
	var mu sync.Mutex

	cache := New[string, int](2)
	cache.OnEvict(func(key string, value int) {
		mu.Lock()
		evicted[key] = value
		mu.Unlock()
	})

	cache.Set("a", 1)
	cache.Set("b", 2)
	cache.Set("c", 3) // Should evict "a"

	mu.Lock()
	defer mu.Unlock()

	if v, ok := evicted["a"]; !ok || v != 1 {
		t.Errorf("evicted[a] = %v, %v; want 1, true", v, ok)
	}
}

func TestLRUGetOrSet(t *testing.T) {
	cache := New[string, int](3)

	// First call should invoke the function
	callCount := 0
	v, err := cache.GetOrSet("a", func() (int, error) {
		callCount++
		return 42, nil
	})

	if err != nil {
		t.Fatalf("GetOrSet returned error: %v", err)
	}
	if v != 42 {
		t.Errorf("GetOrSet returned %d; want 42", v)
	}
	if callCount != 1 {
		t.Errorf("function called %d times; want 1", callCount)
	}

	// Second call should use cached value
	v, err = cache.GetOrSet("a", func() (int, error) {
		callCount++
		return 99, nil
	})

	if err != nil {
		t.Fatalf("GetOrSet returned error: %v", err)
	}
	if v != 42 {
		t.Errorf("GetOrSet returned %d; want 42 (cached)", v)
	}
	if callCount != 1 {
		t.Errorf("function called %d times; want 1 (should use cache)", callCount)
	}
}

func TestLRUConcurrency(t *testing.T) {
	cache := New[int, int](100)

	var wg sync.WaitGroup
	wg.Add(100)

	for i := 0; i < 100; i++ {
		go func(n int) {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				key := (n + j) % 200
				cache.Set(key, key*2)
				cache.Get(key)
			}
		}(i)
	}

	wg.Wait()
}

func TestLRUStats(t *testing.T) {
	cache := NewWithConfig[string, int](Config{
		Capacity: 10,
		TTL:      time.Hour,
	})

	cache.Set("a", 1)
	cache.Set("b", 2)

	stats := cache.Stats()
	if stats.Capacity != 10 {
		t.Errorf("Capacity = %d; want 10", stats.Capacity)
	}
	if stats.Size != 2 {
		t.Errorf("Size = %d; want 2", stats.Size)
	}
	if stats.TTL != time.Hour {
		t.Errorf("TTL = %v; want %v", stats.TTL, time.Hour)
	}
}

func BenchmarkLRUGet(b *testing.B) {
	cache := New[int, int](1000)
	for i := 0; i < 1000; i++ {
		cache.Set(i, i)
	}

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		cache.Get(i % 1000)
	}
}

func BenchmarkLRUSet(b *testing.B) {
	cache := New[int, int](1000)

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		cache.Set(i%1000, i)
	}
}

func BenchmarkLRUGetSet(b *testing.B) {
	cache := New[int, int](1000)

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		if i%2 == 0 {
			cache.Set(i%1000, i)
		} else {
			cache.Get(i % 1000)
		}
	}
}
