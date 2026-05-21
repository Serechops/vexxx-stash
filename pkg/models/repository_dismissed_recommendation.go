package models

import "context"

// DismissedRecommendationWriter writes dismissal signals.
type DismissedRecommendationWriter interface {
	Dismiss(ctx context.Context, entityType, entityKey string) error
	Undismiss(ctx context.Context, entityType, entityKey string) error
}

// DismissedRecommendationReader reads dismissal signals.
type DismissedRecommendationReader interface {
	ListDismissed(ctx context.Context, entityType string) (map[string]bool, error)
}

// DismissedRecommendationReaderWriter combines read and write access.
type DismissedRecommendationReaderWriter interface {
	DismissedRecommendationReader
	DismissedRecommendationWriter
}
