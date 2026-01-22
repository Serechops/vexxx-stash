package api

import (
	"context"
	"fmt"

	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/session"
)

// AuthorizationContext holds authorization information for the current request
type AuthorizationContext struct {
	User *models.User
}

// contextKey is a custom type for context keys to avoid collisions
type authContextKey string

const authContextKeyName authContextKey = "authContext"

// SetAuthContext sets the authorization context in the request context
func SetAuthContext(ctx context.Context, authCtx *AuthorizationContext) context.Context {
	return context.WithValue(ctx, authContextKeyName, authCtx)
}

// GetAuthContext retrieves the authorization context from the request context
func GetAuthContext(ctx context.Context) *AuthorizationContext {
	val := ctx.Value(authContextKeyName)
	if val == nil {
		return nil
	}
	authCtx, ok := val.(*AuthorizationContext)
	if !ok {
		return nil
	}
	return authCtx
}

// GetCurrentUserFromContext retrieves the current user from the context
// This is a convenience function that first checks for AuthorizationContext
// and falls back to looking up by username from session context
func GetCurrentUserFromContext(ctx context.Context, userRepo models.UserReader) (*models.User, error) {
	// First check if we have an AuthorizationContext (preferred for multi-user)
	authCtx := GetAuthContext(ctx)
	if authCtx != nil && authCtx.User != nil {
		return authCtx.User, nil
	}

	// Fall back to session-based user ID (current behavior during migration)
	userID := session.GetCurrentUserID(ctx)
	if userID == nil {
		return nil, nil
	}

	// Look up user by username
	user, err := userRepo.FindByUsername(ctx, *userID)
	if err != nil {
		return nil, fmt.Errorf("looking up user: %w", err)
	}

	return user, nil
}

// RequireAuth ensures the request is authenticated
func RequireAuth(ctx context.Context) error {
	// Check AuthorizationContext first
	authCtx := GetAuthContext(ctx)
	if authCtx != nil && authCtx.User != nil {
		return nil
	}

	// Fall back to session-based check
	userID := session.GetCurrentUserID(ctx)
	if userID == nil || *userID == "" {
		return ErrNotAuthenticated
	}

	return nil
}

// RequireRole ensures the request is from a user with the specified role
func RequireRole(ctx context.Context, requiredRole models.UserRole, userRepo models.UserReader) error {
	user, err := GetCurrentUserFromContext(ctx, userRepo)
	if err != nil {
		return err
	}
	if user == nil {
		return ErrNotAuthenticated
	}

	// Admin role can access everything
	if user.Role == models.UserRoleAdmin {
		return nil
	}

	// Check specific role
	if user.Role != requiredRole {
		return ErrNotAuthorized
	}

	return nil
}

// RequireAdmin ensures the request is from an admin user
func RequireAdmin(ctx context.Context, userRepo models.UserReader) error {
	return RequireRole(ctx, models.UserRoleAdmin, userRepo)
}

// CanModify checks if the current user can modify content
func CanModify(ctx context.Context, userRepo models.UserReader) (bool, error) {
	user, err := GetCurrentUserFromContext(ctx, userRepo)
	if err != nil {
		return false, err
	}
	if user == nil {
		return false, nil
	}
	return user.CanModify(), nil
}

// CanDelete checks if the current user can delete content
func CanDelete(ctx context.Context, userRepo models.UserReader) (bool, error) {
	user, err := GetCurrentUserFromContext(ctx, userRepo)
	if err != nil {
		return false, err
	}
	if user == nil {
		return false, nil
	}
	return user.CanDelete(), nil
}

// CanManageUsers checks if the current user can manage other users
func CanManageUsers(ctx context.Context, userRepo models.UserReader) (bool, error) {
	user, err := GetCurrentUserFromContext(ctx, userRepo)
	if err != nil {
		return false, err
	}
	if user == nil {
		return false, nil
	}
	return user.CanManageUsers(), nil
}

// CanRunTasks checks if the current user can run background tasks
func CanRunTasks(ctx context.Context, userRepo models.UserReader) (bool, error) {
	user, err := GetCurrentUserFromContext(ctx, userRepo)
	if err != nil {
		return false, err
	}
	if user == nil {
		return false, nil
	}
	return user.CanRunTasks(), nil
}

// CanModifySettings checks if the current user can modify system settings
func CanModifySettings(ctx context.Context, userRepo models.UserReader) (bool, error) {
	user, err := GetCurrentUserFromContext(ctx, userRepo)
	if err != nil {
		return false, err
	}
	if user == nil {
		return false, nil
	}
	return user.CanModifySettings(), nil
}

// RequireModifyPermission ensures the current user can modify content
func RequireModifyPermission(ctx context.Context, userRepo models.UserReader) error {
	can, err := CanModify(ctx, userRepo)
	if err != nil {
		return err
	}
	if !can {
		return ErrNotAuthorized
	}
	return nil
}

// RequireDeletePermission ensures the current user can delete content
func RequireDeletePermission(ctx context.Context, userRepo models.UserReader) error {
	can, err := CanDelete(ctx, userRepo)
	if err != nil {
		return err
	}
	if !can {
		return ErrNotAuthorized
	}
	return nil
}

// RequireTaskPermission ensures the current user can run tasks
func RequireTaskPermission(ctx context.Context, userRepo models.UserReader) error {
	can, err := CanRunTasks(ctx, userRepo)
	if err != nil {
		return err
	}
	if !can {
		return ErrNotAuthorized
	}
	return nil
}

// RequireSettingsPermission ensures the current user can modify settings
func RequireSettingsPermission(ctx context.Context, userRepo models.UserReader) error {
	can, err := CanModifySettings(ctx, userRepo)
	if err != nil {
		return err
	}
	if !can {
		return ErrNotAuthorized
	}
	return nil
}
