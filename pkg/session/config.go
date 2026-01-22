package session

import "context"

type ExternalAccessConfig interface {
	HasCredentials() bool
	GetDangerousAllowPublicWithoutAuth() bool
	GetSecurityTripwireAccessedFromPublicInternet() string
	IsNewSystem() bool
}

type SessionConfig interface {
	GetUsername() string
	GetAPIKey() string

	GetSessionStoreKey() []byte
	GetMaxSessionAge() int
	ValidateCredentials(username string, password string) bool
}

// UserInfo contains basic user information for session management
type UserInfo struct {
	ID       int
	Username string
	Role     string
	APIKey   *string
	IsActive bool
}

// MultiUserConfig extends SessionConfig with multi-user support
type MultiUserConfig interface {
	SessionConfig

	// IsMultiUserEnabled returns true if multi-user mode is enabled
	IsMultiUserEnabled() bool

	// SetMultiUserEnabled enables or disables multi-user mode
	SetMultiUserEnabled(enabled bool)

	// ValidateUserCredentials validates credentials and returns user info
	ValidateUserCredentials(ctx context.Context, username, password string) (*UserInfo, error)

	// FindUserByAPIKey looks up a user by their API key
	FindUserByAPIKey(ctx context.Context, apiKey string) (*UserInfo, error)

	// FindUserByUsername looks up a user by username
	FindUserByUsername(ctx context.Context, username string) (*UserInfo, error)
}
