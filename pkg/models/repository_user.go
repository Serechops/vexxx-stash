package models

import "context"

// UserGetter provides methods to get users by ID
type UserGetter interface {
	Find(ctx context.Context, id int) (*User, error)
	FindMany(ctx context.Context, ids []int) ([]*User, error)
}

// UserFinder provides methods to find users
type UserFinder interface {
	UserGetter
	FindByUsername(ctx context.Context, username string) (*User, error)
	FindByAPIKey(ctx context.Context, apiKey string) (*User, error)
}

// UserQueryer provides methods to query users
type UserQueryer interface {
	FindAll(ctx context.Context) ([]*User, error)
}

// UserCounter provides methods to count users
type UserCounter interface {
	Count(ctx context.Context) (int, error)
	CountAdmins(ctx context.Context) (int, error)
}

// UserCreator provides methods to create users
type UserCreator interface {
	Create(ctx context.Context, newUser *User) error
}

// UserUpdater provides methods to update users
type UserUpdater interface {
	Update(ctx context.Context, id int, partial UserPartial) (*User, error)
	UpdateLastLogin(ctx context.Context, id int) error
}

// UserDestroyer provides methods to destroy users
type UserDestroyer interface {
	Destroy(ctx context.Context, id int) error
}

// UserReader provides all read methods for users
type UserReader interface {
	UserFinder
	UserQueryer
	UserCounter
}

// UserWriter provides all write methods for users
type UserWriter interface {
	UserCreator
	UserUpdater
	UserDestroyer
}

// UserReaderWriter provides all methods for users
type UserReaderWriter interface {
	UserReader
	UserWriter
	UserSessionReaderWriter
}

// UserSessionFinder provides methods to find user sessions
type UserSessionFinder interface {
	FindByToken(ctx context.Context, token string) (*UserSession, error)
	FindByUserID(ctx context.Context, userID int) ([]*UserSession, error)
}

// UserSessionCreator provides methods to create user sessions
type UserSessionCreator interface {
	CreateSession(ctx context.Context, session *UserSession) error
}

// UserSessionDestroyer provides methods to destroy user sessions
type UserSessionDestroyer interface {
	DestroySession(ctx context.Context, token string) error
	DestroySessionsByUser(ctx context.Context, userID int) error
	DestroyExpiredSessions(ctx context.Context) error
}

// UserSessionReader provides all read methods for user sessions
type UserSessionReader interface {
	UserSessionFinder
}

// UserSessionWriter provides all write methods for user sessions
type UserSessionWriter interface {
	UserSessionCreator
	UserSessionDestroyer
}

// UserSessionReaderWriter provides all methods for user sessions
type UserSessionReaderWriter interface {
	UserSessionReader
	UserSessionWriter
}
