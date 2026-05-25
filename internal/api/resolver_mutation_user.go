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

// UserCreate creates a new user (admin only, or any unauthenticated request when no users exist - setup mode)
func (r *mutationResolver) UserCreate(ctx context.Context, input models.UserCreateInput) (*models.User, error) {
	// Allow unauthenticated creation of the first user (setup mode)
	if manager.GetInstance().GetUserCount() > 0 {
		if _, err := r.requireAdmin(ctx); err != nil {
			return nil, err
		}
	} else {
		// Setup mode: enforce that the first user must be an Admin
		if input.Role != models.UserRoleAdmin {
			return nil, errors.New("the first user must have the Admin role")
		}
	}

	// Validate input
	username := strings.TrimSpace(input.Username)
	if username == "" {
		return nil, errors.New("username cannot be empty")
	}
	if len(input.Password) < 1 {
		return nil, errors.New("password cannot be empty")
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
			if len(*input.Password) < 1 {
				return errors.New("password cannot be empty")
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

// UserDestroy deletes a user (admin only). Self-deletion is allowed.
func (r *mutationResolver) UserDestroy(ctx context.Context, id string) (bool, error) {
	if _, err := r.requireAdmin(ctx); err != nil {
		return false, err
	}

	idInt, err := strconv.Atoi(id)
	if err != nil {
		return false, fmt.Errorf("invalid user id: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		user, err := r.repository.User.Find(ctx, idInt)
		if err != nil {
			return err
		}
		if user == nil {
			return ErrUserNotFound
		}

		// Admins can only be deleted once all non-admin users are removed first.
		if user.IsAdmin() {
			total, err := r.repository.User.Count(ctx)
			if err != nil {
				return err
			}
			admins, err := r.repository.User.CountAdmins(ctx)
			if err != nil {
				return err
			}
			if total > admins {
				return errors.New("remove all non-admin users before deleting an admin account")
			}
		}

		if err := r.repository.User.Destroy(ctx, idInt); err != nil {
			return err
		}
		// Invalidate any server-side session records for the deleted user.
		return r.repository.User.DestroySessionsByUser(ctx, idInt)
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
	if len(newPassword) < 1 {
		return false, errors.New("new password cannot be empty")
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

// requireAdmin for mutations.
// In setup mode (no users exist), all access is allowed for initial configuration.
func (r *mutationResolver) requireAdmin(ctx context.Context) (*models.User, error) {
	// Setup mode: no users exist, allow all access.
	if manager.GetInstance().GetUserCount() == 0 {
		return nil, nil
	}
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
	if userID == nil || *userID == "" {
		// nil = no context key set; "" = setup mode / unauthenticated passthrough
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

// UserRemoveCredentials is not supported in this implementation.
// Delete the user account instead of removing credentials.
func (r *mutationResolver) UserRemoveCredentials(ctx context.Context, id string, currentPassword string) (bool, error) {
	return false, errors.New("removing credentials is not supported; delete the user account instead")
}
