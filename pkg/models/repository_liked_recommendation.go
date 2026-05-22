package models

import "context"

type LikedRecommendationWriter interface {
	Like(ctx context.Context, entityType, entityKey string) error
	Unlike(ctx context.Context, entityType, entityKey string) error
}

type LikedRecommendationReader interface {
	IsLiked(ctx context.Context, entityType, entityKey string) (bool, error)
	ListLiked(ctx context.Context, entityType string) (map[string]bool, error)
}

type LikedRecommendationReaderWriter interface {
	LikedRecommendationReader
	LikedRecommendationWriter
}
