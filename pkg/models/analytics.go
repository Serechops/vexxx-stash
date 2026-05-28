package models

import "context"

// AnalyticsBreakdown is a single aggregation bucket returned by an analytics query.
type AnalyticsBreakdown struct {
	Label string  `db:"label"`
	Count int     `db:"count"`
	Size  float64 `db:"size"`
}

// AnalyticsReader provides read-only access to analytics aggregate data.
type AnalyticsReader interface {
	ScenesByCodec(ctx context.Context) ([]AnalyticsBreakdown, error)
	ScenesByResolution(ctx context.Context) ([]AnalyticsBreakdown, error)
	ScenesByStudio(ctx context.Context) ([]AnalyticsBreakdown, error)
	ScenesByRating(ctx context.Context) ([]AnalyticsBreakdown, error)
	ScenesByMonth(ctx context.Context) ([]AnalyticsBreakdown, error)
}
