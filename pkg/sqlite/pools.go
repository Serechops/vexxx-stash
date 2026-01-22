package sqlite

import (
	"sync"

	"github.com/stashapp/stash/pkg/models"
)

// Pool sizes for different entity types
const (
	scenePoolCap     = 100
	performerPoolCap = 50
	tagPoolCap       = 100
	studioPoolCap    = 50
	galleryPoolCap   = 50
	imagePoolCap     = 100
	groupPoolCap     = 50
	intSlicePoolCap  = 100
)

// sceneSlicePool is a pool for scene slice pointers.
// This reduces GC pressure when fetching many scenes in bulk operations.
var sceneSlicePool = sync.Pool{
	New: func() interface{} {
		s := make([]*models.Scene, 0, scenePoolCap)
		return &s
	},
}

// GetSceneSlice retrieves a scene slice from the pool.
// The slice is reset to zero length but retains its capacity.
func GetSceneSlice() *[]*models.Scene {
	s := sceneSlicePool.Get().(*[]*models.Scene)
	*s = (*s)[:0]
	return s
}

// PutSceneSlice returns a scene slice to the pool.
// The slice is cleared to allow GC of the scene pointers.
func PutSceneSlice(s *[]*models.Scene) {
	if s == nil {
		return
	}
	// Clear references to allow GC
	for i := range *s {
		(*s)[i] = nil
	}
	*s = (*s)[:0]
	sceneSlicePool.Put(s)
}

// performerSlicePool is a pool for performer slice pointers.
var performerSlicePool = sync.Pool{
	New: func() interface{} {
		s := make([]*models.Performer, 0, performerPoolCap)
		return &s
	},
}

// GetPerformerSlice retrieves a performer slice from the pool.
func GetPerformerSlice() *[]*models.Performer {
	s := performerSlicePool.Get().(*[]*models.Performer)
	*s = (*s)[:0]
	return s
}

// PutPerformerSlice returns a performer slice to the pool.
func PutPerformerSlice(s *[]*models.Performer) {
	if s == nil {
		return
	}
	for i := range *s {
		(*s)[i] = nil
	}
	*s = (*s)[:0]
	performerSlicePool.Put(s)
}

// tagSlicePool is a pool for tag slice pointers.
var tagSlicePool = sync.Pool{
	New: func() interface{} {
		s := make([]*models.Tag, 0, tagPoolCap)
		return &s
	},
}

// GetTagSlice retrieves a tag slice from the pool.
func GetTagSlice() *[]*models.Tag {
	s := tagSlicePool.Get().(*[]*models.Tag)
	*s = (*s)[:0]
	return s
}

// PutTagSlice returns a tag slice to the pool.
func PutTagSlice(s *[]*models.Tag) {
	if s == nil {
		return
	}
	for i := range *s {
		(*s)[i] = nil
	}
	*s = (*s)[:0]
	tagSlicePool.Put(s)
}

// studioSlicePool is a pool for studio slice pointers.
var studioSlicePool = sync.Pool{
	New: func() interface{} {
		s := make([]*models.Studio, 0, studioPoolCap)
		return &s
	},
}

// GetStudioSlice retrieves a studio slice from the pool.
func GetStudioSlice() *[]*models.Studio {
	s := studioSlicePool.Get().(*[]*models.Studio)
	*s = (*s)[:0]
	return s
}

// PutStudioSlice returns a studio slice to the pool.
func PutStudioSlice(s *[]*models.Studio) {
	if s == nil {
		return
	}
	for i := range *s {
		(*s)[i] = nil
	}
	*s = (*s)[:0]
	studioSlicePool.Put(s)
}

// gallerySlicePool is a pool for gallery slice pointers.
var gallerySlicePool = sync.Pool{
	New: func() interface{} {
		s := make([]*models.Gallery, 0, galleryPoolCap)
		return &s
	},
}

// GetGallerySlice retrieves a gallery slice from the pool.
func GetGallerySlice() *[]*models.Gallery {
	s := gallerySlicePool.Get().(*[]*models.Gallery)
	*s = (*s)[:0]
	return s
}

// PutGallerySlice returns a gallery slice to the pool.
func PutGallerySlice(s *[]*models.Gallery) {
	if s == nil {
		return
	}
	for i := range *s {
		(*s)[i] = nil
	}
	*s = (*s)[:0]
	gallerySlicePool.Put(s)
}

// imageSlicePool is a pool for image slice pointers.
var imageSlicePool = sync.Pool{
	New: func() interface{} {
		s := make([]*models.Image, 0, imagePoolCap)
		return &s
	},
}

// GetImageSlice retrieves an image slice from the pool.
func GetImageSlice() *[]*models.Image {
	s := imageSlicePool.Get().(*[]*models.Image)
	*s = (*s)[:0]
	return s
}

// PutImageSlice returns an image slice to the pool.
func PutImageSlice(s *[]*models.Image) {
	if s == nil {
		return
	}
	for i := range *s {
		(*s)[i] = nil
	}
	*s = (*s)[:0]
	imageSlicePool.Put(s)
}

// groupSlicePool is a pool for group slice pointers.
var groupSlicePool = sync.Pool{
	New: func() interface{} {
		s := make([]*models.Group, 0, groupPoolCap)
		return &s
	},
}

// GetGroupSlice retrieves a group slice from the pool.
func GetGroupSlice() *[]*models.Group {
	s := groupSlicePool.Get().(*[]*models.Group)
	*s = (*s)[:0]
	return s
}

// PutGroupSlice returns a group slice to the pool.
func PutGroupSlice(s *[]*models.Group) {
	if s == nil {
		return
	}
	for i := range *s {
		(*s)[i] = nil
	}
	*s = (*s)[:0]
	groupSlicePool.Put(s)
}

// intSlicePool is a pool for int slices, commonly used for IDs.
var intSlicePool = sync.Pool{
	New: func() interface{} {
		s := make([]int, 0, intSlicePoolCap)
		return &s
	},
}

// GetIntSlice retrieves an int slice from the pool.
func GetIntSlice() *[]int {
	s := intSlicePool.Get().(*[]int)
	*s = (*s)[:0]
	return s
}

// PutIntSlice returns an int slice to the pool.
func PutIntSlice(s *[]int) {
	if s == nil {
		return
	}
	*s = (*s)[:0]
	intSlicePool.Put(s)
}

// PreallocateSlice creates a slice with preallocated capacity.
// This is useful when the expected size is known ahead of time.
func PreallocateSlice[T any](expectedSize int) []T {
	if expectedSize <= 0 {
		return nil
	}
	return make([]T, 0, expectedSize)
}

// PreallocateMap creates a map with preallocated capacity.
func PreallocateMap[K comparable, V any](expectedSize int) map[K]V {
	if expectedSize <= 0 {
		return make(map[K]V)
	}
	return make(map[K]V, expectedSize)
}
