package models

import (
	"context"
	"time"
)

// DismissedRecommendationEntry is a single dismissed item with its timestamp.
type DismissedRecommendationEntry struct {
	EntityType  string
	EntityKey   string
	DismissedAt time.Time
}

// DismissedRecommendationWriter writes dismissal signals.
type DismissedRecommendationWriter interface {
	Dismiss(ctx context.Context, entityType, entityKey string) error
	Undismiss(ctx context.Context, entityType, entityKey string) error
}

// DismissedRecommendationReader reads dismissal signals.
type DismissedRecommendationReader interface {
	ListDismissed(ctx context.Context, entityType string) (map[string]bool, error)
	ListDismissedWithTime(ctx context.Context, entityType string) ([]DismissedRecommendationEntry, error)
}

// DismissedRecommendationReaderWriter combines read and write access.
type DismissedRecommendationReaderWriter interface {
	DismissedRecommendationReader
	DismissedRecommendationWriter
}
