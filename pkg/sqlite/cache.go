package sqlite

import (
	"context"
	"time"

	"github.com/stashapp/stash/pkg/cache"
	"github.com/stashapp/stash/pkg/metrics"
	"github.com/stashapp/stash/pkg/models"
)

// CacheConfig holds configuration for entity caches.
type CacheConfig struct {
	// SceneCacheSize is the number of scenes to cache.
	SceneCacheSize int
	// PerformerCacheSize is the number of performers to cache.
	PerformerCacheSize int
	// StudioCacheSize is the number of studios to cache.
	StudioCacheSize int
	// TagCacheSize is the number of tags to cache.
	TagCacheSize int
	// CacheTTL is the time-to-live for cached entities.
	CacheTTL time.Duration
}

// DefaultCacheConfig returns the default cache configuration.
func DefaultCacheConfig() CacheConfig {
	return CacheConfig{
		SceneCacheSize:     5000,
		PerformerCacheSize: 2000,
		StudioCacheSize:    1000,
		TagCacheSize:       1000,
		CacheTTL:           5 * time.Minute,
	}
}

// EntityCaches holds all entity caches for the database.
type EntityCaches struct {
	Scenes     *cache.EntityCache[*models.Scene]
	Performers *cache.EntityCache[*models.Performer]
	Studios    *cache.EntityCache[*models.Studio]
	Tags       *cache.EntityCache[*models.Tag]
}

// NewEntityCaches creates entity caches with the given configuration.
func NewEntityCaches(config CacheConfig, db *Database) *EntityCaches {
	return &EntityCaches{
		Scenes: cache.NewEntityCache(cache.EntityCacheConfig{
			Capacity:  config.SceneCacheSize,
			TTL:       config.CacheTTL,
			KeyPrefix: "scene",
		}, func(ctx context.Context, id int) (*models.Scene, error) {
			return db.Scene.find(ctx, id)
		}),
		Performers: cache.NewEntityCache(cache.EntityCacheConfig{
			Capacity:  config.PerformerCacheSize,
			TTL:       config.CacheTTL,
			KeyPrefix: "performer",
		}, func(ctx context.Context, id int) (*models.Performer, error) {
			return db.Performer.find(ctx, id)
		}),
		Studios: cache.NewEntityCache(cache.EntityCacheConfig{
			Capacity:  config.StudioCacheSize,
			TTL:       config.CacheTTL,
			KeyPrefix: "studio",
		}, func(ctx context.Context, id int) (*models.Studio, error) {
			return db.Studio.find(ctx, id)
		}),
		Tags: cache.NewEntityCache(cache.EntityCacheConfig{
			Capacity:  config.TagCacheSize,
			TTL:       config.CacheTTL,
			KeyPrefix: "tag",
		}, func(ctx context.Context, id int) (*models.Tag, error) {
			return db.Tag.find(ctx, id)
		}),
	}
}

// InvalidateScene removes a scene from the cache.
func (c *EntityCaches) InvalidateScene(id int) {
	if c.Scenes != nil {
		c.Scenes.Invalidate(id)
	}
}

// InvalidatePerformer removes a performer from the cache.
func (c *EntityCaches) InvalidatePerformer(id int) {
	if c.Performers != nil {
		c.Performers.Invalidate(id)
	}
}

// InvalidateStudio removes a studio from the cache.
func (c *EntityCaches) InvalidateStudio(id int) {
	if c.Studios != nil {
		c.Studios.Invalidate(id)
	}
}

// InvalidateTag removes a tag from the cache.
func (c *EntityCaches) InvalidateTag(id int) {
	if c.Tags != nil {
		c.Tags.Invalidate(id)
	}
}

// Clear clears all caches.
func (c *EntityCaches) Clear() {
	if c.Scenes != nil {
		c.Scenes.Clear()
	}
	if c.Performers != nil {
		c.Performers.Clear()
	}
	if c.Studios != nil {
		c.Studios.Clear()
	}
	if c.Tags != nil {
		c.Tags.Clear()
	}
}

// Stats returns statistics for all caches.
func (c *EntityCaches) Stats() map[string]cache.EntityCacheStats {
	stats := make(map[string]cache.EntityCacheStats)
	if c.Scenes != nil {
		stats["scenes"] = c.Scenes.Stats()
	}
	if c.Performers != nil {
		stats["performers"] = c.Performers.Stats()
	}
	if c.Studios != nil {
		stats["studios"] = c.Studios.Stats()
	}
	if c.Tags != nil {
		stats["tags"] = c.Tags.Stats()
	}
	return stats
}

// QueryTimer is a helper for timing database queries and recording metrics.
type QueryTimer struct {
	start time.Time
	name  string
}

// NewQueryTimer starts a new query timer.
func NewQueryTimer(name string) *QueryTimer {
	return &QueryTimer{
		start: time.Now(),
		name:  name,
	}
}

// Done stops the timer and records metrics.
func (t *QueryTimer) Done(err error) time.Duration {
	duration := time.Since(t.start)
	metrics.RecordDBQuery(duration, err)
	return duration
}

// CachedSceneFind retrieves a scene by ID, using the cache if available.
// Falls back to direct database query if caches are not initialized.
func CachedSceneFind(ctx context.Context, db *Database, id int) (*models.Scene, error) {
	if db.Caches != nil && db.Caches.Scenes != nil {
		scene, err := db.Caches.Scenes.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		return scene, nil
	}
	return db.Scene.Find(ctx, id)
}

// CachedPerformerFind retrieves a performer by ID, using the cache if available.
func CachedPerformerFind(ctx context.Context, db *Database, id int) (*models.Performer, error) {
	if db.Caches != nil && db.Caches.Performers != nil {
		performer, err := db.Caches.Performers.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		return performer, nil
	}
	return db.Performer.Find(ctx, id)
}

// CachedStudioFind retrieves a studio by ID, using the cache if available.
func CachedStudioFind(ctx context.Context, db *Database, id int) (*models.Studio, error) {
	if db.Caches != nil && db.Caches.Studios != nil {
		studio, err := db.Caches.Studios.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		return studio, nil
	}
	return db.Studio.Find(ctx, id)
}

// CachedTagFind retrieves a tag by ID, using the cache if available.
func CachedTagFind(ctx context.Context, db *Database, id int) (*models.Tag, error) {
	if db.Caches != nil && db.Caches.Tags != nil {
		tag, err := db.Caches.Tags.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		return tag, nil
	}
	return db.Tag.Find(ctx, id)
}
