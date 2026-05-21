package sqlite

import (
	"context"
	"time"
)

// DismissedRecommendationStore provides read/write access to the
// dismissed_recommendations table.  It uses the package-level dbWrapper
// (transaction) and getDBReader (read-only) helpers shared across the package.
type DismissedRecommendationStore struct{}

// Dismiss records that the user has dismissed an item so it will no longer
// appear in discovery rows.  Must be called inside a write transaction.
func (s *DismissedRecommendationStore) Dismiss(ctx context.Context, entityType, entityKey string) error {
	_, err := dbWrapper.Exec(ctx,
		`INSERT OR REPLACE INTO dismissed_recommendations (entity_type, entity_key, dismissed_at)
		 VALUES (?, ?, ?)`,
		entityType, entityKey, time.Now().UTC(),
	)
	return err
}

// Undismiss removes a previous dismissal, allowing the item to reappear.
// Must be called inside a write transaction.
func (s *DismissedRecommendationStore) Undismiss(ctx context.Context, entityType, entityKey string) error {
	_, err := dbWrapper.Exec(ctx,
		`DELETE FROM dismissed_recommendations WHERE entity_type = ? AND entity_key = ?`,
		entityType, entityKey,
	)
	return err
}

type dismissedRow struct {
	EntityKey string `db:"entity_key"`
}

// ListDismissed returns the set of entity_keys dismissed for a given entity_type.
// Safe to call inside a read or write transaction.
func (s *DismissedRecommendationStore) ListDismissed(ctx context.Context, entityType string) (map[string]bool, error) {
	db, err := getDBReader(ctx)
	if err != nil {
		return nil, err
	}

	var rows []dismissedRow
	if err := db.SelectContext(ctx, &rows,
		`SELECT entity_key FROM dismissed_recommendations WHERE entity_type = ?`,
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
