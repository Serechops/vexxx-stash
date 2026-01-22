package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/doug-martin/goqu/v9"
	"github.com/doug-martin/goqu/v9/exp"
	"github.com/jmoiron/sqlx"

	"github.com/stashapp/stash/pkg/models"
)

const (
	userTable        = "users"
	userSessionTable = "user_sessions"
)

var (
	usersTableMgr = &table{
		table:    goqu.T(userTable),
		idColumn: goqu.T(userTable).Col(idColumn),
	}

	userSessionsTableMgr = &table{
		table:    goqu.T(userSessionTable),
		idColumn: goqu.T(userSessionTable).Col(idColumn),
	}
)

type userRow struct {
	ID           int       `db:"id" goqu:"skipinsert"`
	Username     string    `db:"username"`
	PasswordHash string    `db:"password_hash"`
	Role         string    `db:"role"`
	APIKey       *string   `db:"api_key"`
	CreatedAt    Timestamp `db:"created_at"`
	UpdatedAt    Timestamp `db:"updated_at"`
	LastLoginAt  *Timestamp `db:"last_login_at"`
	IsActive     bool      `db:"is_active"`
}

func (r *userRow) fromUser(u models.User) {
	r.ID = u.ID
	r.Username = u.Username
	r.PasswordHash = u.PasswordHash
	r.Role = string(u.Role)
	r.APIKey = u.APIKey
	r.CreatedAt = Timestamp{Timestamp: u.CreatedAt}
	r.UpdatedAt = Timestamp{Timestamp: u.UpdatedAt}
	if u.LastLoginAt != nil {
		r.LastLoginAt = &Timestamp{Timestamp: *u.LastLoginAt}
	}
	r.IsActive = u.IsActive
}

func (r *userRow) resolve() *models.User {
	ret := &models.User{
		ID:           r.ID,
		Username:     r.Username,
		PasswordHash: r.PasswordHash,
		Role:         models.UserRole(r.Role),
		APIKey:       r.APIKey,
		CreatedAt:    r.CreatedAt.Timestamp,
		UpdatedAt:    r.UpdatedAt.Timestamp,
		IsActive:     r.IsActive,
	}

	if r.LastLoginAt != nil {
		ret.LastLoginAt = &r.LastLoginAt.Timestamp
	}

	return ret
}

type userSessionRow struct {
	ID           int       `db:"id" goqu:"skipinsert"`
	UserID       int       `db:"user_id"`
	SessionToken string    `db:"session_token"`
	ExpiresAt    Timestamp `db:"expires_at"`
	CreatedAt    Timestamp `db:"created_at"`
	IPAddress    *string   `db:"ip_address"`
	UserAgent    *string   `db:"user_agent"`
}

func (r *userSessionRow) fromUserSession(s models.UserSession) {
	r.ID = s.ID
	r.UserID = s.UserID
	r.SessionToken = s.SessionToken
	r.ExpiresAt = Timestamp{Timestamp: s.ExpiresAt}
	r.CreatedAt = Timestamp{Timestamp: s.CreatedAt}
	r.IPAddress = s.IPAddress
	r.UserAgent = s.UserAgent
}

func (r *userSessionRow) resolve() *models.UserSession {
	return &models.UserSession{
		ID:           r.ID,
		UserID:       r.UserID,
		SessionToken: r.SessionToken,
		ExpiresAt:    r.ExpiresAt.Timestamp,
		CreatedAt:    r.CreatedAt.Timestamp,
		IPAddress:    r.IPAddress,
		UserAgent:    r.UserAgent,
	}
}

// UserStore provides methods for user database operations
type UserStore struct {
	repository
	tableMgr        *table
	sessionTableMgr *table
}

// NewUserStore creates a new UserStore
func NewUserStore() *UserStore {
	return &UserStore{
		repository: repository{
			tableName: userTable,
			idColumn:  idColumn,
		},
		tableMgr:        usersTableMgr,
		sessionTableMgr: userSessionsTableMgr,
	}
}

func (qb *UserStore) table() exp.IdentifierExpression {
	return qb.tableMgr.table
}

func (qb *UserStore) selectDataset() *goqu.SelectDataset {
	return dialect.From(qb.table()).Select(qb.table().All())
}

func (qb *UserStore) sessionTable() exp.IdentifierExpression {
	return qb.sessionTableMgr.table
}

func (qb *UserStore) sessionSelectDataset() *goqu.SelectDataset {
	return dialect.From(qb.sessionTable()).Select(qb.sessionTable().All())
}

