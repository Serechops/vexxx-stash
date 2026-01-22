package models

import (
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

// UserRole represents the role of a user in the system
type UserRole string

const (
	// UserRoleAdmin has full access to all features
	UserRoleAdmin UserRole = "admin"
	// UserRoleViewer has view-only access, cannot modify content
	UserRoleViewer UserRole = "viewer"
)

var AllUserRole = []UserRole{
	UserRoleAdmin,
	UserRoleViewer,
}

// IsValid checks if the role is a valid UserRole
func (r UserRole) IsValid() bool {
	switch r {
	case UserRoleAdmin, UserRoleViewer:
		return true
	}
	return false
}

func (r UserRole) String() string {
	return string(r)
}

func (r *UserRole) UnmarshalGQL(v interface{}) error {
	str, ok := v.(string)
	if !ok {
		return fmt.Errorf("enums must be strings")
	}

	// Convert from GraphQL uppercase to database lowercase
	*r = UserRole(strings.ToLower(str))
	if !r.IsValid() {
		return fmt.Errorf("%s is not a valid UserRole", str)
	}
	return nil
}

func (r UserRole) MarshalGQL(w io.Writer) {
	// Convert from database lowercase to GraphQL uppercase
	fmt.Fprint(w, strconv.Quote(strings.ToUpper(r.String())))
}

// User represents a user account in the system
type User struct {
	ID           int        `json:"id"`
	Username     string     `json:"username"`
	PasswordHash string     `json:"-"` // Never serialize password hash
	Role         UserRole   `json:"role"`
	APIKey       *string    `json:"api_key,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
	IsActive     bool       `json:"is_active"`
}

// NewUser creates a new User with default values
func NewUser() User {
	currentTime := time.Now()
	return User{
		Role:      UserRoleViewer,
		CreatedAt: currentTime,
		UpdatedAt: currentTime,
		IsActive:  true,
	}
}

// UserPartial represents partial update data for a User
type UserPartial struct {
	Username     OptionalString
	PasswordHash OptionalString
	Role         OptionalString
	APIKey       OptionalString
	UpdatedAt    OptionalTime
	LastLoginAt  OptionalTime
	IsActive     OptionalBool
}

// NewUserPartial creates a new UserPartial with the current time set for UpdatedAt
func NewUserPartial() UserPartial {
	currentTime := time.Now()
	return UserPartial{
		UpdatedAt: NewOptionalTime(currentTime),
	}
}

// UserCreateInput contains all data needed to create a new user
type UserCreateInput struct {
	Username string   `json:"username"`
	Password string   `json:"password"`
	Role     UserRole `json:"role"`
}

// UserUpdateInput contains data for updating an existing user
type UserUpdateInput struct {
	ID       string    `json:"id"`
	Username *string   `json:"username,omitempty"`
	Password *string   `json:"password,omitempty"`
	Role     *UserRole `json:"role,omitempty"`
	IsActive *bool     `json:"is_active,omitempty"`
}

// Permission helpers - these methods determine what a user can do

// IsAdmin returns true if the user has admin role
func (u *User) IsAdmin() bool {
	return u.Role == UserRoleAdmin
}

// CanModify returns true if the user can modify content (create, update)
func (u *User) CanModify() bool {
	return u.Role == UserRoleAdmin
}

// CanDelete returns true if the user can delete content
func (u *User) CanDelete() bool {
	return u.Role == UserRoleAdmin
}

// CanManageUsers returns true if the user can manage other users
func (u *User) CanManageUsers() bool {
	return u.Role == UserRoleAdmin
}

// CanRunTasks returns true if the user can run background tasks
func (u *User) CanRunTasks() bool {
	return u.Role == UserRoleAdmin
}

// CanModifySettings returns true if the user can modify system settings
func (u *User) CanModifySettings() bool {
	return u.Role == UserRoleAdmin
}

// UserSession represents an active login session
type UserSession struct {
	ID           int       `json:"id"`
	UserID       int       `json:"user_id"`
	SessionToken string    `json:"-"` // Never serialize session token
	ExpiresAt    time.Time `json:"expires_at"`
	CreatedAt    time.Time `json:"created_at"`
	IPAddress    *string   `json:"ip_address,omitempty"`
	UserAgent    *string   `json:"user_agent,omitempty"`
}

// NewUserSession creates a new UserSession with default values
func NewUserSession() UserSession {
	return UserSession{
		CreatedAt: time.Now(),
	}
}
