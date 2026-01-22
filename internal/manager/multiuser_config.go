package manager

import (
	"context"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/session"
	"golang.org/x/crypto/bcrypt"
)

// MultiUserConfigAdapter adapts the Config to implement session.MultiUserConfig
// by providing access to the user repository for multi-user authentication.
type MultiUserConfigAdapter struct {
	*config.Config
	repository models.Repository
	enabled    bool
}

// NewMultiUserConfigAdapter creates a new MultiUserConfigAdapter
func NewMultiUserConfigAdapter(cfg *config.Config, repo models.Repository) *MultiUserConfigAdapter {
	return &MultiUserConfigAdapter{
		Config:     cfg,
		repository: repo,
		enabled:    false, // Will be enabled when users exist in database
	}
}

// SetMultiUserEnabled sets whether multi-user mode is enabled
func (a *MultiUserConfigAdapter) SetMultiUserEnabled(enabled bool) {
	a.enabled = enabled
}

// IsMultiUserEnabled returns true if multi-user mode is enabled
func (a *MultiUserConfigAdapter) IsMultiUserEnabled() bool {
	return a.enabled
}

// ValidateUserCredentials validates credentials against the user database
func (a *MultiUserConfigAdapter) ValidateUserCredentials(ctx context.Context, username, password string) (*session.UserInfo, error) {
	if !a.enabled {
		return nil, nil
	}

	var user *models.User
	err := a.repository.WithReadTxn(ctx, func(ctx context.Context) error {
		var findErr error
		user, findErr = a.repository.User.FindByUsername(ctx, username)
		return findErr
	})

	if err != nil {
		return nil, err
	}

	if user == nil {
		return nil, nil
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, nil // Invalid password
	}

	return &session.UserInfo{
		ID:       user.ID,
		Username: user.Username,
		Role:     string(user.Role),
		APIKey:   user.APIKey,
		IsActive: user.IsActive,
	}, nil
}

// FindUserByAPIKey looks up a user by their API key
func (a *MultiUserConfigAdapter) FindUserByAPIKey(ctx context.Context, apiKey string) (*session.UserInfo, error) {
	if !a.enabled {
		return nil, nil
	}

	var user *models.User
	err := a.repository.WithReadTxn(ctx, func(ctx context.Context) error {
		var findErr error
		user, findErr = a.repository.User.FindByAPIKey(ctx, apiKey)
		return findErr
	})

	if err != nil {
		return nil, err
	}

	if user == nil {
		return nil, nil
	}

	return &session.UserInfo{
		ID:       user.ID,
		Username: user.Username,
		Role:     string(user.Role),
		APIKey:   user.APIKey,
		IsActive: user.IsActive,
	}, nil
}

// FindUserByUsername looks up a user by username
func (a *MultiUserConfigAdapter) FindUserByUsername(ctx context.Context, username string) (*session.UserInfo, error) {
	if !a.enabled {
		return nil, nil
	}

	var user *models.User
	err := a.repository.WithReadTxn(ctx, func(ctx context.Context) error {
		var findErr error
		user, findErr = a.repository.User.FindByUsername(ctx, username)
		return findErr
	})

	if err != nil {
		return nil, err
	}

	if user == nil {
		return nil, nil
	}

	return &session.UserInfo{
		ID:       user.ID,
		Username: user.Username,
		Role:     string(user.Role),
		APIKey:   user.APIKey,
		IsActive: user.IsActive,
	}, nil
}
