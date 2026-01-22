// Package session provides session authentication and management for the application.
package session

import (
	"context"
	"errors"
	"net/http"

	"github.com/gorilla/sessions"
	"github.com/stashapp/stash/pkg/logger"
)

type key int

const (
	contextUser key = iota
	contextUserInfo
	contextVisitedPlugins
)

const (
	userIDKey             = "userID"
	userRoleKey           = "userRole"
	visitedPluginHooksKey = "visitedPluginsHooks"
)

const (
	ApiKeyHeader    = "ApiKey"
	ApiKeyParameter = "apikey"
)

const (
	cookieName      = "session"
	usernameFormKey = "username"
	passwordFormKey = "password"
)

type InvalidCredentialsError struct {
	Username string
}

func (e InvalidCredentialsError) Error() string {
	// don't leak the username
	return "invalid credentials"
}

var ErrUnauthorized = errors.New("unauthorized")
var ErrUserDisabled = errors.New("user account is disabled")

type Store struct {
	sessionStore *sessions.CookieStore
	config       SessionConfig
}

func NewStore(c SessionConfig) *Store {
	ret := &Store{
		sessionStore: sessions.NewCookieStore(c.GetSessionStoreKey()),
		config:       c,
	}

	ret.sessionStore.MaxAge(c.GetMaxSessionAge())
	ret.sessionStore.Options.SameSite = http.SameSiteLaxMode

	return ret
}

// EnableMultiUser enables multi-user mode on the session store.
// This is called when the first user is created.
func (s *Store) EnableMultiUser() {
	if multiConfig, ok := s.config.(MultiUserConfig); ok {
		multiConfig.SetMultiUserEnabled(true)
		logger.Info("Multi-user mode enabled")
	}
}

// IsMultiUserEnabled returns true if multi-user mode is enabled
func (s *Store) IsMultiUserEnabled() bool {
	if multiConfig, ok := s.config.(MultiUserConfig); ok {
		return multiConfig.IsMultiUserEnabled()
	}
	return false
}

func (s *Store) Login(w http.ResponseWriter, r *http.Request) error {
	// ignore error - we want a new session regardless
	newSession, _ := s.sessionStore.Get(r, cookieName)

	username := r.FormValue(usernameFormKey)
	password := r.FormValue(passwordFormKey)

	// Try multi-user authentication first
	if multiConfig, ok := s.config.(MultiUserConfig); ok && multiConfig.IsMultiUserEnabled() {
		userInfo, err := multiConfig.ValidateUserCredentials(r.Context(), username, password)
		if err != nil {
			return &InvalidCredentialsError{Username: username}
		}
		if userInfo == nil {
			return &InvalidCredentialsError{Username: username}
		}
		if !userInfo.IsActive {
			return ErrUserDisabled
		}

		logger.Infof("User '%s' logged in (role: %s)", userInfo.Username, userInfo.Role)

		newSession.Values[userIDKey] = userInfo.Username
		newSession.Values[userRoleKey] = userInfo.Role

		return newSession.Save(r, w)
	}

	// Fall back to single-user config-based authentication
	if !s.config.ValidateCredentials(username, password) {
		return &InvalidCredentialsError{Username: username}
	}

	// since we only have one user, don't leak the name
	logger.Info("User logged in")

	newSession.Values[userIDKey] = username

	err := newSession.Save(r, w)
	if err != nil {
		return err
	}

	return nil
}

func (s *Store) Logout(w http.ResponseWriter, r *http.Request) error {
	session, err := s.sessionStore.Get(r, cookieName)
	if err != nil {
		return err
	}

	delete(session.Values, userIDKey)
	session.Options.MaxAge = -1

	err = session.Save(r, w)
	if err != nil {
		return err
	}

	// since we only have one user, don't leak the name
	logger.Infof("User logged out")

	return nil
}

func (s *Store) GetSessionUserID(w http.ResponseWriter, r *http.Request) (string, error) {
	session, err := s.sessionStore.Get(r, cookieName)
	// ignore errors and treat as an empty user id, so that we handle expired
	// cookie
	if err != nil {
		return "", nil
	}

	if !session.IsNew {
		val := session.Values[userIDKey]

		// refresh the cookie
		err = session.Save(r, w)
		if err != nil {
			return "", err
		}

		ret, _ := val.(string)

		return ret, nil
	}

	return "", nil
}

func SetCurrentUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, contextUser, userID)
}

// SetCurrentUserInfo sets the current user info in the context
func SetCurrentUserInfo(ctx context.Context, info *UserInfo) context.Context {
	return context.WithValue(ctx, contextUserInfo, info)
}

// GetCurrentUserID gets the current user id from the provided context
func GetCurrentUserID(ctx context.Context) *string {
	userCtxVal := ctx.Value(contextUser)
	if userCtxVal != nil {
		currentUser := userCtxVal.(string)
		return &currentUser
	}

	return nil
}

// GetCurrentUserInfo gets the current user info from the provided context
func GetCurrentUserInfo(ctx context.Context) *UserInfo {
	infoVal := ctx.Value(contextUserInfo)
	if infoVal != nil {
		return infoVal.(*UserInfo)
	}
	return nil
}

func (s *Store) Authenticate(w http.ResponseWriter, r *http.Request) (userID string, err error) {
	c := s.config

	// translate api key into current user, if present
	apiKey := r.Header.Get(ApiKeyHeader)

	// try getting the api key as a query parameter
	if apiKey == "" {
		apiKey = r.URL.Query().Get(ApiKeyParameter)
	}

	if apiKey != "" {
		// Try multi-user API key lookup first
		if multiConfig, ok := c.(MultiUserConfig); ok && multiConfig.IsMultiUserEnabled() {
			userInfo, findErr := multiConfig.FindUserByAPIKey(r.Context(), apiKey)
			if findErr == nil && userInfo != nil {
				if !userInfo.IsActive {
					return "", ErrUserDisabled
				}
				return userInfo.Username, nil
			}
		}

		// Fall back to config-based API key
		if c.GetAPIKey() != apiKey {
			return "", ErrUnauthorized
		}

		userID = c.GetUsername()
	} else {
		// handle session
		userID, err = s.GetSessionUserID(w, r)
	}

	if err != nil {
		return "", err
	}

	return
}