// Create creates a new user in the database
func (qb *UserStore) Create(ctx context.Context, newUser *models.User) error {
	var r userRow
	r.fromUser(*newUser)

	id, err := qb.tableMgr.insertID(ctx, r)
	if err != nil {
		return fmt.Errorf("creating user: %w", err)
	}

	updated, err := qb.Find(ctx, id)
	if err != nil {
		return fmt.Errorf("finding after create: %w", err)
	}

	*newUser = *updated

	return nil
}

// Update partially updates an existing user
func (qb *UserStore) Update(ctx context.Context, id int, partial models.UserPartial) (*models.User, error) {
	if err := qb.tableMgr.checkIDExists(ctx, id); err != nil {
		return nil, err
	}

	r := userRowFromPartial(partial)

	if !r.IsEmpty() {
		if err := qb.tableMgr.updateByID(ctx, id, r); err != nil {
			return nil, fmt.Errorf("updating user: %w", err)
		}
	}

	return qb.Find(ctx, id)
}

type userRowPartial struct {
	Username     *string    `db:"username" goqu:"omitempty"`
	PasswordHash *string    `db:"password_hash" goqu:"omitempty"`
	Role         *string    `db:"role" goqu:"omitempty"`
	APIKey       *string    `db:"api_key" goqu:"omitempty"`
	UpdatedAt    *Timestamp `db:"updated_at" goqu:"omitempty"`
	LastLoginAt  *Timestamp `db:"last_login_at" goqu:"omitempty"`
	IsActive     *bool      `db:"is_active" goqu:"omitempty"`
}

func (r userRowPartial) IsEmpty() bool {
	return r.Username == nil &&
		r.PasswordHash == nil &&
		r.Role == nil &&
		r.APIKey == nil &&
		r.UpdatedAt == nil &&
		r.LastLoginAt == nil &&
		r.IsActive == nil
}

func userRowFromPartial(partial models.UserPartial) userRowPartial {
	r := userRowPartial{}

	if partial.Username.Set {
		r.Username = &partial.Username.Value
	}
	if partial.PasswordHash.Set {
		r.PasswordHash = &partial.PasswordHash.Value
	}
	if partial.Role.Set {
		r.Role = &partial.Role.Value
	}
	if partial.APIKey.Set {
		r.APIKey = &partial.APIKey.Value
	}
	if partial.UpdatedAt.Set {
		ts := Timestamp{Timestamp: partial.UpdatedAt.Value}
		r.UpdatedAt = &ts
	}
	if partial.LastLoginAt.Set {
		ts := Timestamp{Timestamp: partial.LastLoginAt.Value}
		r.LastLoginAt = &ts
	}
	if partial.IsActive.Set {
		r.IsActive = &partial.IsActive.Value
	}

	return r
}

// UpdateLastLogin updates the last login timestamp for a user
func (qb *UserStore) UpdateLastLogin(ctx context.Context, id int) error {
	partial := models.UserPartial{
		LastLoginAt: models.NewOptionalTime(time.Now()),
	}
	_, err := qb.Update(ctx, id, partial)
	return err
}

// Destroy deletes a user by ID
func (qb *UserStore) Destroy(ctx context.Context, id int) error {
	return qb.destroyExisting(ctx, []int{id})
}

// Find returns a user by ID
func (qb *UserStore) Find(ctx context.Context, id int) (*models.User, error) {
	ret, err := qb.find(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return ret, err
}

func (qb *UserStore) find(ctx context.Context, id int) (*models.User, error) {
	q := qb.selectDataset().Where(qb.tableMgr.byID(id))

	ret, err := qb.get(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("getting user by id %d: %w", id, err)
	}

	return ret, nil
}

// FindMany returns users by IDs
func (qb *UserStore) FindMany(ctx context.Context, ids []int) ([]*models.User, error) {
	tableMgr := qb.tableMgr
	q := qb.selectDataset().Where(tableMgr.byIDInts(ids...))

	return qb.getMany(ctx, q)
}

// FindByUsername returns a user by username (case-insensitive)
func (qb *UserStore) FindByUsername(ctx context.Context, username string) (*models.User, error) {
	q := qb.selectDataset().Where(
		goqu.L("LOWER(username)").Eq(goqu.L("LOWER(?)", username)),
	)

	ret, err := qb.get(ctx, q)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("finding user by username: %w", err)
	}

	return ret, nil
}

// FindByAPIKey returns a user by API key
func (qb *UserStore) FindByAPIKey(ctx context.Context, apiKey string) (*models.User, error) {
	q := qb.selectDataset().Where(
		goqu.C("api_key").Eq(apiKey),
	)

	ret, err := qb.get(ctx, q)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("finding user by api key: %w", err)
	}

	return ret, nil
}

// FindAll returns all users
func (qb *UserStore) FindAll(ctx context.Context) ([]*models.User, error) {
	q := qb.selectDataset().Order(goqu.C("username").Asc())

	return qb.getMany(ctx, q)
}

