package api

import (
	"context"
	"errors"
	"strconv"

	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/session"
)

// User authorization errors
var (
	ErrNotAuthenticated = errors.New("not authenticated")
	ErrNotAuthorized    = errors.New("not authorized")
	ErrUserNotFound     = errors.New("user not found")
)

// getCurrentUser retrieves the current user from the context
func (r *queryResolver) getCurrentUser(ctx context.Context) (*models.User, error) {
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

// requireAdmin checks if the current user is an admin
func (r *queryResolver) requireAdmin(ctx context.Context) (*models.User, error) {
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

// CurrentUser returns the currently authenticated user with their permissions
func (r *queryResolver) CurrentUser(ctx context.Context) (*CurrentUser, error) {
	user, err := r.getCurrentUser(ctx)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, nil
	}

	return &CurrentUser{
		ID:       strconv.Itoa(user.ID),
		Username: user.Username,
		Role:     user.Role,
		Permissions: &UserPermissions{
			CanModify:         user.CanModify(),
			CanDelete:         user.CanDelete(),
			CanManageUsers:    user.CanManageUsers(),
			CanRunTasks:       user.CanRunTasks(),
			CanModifySettings: user.CanModifySettings(),
		},
	}, nil
}

// FindUser returns a user by ID (admin only)
func (r *queryResolver) FindUser(ctx context.Context, id string) (*models.User, error) {
	if _, err := r.requireAdmin(ctx); err != nil {
		return nil, err
	}

	idInt, err := strconv.Atoi(id)
	if err != nil {
		return nil, err
	}

	var user *models.User
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		user, err = r.repository.User.Find(ctx, idInt)
		return err
	}); err != nil {
		return nil, err
	}

	return user, nil
}

// FindUsers returns all users (admin only)
func (r *queryResolver) FindUsers(ctx context.Context) ([]*models.User, error) {
	if _, err := r.requireAdmin(ctx); err != nil {
		return nil, err
	}

	var users []*models.User
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		users, err = r.repository.User.FindAll(ctx)
		return err
	}); err != nil {
		return nil, err
	}

	return users, nil
}

// UserCount returns user count statistics
func (r *queryResolver) UserCount(ctx context.Context) (*UserCountResult, error) {
	var count, adminCount int
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		count, err = r.repository.User.Count(ctx)
		if err != nil {
			return err
		}
		adminCount, err = r.repository.User.CountAdmins(ctx)
		return err
	}); err != nil {
		return nil, err
	}

	return &UserCountResult{
		Count:      count,
		AdminCount: adminCount,
	}, nil
}

// FindUserSessions returns sessions for a user (admin only)
func (r *queryResolver) FindUserSessions(ctx context.Context, userID string) ([]*models.UserSession, error) {
	if _, err := r.requireAdmin(ctx); err != nil {
		return nil, err
	}

	userIDInt, err := strconv.Atoi(userID)
	if err != nil {
		return nil, err
	}

	var sessions []*models.UserSession
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		sessions, err = r.repository.User.FindByUserID(ctx, userIDInt)
		return err
	}); err != nil {
		return nil, err
	}

	return sessions, nil
}
