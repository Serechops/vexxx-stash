package manager

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
)

// MigrateLegacyCredentials migrates the single-user credentials from config.yml
// to the database as the first admin user. This should be called during startup
// when there are no users in the database but credentials exist in config.
func (s *Manager) MigrateLegacyCredentials(ctx context.Context) error {
	// Check if we have config-based credentials
	if !s.Config.HasCredentials() {
		return nil
	}

	// Check if there are already users in the database
	var userCount int
	if err := s.Repository.WithReadTxn(ctx, func(ctx context.Context) error {
		var countErr error
		userCount, countErr = s.Repository.User.Count(ctx)
		return countErr
	}); err != nil {
		return err
	}

	if userCount > 0 {
		// Users already exist, no migration needed
		return nil
	}

	// Get the legacy credentials
	username, passwordHash := s.Config.GetCredentials()
	if username == "" || passwordHash == "" {
		return nil
	}

	logger.Info("Migrating legacy credentials to database-backed user...")

	// Generate an API key for the migrated user
	apiKey := uuid.New().String()

	now := time.Now()
	user := &models.User{
		Username:     username,
		PasswordHash: passwordHash, // Already hashed
		Role:         models.UserRoleAdmin,
		APIKey:       &apiKey,
		CreatedAt:    now,
		UpdatedAt:    now,
		IsActive:     true,
	}

	if err := s.Repository.WithTxn(ctx, func(ctx context.Context) error {
		return s.Repository.User.Create(ctx, user)
	}); err != nil {
		return err
	}

	logger.Infof("Successfully migrated user '%s' as admin", username)

	// Optionally: We could remove the credentials from config.yml here,
	// but leaving them allows for rollback if needed.

	return nil
}
