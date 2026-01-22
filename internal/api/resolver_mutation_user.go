package api

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/session"
	"golang.org/x/crypto/bcrypt"
)

// Password hashing cost
const bcryptCost = 10

// hashPassword hashes a password using bcrypt
func hashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", fmt.Errorf("hashing password: %w", err)
	}
	return string(hash), nil
}

// verifyPassword checks if a password matches a hash
func verifyPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// generateAPIKey creates a new random API key
func generateAPIKey() string {
	return uuid.New().String()
}

// UserCreate creates a new user (admin only)
func (r *mutationResolver) UserCreate(ctx context.Context, input models.UserCreateInput) (*models.User, error) {
	if _, err := r.requireAdmin(ctx); err != nil {
		return nil, err
	}

	// Validate input
	username := strings.TrimSpace(input.Username)
	if username == "" {
		return nil, errors.New("username cannot be empty")
	}
	if len(input.Password) < 6 {
		return nil, errors.New("password must be at least 6 characters")
	}

	// Hash password
	passwordHash, err := hashPassword(input.Password)
	if err != nil {
		return nil, err
	}

	// Validate role
	if !input.Role.IsValid() {
		return nil, fmt.Errorf("invalid role: %s", input.Role)
	}

	// Generate API key
	apiKey := generateAPIKey()

	now := time.Now()
	user := &models.User{
		Username:     username,
		PasswordHash: passwordHash,
		Role:         input.Role,
		APIKey:       &apiKey,
		CreatedAt:    now,
		UpdatedAt:    now,
		IsActive:     true,
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		// Check if username already exists
		existing, err := r.repository.User.FindByUsername(ctx, username)
		if err != nil {
			return err
		}
		if existing != nil {
			return fmt.Errorf("username '%s' already exists", username)
		}

		return r.repository.User.Create(ctx, user)
	}); err != nil {
		return nil, err
	}

	// Enable multi-user mode if not already enabled
	// This ensures multi-user mode is active as soon as a user is created
	if mgr := manager.GetInstance(); mgr != nil && mgr.SessionStore != nil {
		if !mgr.SessionStore.IsMultiUserEnabled() {
			mgr.SessionStore.EnableMultiUser()
		}
	}

	// TODO: Add plugin hook support for user events
	// r.hookExecutor.ExecutePostHooks(ctx, user.ID, hook.UserCreatePost, nil, nil)

	return user, nil
}

// UserUpdate updates an existing user (admin only)
func (r *mutationResolver) UserUpdate(ctx context.Context, input models.UserUpdateInput) (*models.User, error) {
	if _, err := r.requireAdmin(ctx); err != nil {
		return nil, err
	}

	id, err := strconv.Atoi(input.ID)
	if err != nil {
		return nil, fmt.Errorf("invalid user id: %w", err)
	}

	var user *models.User
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		// Find existing user
		existing, err := r.repository.User.Find(ctx, id)
		if err != nil {
			return err
		}
		if existing == nil {
			return ErrUserNotFound
		}

		// Build partial update
		partial := models.NewUserPartial()

		if input.Username != nil {
			username := strings.TrimSpace(*input.Username)
			if username == "" {
				return errors.New("username cannot be empty")
			}
			// Check if new username is taken by another user
			other, err := r.repository.User.FindByUsername(ctx, username)
			if err != nil {
				return err
			}
			if other != nil && other.ID != id {
				return fmt.Errorf("username '%s' already exists", username)
			}
			partial.Username = models.NewOptionalString(username)
		}

		if input.Password != nil {
			if len(*input.Password) < 6 {
				return errors.New("password must be at least 6 characters")
			}
			hash, err := hashPassword(*input.Password)
			if err != nil {
				return err
			}
			partial.PasswordHash = models.NewOptionalString(hash)
		}

		if input.Role != nil {
			if !input.Role.IsValid() {
				return fmt.Errorf("invalid role: %s", *input.Role)
			}

			// Prevent demoting the last admin
			if existing.IsAdmin() && *input.Role != models.UserRoleAdmin {
				adminCount, err := r.repository.User.CountAdmins(ctx)
				if err != nil {
					return err
				}
				if adminCount <= 1 {
					return errors.New("cannot demote the last admin user")
				}
			}

			partial.Role = models.NewOptionalString(string(*input.Role))
		}

		if input.IsActive != nil {
			// Prevent deactivating the last admin
			if existing.IsAdmin() && !*input.IsActive {
				adminCount, err := r.repository.User.CountAdmins(ctx)
				if err != nil {
					return err
				}
				if adminCount <= 1 {
					return errors.New("cannot deactivate the last admin user")
				}
			}
			partial.IsActive = models.NewOptionalBool(*input.IsActive)
		}

		user, err = r.repository.User.Update(ctx, id, partial)
		return err
	}); err != nil {
		return nil, err
	}

	// TODO: Add plugin hook support for user events
	// r.hookExecutor.ExecutePostHooks(ctx, user.ID, hook.UserUpdatePost, nil, nil)

	return user, nil
}

