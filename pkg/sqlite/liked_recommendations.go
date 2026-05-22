package sqlite

import (
	"context"
	"time"
)

// LikedRecommendationStore persists explicit positive feedback from the user.
// It uses the same package-level dbWrapper / getDBReader helpers as the
// DismissedRecommendationStore.
type LikedRecommendationStore struct{}

// Like records that the user liked an item.  Idempotent (INSERT OR REPLACE).
// Must be called inside a write transaction.
func (s *LikedRecommendationStore) Like(ctx context.Context, entityType, entityKey string) error {
	_, err := dbWrapper.Exec(ctx,
		`INSERT OR REPLACE INTO liked_recommendations (entity_type, entity_key, liked_at)
		 VALUES (?, ?, ?)`,
		entityType, entityKey, time.Now().UTC(),
	)
	return err
}

// Unlike removes a previous like.  Must be called inside a write transaction.
func (s *LikedRecommendationStore) Unlike(ctx context.Context, entityType, entityKey string) error {
	_, err := dbWrapper.Exec(ctx,
		`DELETE FROM liked_recommendations WHERE entity_type = ? AND entity_key = ?`,
		entityType, entityKey,
	)
	return err
}

// IsLiked reports whether the user has liked the given item.
// Safe to call inside a read or write transaction.
func (s *LikedRecommendationStore) IsLiked(ctx context.Context, entityType, entityKey string) (bool, error) {
	db, err := getDBReader(ctx)
	if err != nil {
		return false, err
	}
	var count int
	if err := db.GetContext(ctx, &count,
		`SELECT COUNT(*) FROM liked_recommendations WHERE entity_type = ? AND entity_key = ?`,
		entityType, entityKey,
	); err != nil {
		return false, err
	}
	return count > 0, nil
}

type likedRow struct {
	EntityKey string    `db:"entity_key"`
	LikedAt   time.Time `db:"liked_at"`
}

// ListLiked returns all liked entity_keys for a given entity_type, newest first.
// Safe to call inside a read or write transaction.
func (s *LikedRecommendationStore) ListLiked(ctx context.Context, entityType string) (map[string]bool, error) {
	db, err := getDBReader(ctx)
	if err != nil {
		return nil, err
	}
	var rows []likedRow
	if err := db.SelectContext(ctx, &rows,
		`SELECT entity_key FROM liked_recommendations WHERE entity_type = ?`,
		entityType,
	); err != nil {
		return nil, err
	}
	result := make(map[string]bool, len(rows))
	for _, r := range rows {
		result[r.EntityKey] = true
	}
	return result, nil
}
