package migrations

import (
	"context"

	"github.com/jmoiron/sqlx"
	"github.com/stashapp/stash/pkg/sqlite"
)

func post78(ctx context.Context, db *sqlx.DB) error {
	// No-op: has_preview column added via SQL.
	// Data population will rely on normal scanning/generation processes.
	return nil
}

func init() {
	sqlite.RegisterPostMigration(78, post78)
}