// UserDestroy deletes a user (admin only)
func (r *mutationResolver) UserDestroy(ctx context.Context, id string) (bool, error) {
	currentUser, err := r.requireAdmin(ctx)
	if err != nil {
		return false, err
	}

	idInt, err := strconv.Atoi(id)
	if err != nil {
		return false, fmt.Errorf("invalid user id: %w", err)
	}

	// Prevent self-deletion
	if currentUser.ID == idInt {
		return false, errors.New("cannot delete yourself")
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		// Find user to check if they're the last admin
		user, err := r.repository.User.Find(ctx, idInt)
		if err != nil {
			return err
		}
		if user == nil {
			return ErrUserNotFound
		}

		// Prevent deleting the last admin
		if user.IsAdmin() {
			adminCount, err := r.repository.User.CountAdmins(ctx)
			if err != nil {
				return err
			}
			if adminCount <= 1 {
				return errors.New("cannot delete the last admin user")
			}
		}

		return r.repository.User.Destroy(ctx, idInt)
	}); err != nil {
		return false, err
	}

	// TODO: Add plugin hook support for user events
	// r.hookExecutor.ExecutePostHooks(ctx, id, hook.UserDestroyPost, nil, nil)

	return true, nil
}

// UserRegenerateAPIKey regenerates the API key for a user (admin only)
func (r *mutationResolver) UserRegenerateAPIKey(ctx context.Context, id string) (string, error) {
	if _, err := r.requireAdmin(ctx); err != nil {
		return "", err
	}

	idInt, err := strconv.Atoi(id)
	if err != nil {
		return "", fmt.Errorf("invalid user id: %w", err)
	}

	newKey := generateAPIKey()

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		partial := models.NewUserPartial()
		partial.APIKey = models.NewOptionalString(newKey)
		_, err := r.repository.User.Update(ctx, idInt, partial)
		return err
	}); err != nil {
		return "", err
	}

	return newKey, nil
}

// ChangeOwnPassword allows any authenticated user to change their password
func (r *mutationResolver) ChangeOwnPassword(ctx context.Context, currentPassword string, newPassword string) (bool, error) {
	user, err := r.getCurrentUser(ctx)
	if err != nil {
		return false, err
	}
	if user == nil {
		return false, ErrNotAuthenticated
	}

	// Verify current password
	if !verifyPassword(currentPassword, user.PasswordHash) {
		return false, errors.New("current password is incorrect")
	}

	// Validate new password
	if len(newPassword) < 6 {
		return false, errors.New("new password must be at least 6 characters")
	}

	// Hash new password
	hash, err := hashPassword(newPassword)
	if err != nil {
		return false, err
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		partial := models.NewUserPartial()
		partial.PasswordHash = models.NewOptionalString(hash)
		_, err := r.repository.User.Update(ctx, user.ID, partial)
		return err
	}); err != nil {
		return false, err
	}

	return true, nil
}

// RegenerateOwnAPIKey allows any authenticated user to regenerate their API key
func (r *mutationResolver) RegenerateOwnAPIKey(ctx context.Context) (string, error) {
	user, err := r.getCurrentUser(ctx)
	if err != nil {
		return "", err
	}
	if user == nil {
		return "", ErrNotAuthenticated
	}

	newKey := generateAPIKey()

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		partial := models.NewUserPartial()
		partial.APIKey = models.NewOptionalString(newKey)
		_, err := r.repository.User.Update(ctx, user.ID, partial)
		return err
	}); err != nil {
		return "", err
	}

	return newKey, nil
}

// SessionDestroy terminates a specific session (admin only)
func (r *mutationResolver) SessionDestroy(ctx context.Context, id string) (bool, error) {
	if _, err := r.requireAdmin(ctx); err != nil {
		return false, err
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		return r.repository.User.DestroySession(ctx, id)
	}); err != nil {
		return false, err
	}

	return true, nil
}

// SessionDestroyByUser terminates all sessions for a user (admin only)
func (r *mutationResolver) SessionDestroyByUser(ctx context.Context, userID string) (bool, error) {
	if _, err := r.requireAdmin(ctx); err != nil {
		return false, err
	}

	userIDInt, err := strconv.Atoi(userID)
	if err != nil {
		return false, fmt.Errorf("invalid user id: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		return r.repository.User.DestroySessionsByUser(ctx, userIDInt)
	}); err != nil {
		return false, err
	}

	return true, nil
}

// requireAdmin for mutations - helper that returns an error for unauthorized access
func (r *mutationResolver) requireAdmin(ctx context.Context) (*models.User, error) {
	user, err := r.getCurrentUser(ctx)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrNotAuthenticated
	}
	if !user.IsAdmin() {
		return nil, ErrNotAuthorized
	}
	return user, nil
}

// getCurrentUser for mutations
func (r *mutationResolver) getCurrentUser(ctx context.Context) (*models.User, error) {
	userID := session.GetCurrentUserID(ctx)
	if userID == nil {
		return nil, nil
	}

	var user *models.User
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		user, err = r.repository.User.FindByUsername(ctx, *userID)
		return err
	}); err != nil {
		return nil, err
	}

	return user, nil
}
