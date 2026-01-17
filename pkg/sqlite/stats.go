package sqlite

import (
	"context"
	"fmt"

	"github.com/doug-martin/goqu/v9"
	"github.com/doug-martin/goqu/v9/exp"
)

const statsTable = "stats"

// Stats cache keys
const (
	StatsKeyImageCount     = "image_count"
	StatsKeySceneCount     = "scene_count"
	StatsKeyGalleryCount   = "gallery_count"
	StatsKeyPerformerCount = "performer_count"
)

var statsTableMgr = &table{
	table:    goqu.T(statsTable),
	idColumn: goqu.T(statsTable).Col("key"),
}

type StatsStore struct {
	tableMgr *table
}

func NewStatsStore() *StatsStore {
	return &StatsStore{
		tableMgr: statsTableMgr,
	}
}

func (s *StatsStore) table() exp.IdentifierExpression {
	return s.tableMgr.table
}

// GetCount retrieves a cached count value by key.
// Returns 0 if the key doesn't exist.
func (s *StatsStore) GetCount(ctx context.Context, key string) (int, error) {
	q := dialect.Select("value").From(s.table()).Where(s.tableMgr.idColumn.Eq(key))

	var count int
	if err := querySimple(ctx, q, &count); err != nil {
		return 0, fmt.Errorf("getting stats count for %s: %w", key, err)
	}

	return count, nil
}

// IncrementCount increments a cached count by delta (can be negative).
func (s *StatsStore) IncrementCount(ctx context.Context, key string, delta int) error {
	// Use SQL UPDATE with arithmetic to avoid race conditions
	q := dialect.Update(s.table()).
		Set(goqu.Record{
			"value": goqu.L("value + ?", delta),
		}).
		Where(s.tableMgr.idColumn.Eq(key))

	if _, err := exec(ctx, q); err != nil {
		return fmt.Errorf("incrementing stats count for %s: %w", key, err)
	}

	return nil
}

// SetCount sets a cached count to a specific value.
func (s *StatsStore) SetCount(ctx context.Context, key string, value int) error {
	// Use INSERT OR REPLACE for upsert behavior
	q := dialect.Insert(s.table()).
		Cols("key", "value").
		Vals(goqu.Vals{key, value}).
		OnConflict(goqu.DoUpdate("key", goqu.Record{"value": value}))

	if _, err := exec(ctx, q); err != nil {
		return fmt.Errorf("setting stats count for %s: %w", key, err)
	}

	return nil
}

// RefreshImageCount recalculates and stores the image count from scratch.
// This is useful for maintenance/repair operations.
func (s *StatsStore) RefreshImageCount(ctx context.Context) error {
	q := dialect.Select(goqu.COUNT("*")).From(goqu.T(imageTable))

	var count int
	if err := querySimple(ctx, q, &count); err != nil {
		return fmt.Errorf("counting images: %w", err)
	}

	return s.SetCount(ctx, StatsKeyImageCount, count)
}