// Count returns the total number of users
func (qb *UserStore) Count(ctx context.Context) (int, error) {
	q := dialect.From(qb.table()).Select(goqu.COUNT("*"))

	var count int
	if err := querySimple(ctx, q, &count); err != nil {
		return 0, fmt.Errorf("counting users: %w", err)
	}

	return count, nil
}

// CountAdmins returns the number of admin users
func (qb *UserStore) CountAdmins(ctx context.Context) (int, error) {
	q := dialect.From(qb.table()).
		Select(goqu.COUNT("*")).
		Where(goqu.C("role").Eq(string(models.UserRoleAdmin)))

	var count int
	if err := querySimple(ctx, q, &count); err != nil {
		return 0, fmt.Errorf("counting admin users: %w", err)
	}

	return count, nil
}

func (qb *UserStore) get(ctx context.Context, q *goqu.SelectDataset) (*models.User, error) {
	ret, err := qb.getMany(ctx, q)
	if err != nil {
		return nil, err
	}

	if len(ret) == 0 {
		return nil, sql.ErrNoRows
	}

	return ret[0], nil
}

func (qb *UserStore) getMany(ctx context.Context, q *goqu.SelectDataset) ([]*models.User, error) {
	const single = false
	var ret []*models.User
	if err := queryFunc(ctx, q, single, func(r *sqlx.Rows) error {
		var row userRow
		if err := r.StructScan(&row); err != nil {
			return err
		}
		ret = append(ret, row.resolve())
		return nil
	}); err != nil {
		return nil, err
	}

	return ret, nil
}

// Session methods

// CreateSession creates a new user session
func (qb *UserStore) CreateSession(ctx context.Context, session *models.UserSession) error {
	var r userSessionRow
	r.fromUserSession(*session)

	id, err := qb.sessionTableMgr.insertID(ctx, r)
	if err != nil {
		return fmt.Errorf("creating session: %w", err)
	}

	session.ID = id
	return nil
}

// FindByToken returns a session by token
func (qb *UserStore) FindByToken(ctx context.Context, token string) (*models.UserSession, error) {
	q := qb.sessionSelectDataset().Where(
		goqu.C("session_token").Eq(token),
	)

	ret, err := qb.getSession(ctx, q)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("finding session by token: %w", err)
	}

	return ret, nil
}

// FindByUserID returns all sessions for a user
func (qb *UserStore) FindByUserID(ctx context.Context, userID int) ([]*models.UserSession, error) {
	q := qb.sessionSelectDataset().Where(
		goqu.C("user_id").Eq(userID),
	)

	return qb.getSessions(ctx, q)
}

// DestroySession deletes a session by token
func (qb *UserStore) DestroySession(ctx context.Context, token string) error {
	q := dialect.Delete(qb.sessionTable()).Where(
		goqu.C("session_token").Eq(token),
	)

	if _, err := exec(ctx, q); err != nil {
		return fmt.Errorf("destroying session: %w", err)
	}

	return nil
}

// DestroySessionsByUser deletes all sessions for a user
func (qb *UserStore) DestroySessionsByUser(ctx context.Context, userID int) error {
	q := dialect.Delete(qb.sessionTable()).Where(
		goqu.C("user_id").Eq(userID),
	)

	if _, err := exec(ctx, q); err != nil {
		return fmt.Errorf("destroying user sessions: %w", err)
	}

	return nil
}

// DestroyExpiredSessions deletes all expired sessions
func (qb *UserStore) DestroyExpiredSessions(ctx context.Context) error {
	q := dialect.Delete(qb.sessionTable()).Where(
		goqu.C("expires_at").Lt(time.Now()),
	)

	if _, err := exec(ctx, q); err != nil {
		return fmt.Errorf("destroying expired sessions: %w", err)
	}

	return nil
}

func (qb *UserStore) getSession(ctx context.Context, q *goqu.SelectDataset) (*models.UserSession, error) {
	ret, err := qb.getSessions(ctx, q)
	if err != nil {
		return nil, err
	}

	if len(ret) == 0 {
		return nil, sql.ErrNoRows
	}

	return ret[0], nil
}

func (qb *UserStore) getSessions(ctx context.Context, q *goqu.SelectDataset) ([]*models.UserSession, error) {
	const single = false
	var ret []*models.UserSession
	if err := queryFunc(ctx, q, single, func(r *sqlx.Rows) error {
		var row userSessionRow
		if err := r.StructScan(&row); err != nil {
			return err
		}
		ret = append(ret, row.resolve())
		return nil
	}); err != nil {
		return nil, err
	}

	return ret, nil
}
