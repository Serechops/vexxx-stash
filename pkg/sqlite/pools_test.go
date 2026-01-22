package sqlite

import (
	"sync"
	"testing"

	"github.com/stashapp/stash/pkg/models"
)

func TestSceneSlicePool(t *testing.T) {
	// Get a slice from the pool
	s := GetSceneSlice()
	if s == nil {
		t.Fatal("GetSceneSlice returned nil")
	}

	if len(*s) != 0 {
		t.Errorf("expected empty slice, got length %d", len(*s))
	}

	if cap(*s) < scenePoolCap {
		t.Errorf("expected capacity >= %d, got %d", scenePoolCap, cap(*s))
	}

	// Add some items
	*s = append(*s, &models.Scene{ID: 1})
	*s = append(*s, &models.Scene{ID: 2})

	if len(*s) != 2 {
		t.Errorf("expected length 2, got %d", len(*s))
	}

	// Return to pool
	PutSceneSlice(s)

	// Get again - should be reset
	s2 := GetSceneSlice()
	if len(*s2) != 0 {
		t.Errorf("expected empty slice after reuse, got length %d", len(*s2))
	}

	PutSceneSlice(s2)
}

func TestIntSlicePool(t *testing.T) {
	s := GetIntSlice()
	if s == nil {
		t.Fatal("GetIntSlice returned nil")
	}

	*s = append(*s, 1, 2, 3, 4, 5)
	if len(*s) != 5 {
		t.Errorf("expected length 5, got %d", len(*s))
	}

	PutIntSlice(s)

	s2 := GetIntSlice()
	if len(*s2) != 0 {
		t.Errorf("expected empty slice after reuse, got length %d", len(*s2))
	}
	PutIntSlice(s2)
}

func TestPreallocateSlice(t *testing.T) {
	tests := []struct {
		name     string
		size     int
		wantCap  int
		wantNil  bool
	}{
		{"zero", 0, 0, true},
		{"negative", -5, 0, true},
		{"positive", 50, 50, false},
		{"large", 1000, 1000, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := PreallocateSlice[int](tt.size)
			if tt.wantNil && s != nil {
				t.Errorf("expected nil slice for size %d", tt.size)
			}
			if !tt.wantNil {
				if s == nil {
					t.Errorf("expected non-nil slice for size %d", tt.size)
				} else if cap(s) != tt.wantCap {
					t.Errorf("expected capacity %d, got %d", tt.wantCap, cap(s))
				}
			}
		})
	}
}

func TestPreallocateMap(t *testing.T) {
	m := PreallocateMap[string, int](100)
	if m == nil {
		t.Fatal("PreallocateMap returned nil")
	}

	// Should be usable
	m["test"] = 42
	if m["test"] != 42 {
		t.Error("map not functional")
	}
}

func TestPoolConcurrency(t *testing.T) {
	const goroutines = 100
	const iterations = 1000

	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				s := GetSceneSlice()
				*s = append(*s, &models.Scene{ID: j})
				PutSceneSlice(s)
			}
		}()
	}

	wg.Wait()
}

func TestNilPutSafety(t *testing.T) {
	// These should not panic
	PutSceneSlice(nil)
	PutPerformerSlice(nil)
	PutTagSlice(nil)
	PutStudioSlice(nil)
	PutGallerySlice(nil)
	PutImageSlice(nil)
	PutGroupSlice(nil)
	PutIntSlice(nil)
}

// Benchmarks

func BenchmarkSceneSlicePool(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		s := GetSceneSlice()
		*s = append(*s, &models.Scene{ID: i})
		PutSceneSlice(s)
	}
}

func BenchmarkSceneSliceAlloc(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		s := make([]*models.Scene, 0, scenePoolCap)
		s = append(s, &models.Scene{ID: i})
		_ = s
	}
}

func BenchmarkIntSlicePool(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		s := GetIntSlice()
		*s = append(*s, i, i+1, i+2)
		PutIntSlice(s)
	}
}

func BenchmarkIntSliceAlloc(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		s := make([]int, 0, intSlicePoolCap)
		s = append(s, i, i+1, i+2)
		_ = s
	}
}
