package migrations

import (
	"context"

	"github.com/jmoiron/sqlx"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/sqlite"
)

func post84(ctx context.Context, db *sqlx.DB) error {
	logger.Info("Running post-migration for schema version 84 (users table)")
	// Note: Migration of legacy credentials from config to database is handled
	// in the manager startup phase, not here. This keeps the database layer
	// independent of the config package.
	//
	// The manager will check:
	// 1. If users table is empty AND config has credentials
	// 2. Create admin user from config credentials
	// 3. Optionally clear credentials from config

	return nil
}

func init() {
	sqlite.RegisterPostMigration(84, post84)
}
