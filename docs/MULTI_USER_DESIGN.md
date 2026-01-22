# Multi-User Support Design Document

> **Created:** January 22, 2026  
> **Status:** Implementation Complete (Backend)  
> **Priority:** High (Community Request)

---

## Executive Summary

This document outlines the architecture and implementation plan for adding multi-user support to Stash with role-based access control (RBAC). The primary goal is to allow **admin** users to create **viewer** accounts with restricted, non-destructive access.

## Implementation Status

### ✅ Completed Components

| Component | Status | Files |
|-----------|--------|-------|
| Database Migration | ✅ Complete | `pkg/sqlite/migrations/84_users.up.sql` |
| User Model | ✅ Complete | `pkg/models/model_user.go` |
| Repository Interface | ✅ Complete | `pkg/models/repository_user.go` |
| SQLite Implementation | ✅ Complete | `pkg/sqlite/user.go` |
| GraphQL Schema | ✅ Complete | `graphql/schema/types/user.graphql` |
| Query Resolvers | ✅ Complete | `internal/api/resolver_query_user.go` |
| Mutation Resolvers | ✅ Complete | `internal/api/resolver_mutation_user.go` |
| Authorization Helpers | ✅ Complete | `internal/api/authorization.go` |
| Session Management | ✅ Complete | `pkg/session/session.go`, `pkg/session/config.go` |
| Multi-User Config | ✅ Complete | `internal/manager/multiuser_config.go` |
| Credential Migration | ✅ Complete | `internal/manager/migrate_credentials.go` |

### 🔄 Pending Components

| Component | Status | Notes |
|-----------|--------|-------|
| Frontend UI | 🔄 Pending | User management interface needed |
| Mutation Protection | 🔄 Pending | Add role checks to existing mutations |
| API Key Per-User | ✅ Complete | Users have individual API keys |

---

## Current State Analysis

### Authentication Today
- **Single-user model**: One username/password stored in `config.yml`
- **Session management**: Cookie-based via `gorilla/sessions` (`pkg/session/session.go`)
- **API key**: Single shared key for all programmatic access
- **User context**: `session.GetCurrentUserID(ctx)` returns username string (or nil)

### Key Files
| File | Purpose |
|------|---------|
| `pkg/session/session.go` | Session store, login/logout, user context |
| `pkg/session/authentication.go` | Public access tripwire, IP validation |
| `internal/api/authentication.go` | HTTP middleware, login redirect |
| `internal/api/session.go` | Login page rendering |
| `internal/manager/config/config.go` | Credential storage (bcrypt hash) |

### Limitations
- No persistent user table (credentials in config file)
- No role/permission system
- Single API key shared across all access
- No per-user preferences or history

---

## Requirements

### Functional Requirements

#### FR-1: User Roles
| Role | Permissions |
|------|-------------|
| **Admin** | Full access (current behavior) |
| **Viewer** | View-only, non-destructive access |

#### FR-2: Admin Capabilities
- Create/edit/delete user accounts
- Assign roles to users
- Reset user passwords
- View active sessions
- Terminate user sessions

#### FR-3: Viewer Restrictions
**Cannot:**
- Modify metadata (scenes, performers, tags, studios, groups)
- Delete any content
- Run destructive tasks (clean, organize, rename)
- Change system settings
- Manage plugins/scrapers
- Access user management

**Can:**
- Browse all content (scenes, images, galleries, performers, etc.)
- Watch/view media
- Use search and filters
- View statistics and dashboards
- Use saved filters (read-only)
- Access scene markers (view only)

#### FR-4: Per-User API Keys
- Each user gets their own API key
- API key inherits user's role permissions
- Admin can revoke individual keys

---

## Database Schema

### Migration 84: users.up.sql

```sql
-- Create users table
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
    api_key TEXT UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME,
    is_active BOOLEAN NOT NULL DEFAULT 1
);

-- Create sessions table for better session management
CREATE TABLE user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token TEXT NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT
);

-- Create indexes
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_api_key ON users(api_key);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);
```

### Migration Strategy

**Backward Compatibility:**
1. Check if legacy credentials exist in config
2. If yes, create admin user with those credentials during migration
3. Clear credentials from config after successful migration
4. Display one-time message to user about migration

```go
// 84_postmigrate.go
func postMigrate(ctx context.Context, db *sqlx.DB) error {
    cfg := config.GetInstance()
    
    if cfg.HasCredentials() {
        username, pwHash := cfg.GetCredentials()
        
        // Create admin user from legacy credentials
        _, err := db.ExecContext(ctx, `
            INSERT INTO users (username, password_hash, role, api_key)
            VALUES (?, ?, 'admin', ?)
        `, username, pwHash, cfg.GetAPIKey())
        
        if err != nil {
            return err
        }
        
        // Mark config for credential removal
        // (actual removal happens after successful migration)
    }
    
    return nil
}
```

---

## Go Models

### `pkg/models/user.go`

```go
package models

import "time"

type UserRole string

const (
    UserRoleAdmin  UserRole = "admin"
    UserRoleViewer UserRole = "viewer"
)

type User struct {
    ID           int       `json:"id"`
    Username     string    `json:"username"`
    PasswordHash string    `json:"-"` // Never serialize
    Role         UserRole  `json:"role"`
    APIKey       *string   `json:"api_key,omitempty"`
    CreatedAt    time.Time `json:"created_at"`
    UpdatedAt    time.Time `json:"updated_at"`
    LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
    IsActive     bool      `json:"is_active"`
}

type UserPartial struct {
    Username     OptionalString
    PasswordHash OptionalString
    Role         OptionalString
    APIKey       OptionalString
    IsActive     OptionalBool
    LastLoginAt  OptionalTime
}

type UserSession struct {
    ID           int       `json:"id"`
    UserID       int       `json:"user_id"`
    SessionToken string    `json:"-"`
    ExpiresAt    time.Time `json:"expires_at"`
    CreatedAt    time.Time `json:"created_at"`
    IPAddress    *string   `json:"ip_address,omitempty"`
    UserAgent    *string   `json:"user_agent,omitempty"`
}

// Permission helpers
func (u *User) IsAdmin() bool {
    return u.Role == UserRoleAdmin
}

func (u *User) CanModify() bool {
    return u.Role == UserRoleAdmin
}

func (u *User) CanDelete() bool {
    return u.Role == UserRoleAdmin
}

func (u *User) CanManageUsers() bool {
    return u.Role == UserRoleAdmin
}

func (u *User) CanRunTasks() bool {
    return u.Role == UserRoleAdmin
}

func (u *User) CanModifySettings() bool {
    return u.Role == UserRoleAdmin
}
```

### Repository Interface

```go
// pkg/models/repository_user.go
type UserReader interface {
    Find(ctx context.Context, id int) (*User, error)
    FindByUsername(ctx context.Context, username string) (*User, error)
    FindByAPIKey(ctx context.Context, apiKey string) (*User, error)
    FindAll(ctx context.Context) ([]*User, error)
    Count(ctx context.Context) (int, error)
}

type UserWriter interface {
    Create(ctx context.Context, newUser *User) error
    Update(ctx context.Context, id int, partial UserPartial) (*User, error)
    Destroy(ctx context.Context, id int) error
    UpdateLastLogin(ctx context.Context, id int) error
}

type UserReaderWriter interface {
    UserReader
    UserWriter
}

type SessionReader interface {
    Find(ctx context.Context, token string) (*UserSession, error)
    FindByUser(ctx context.Context, userID int) ([]*UserSession, error)
}

type SessionWriter interface {
    Create(ctx context.Context, session *UserSession) error
    Destroy(ctx context.Context, token string) error
    DestroyByUser(ctx context.Context, userID int) error
    DestroyExpired(ctx context.Context) error
}
```

---

## GraphQL Schema

### `graphql/schema/types/user.graphql`

```graphql
enum UserRole {
  ADMIN
  VIEWER
}

type User {
  id: ID!
  username: String!
  role: UserRole!
  api_key: String
  created_at: Time!
  updated_at: Time!
  last_login_at: Time
  is_active: Boolean!
}

type UserSession {
  id: ID!
  user_id: ID!
  user: User!
  expires_at: Time!
  created_at: Time!
  ip_address: String
  user_agent: String
}

# Input types
input UserCreateInput {
  username: String!
  password: String!
  role: UserRole!
}

input UserUpdateInput {
  id: ID!
  username: String
  password: String
  role: UserRole
  is_active: Boolean
}

# Current user context
type CurrentUser {
  id: ID!
  username: String!
  role: UserRole!
  permissions: UserPermissions!
}

type UserPermissions {
  can_modify: Boolean!
  can_delete: Boolean!
  can_manage_users: Boolean!
  can_run_tasks: Boolean!
  can_modify_settings: Boolean!
}
```

### Schema Extensions

```graphql
# Add to Query
extend type Query {
  # Get current logged-in user
  currentUser: CurrentUser
  
  # Admin only
  findUsers: [User!]! @requireRole(role: ADMIN)
  findUser(id: ID!): User @requireRole(role: ADMIN)
  findUserSessions(user_id: ID): [UserSession!]! @requireRole(role: ADMIN)
}

# Add to Mutation  
extend type Mutation {
  # Admin only - User management
  userCreate(input: UserCreateInput!): User! @requireRole(role: ADMIN)
  userUpdate(input: UserUpdateInput!): User! @requireRole(role: ADMIN)
  userDestroy(id: ID!): Boolean! @requireRole(role: ADMIN)
  userRegenerateAPIKey(id: ID!): String! @requireRole(role: ADMIN)
  
  # Session management
  sessionDestroy(token: String!): Boolean! @requireRole(role: ADMIN)
  sessionDestroyByUser(user_id: ID!): Boolean! @requireRole(role: ADMIN)
  
  # Self-service (any authenticated user)
  changeOwnPassword(current_password: String!, new_password: String!): Boolean!
  regenerateOwnAPIKey: String!
}
```

---

## Authorization Layer

### Directive-Based Authorization

Create a custom directive for role checking:

```go
// internal/api/directives.go
package api

import (
    "context"
    "github.com/99designs/gqlgen/graphql"
    "github.com/stashapp/stash/pkg/models"
)

func RequireRoleDirective(ctx context.Context, obj interface{}, next graphql.Resolver, role models.UserRole) (interface{}, error) {
    user := getCurrentUser(ctx)
    if user == nil {
        return nil, ErrUnauthorized
    }
    
    if role == models.UserRoleAdmin && !user.IsAdmin() {
        return nil, ErrForbidden
    }
    
    return next(ctx)
}
```

### Mutation Protection

All modifying mutations should check permissions:

```go
// internal/api/resolver_mutation_scene.go
func (r *mutationResolver) SceneUpdate(ctx context.Context, input SceneUpdateInput) (*models.Scene, error) {
    user := getCurrentUser(ctx)
    if user == nil || !user.CanModify() {
        return nil, ErrForbidden
    }
    
    // ... existing logic
}
```

### Bulk Protection Strategy

Rather than modifying every resolver, create middleware:

```go
// internal/api/authorization.go
var readOnlyMutations = map[string]bool{
    "changeOwnPassword":     true,
    "regenerateOwnAPIKey":   true,
    "saveFilter":            true,  // personal filters
}

var adminOnlyMutations = map[string]bool{
    "userCreate":            true,
    "userUpdate":            true,
    "userDestroy":           true,
    "configureGeneral":      true,
    "shutdown":              true,
    // ... etc
}

func authorizeMutation(ctx context.Context, operationName string) error {
    user := getCurrentUser(ctx)
    if user == nil {
        return ErrUnauthorized
    }
    
    // Admin can do anything
    if user.IsAdmin() {
        return nil
    }
    
    // Viewer can only access read-only mutations
    if readOnlyMutations[operationName] {
        return nil
    }
    
    // Block everything else for viewers
    return ErrForbidden
}
```

---

## Frontend Implementation

### Context Provider

```tsx
// src/contexts/UserContext.tsx
import React, { createContext, useContext, useMemo } from "react";
import * as GQL from "src/core/generated-graphql";

interface UserContextType {
  user: GQL.CurrentUserFragment | null;
  isAdmin: boolean;
  isViewer: boolean;
  canModify: boolean;
  canDelete: boolean;
  canManageUsers: boolean;
  canRunTasks: boolean;
  canModifySettings: boolean;
  loading: boolean;
}

const UserContext = createContext<UserContextType>({
  user: null,
  isAdmin: false,
  isViewer: false,
  canModify: false,
  canDelete: false,
  canManageUsers: false,
  canRunTasks: false,
  canModifySettings: false,
  loading: true,
});

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data, loading } = GQL.useCurrentUserQuery();
  
  const value = useMemo(() => {
    const user = data?.currentUser ?? null;
    const perms = user?.permissions;
    
    return {
      user,
      isAdmin: user?.role === GQL.UserRole.Admin,
      isViewer: user?.role === GQL.UserRole.Viewer,
      canModify: perms?.can_modify ?? false,
      canDelete: perms?.can_delete ?? false,
      canManageUsers: perms?.can_manage_users ?? false,
      canRunTasks: perms?.can_run_tasks ?? false,
      canModifySettings: perms?.can_modify_settings ?? false,
      loading,
    };
  }, [data, loading]);
  
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

export const useCurrentUser = () => useContext(UserContext);
```

### UI Adaptations

```tsx
// Example: Hide edit button for viewers
import { useCurrentUser } from "src/contexts/UserContext";

const SceneCard: React.FC<Props> = ({ scene }) => {
  const { canModify } = useCurrentUser();
  
  return (
    <Card>
      {/* ... scene content ... */}
      {canModify && (
        <IconButton onClick={onEdit}>
          <EditIcon />
        </IconButton>
      )}
    </Card>
  );
};
```

### Settings Page Protection

```tsx
// src/components/Settings/Settings.tsx
const Settings: React.FC = () => {
  const { canModifySettings, canManageUsers, loading } = useCurrentUser();
  
  if (loading) return <LoadingSpinner />;
  
  if (!canModifySettings && !canManageUsers) {
    return <Navigate to="/" replace />;
  }
  
  return (
    <SettingsLayout>
      {canModifySettings && <GeneralSettings />}
      {canModifySettings && <InterfaceSettings />}
      {canManageUsers && <UserManagement />}
      {/* ... */}
    </SettingsLayout>
  );
};
```

---

## Migration Path

### Phase 1: Database & Models
1. Create migration 84 (users, user_sessions tables)
2. Implement post-migration for legacy credential transfer
3. Add User model and repository
4. Update session management to use database

### Phase 2: Backend Authorization
1. Add GraphQL schema for users
2. Implement user resolvers
3. Add authorization middleware
4. Protect all mutations with role checks
5. Update session store to work with user table

### Phase 3: Frontend Integration
1. Create UserContext provider
2. Add CurrentUser query
3. Update Settings routes
4. Add User Management page
5. Hide/disable UI elements based on role

### Phase 4: Polish & Testing
1. Comprehensive authorization testing
2. UI/UX refinement
3. Documentation
4. Performance optimization

---

## Security Considerations

1. **Password Storage**: bcrypt with cost factor ≥10
2. **Session Tokens**: Cryptographically secure random (32 bytes)
3. **API Keys**: UUID v4 or similar
4. **Session Expiry**: Configurable, default 7 days
5. **Rate Limiting**: Consider adding for login endpoint
6. **Audit Logging**: Log user actions (optional future)

---

## Open Questions

1. **Per-user content visibility?** (Future: libraries/folders per user)
2. **Activity history?** (Track what each user viewed)
3. **Guest/anonymous access?** (View without account)
4. **OAuth/SSO integration?** (Future enhancement)
5. **User quotas?** (Limit concurrent streams per user)

---

## Appendix: Mutation Classification

### Admin-Only Mutations
```
configureGeneral, configureInterface, configureDefaults, configureScraping
configureDLNA, configureUI, generateAPIKey, shutdown, stopAllJobs
migrate, backup, systemStatus
sceneCreate, sceneUpdate, sceneDestroy, sceneMerge, sceneAssign...
performerCreate, performerUpdate, performerDestroy...
studioCreate, studioUpdate, studioDestroy...
tagCreate, tagUpdate, tagDestroy, tagMerge...
galleryCreate, galleryUpdate, galleryDestroy...
imageUpdate, imageDestroy, imagesDestroy...
groupCreate, groupUpdate, groupDestroy...
jobStart (most tasks), jobStop, jobCancel
identify, autoTag, clean, metadataScan, metadataGenerate...
pluginReload, runPluginTask, setPluginsEnabled
scraperReload, setScrapersEnabled
savedFilterCreate, savedFilterUpdate, savedFilterDestroy (shared filters)
renameScenesJob, moveFiles, deletePrimaryFile
```

### Viewer-Allowed Mutations
```
changeOwnPassword
regenerateOwnAPIKey
saveFilter (personal only, future)
updatePlayHistory (future)
```

### Read-Only Queries (All Users)
```
All find* queries
All configuration queries (read)
sceneStreams, parseSceneFilenames
systemStatus, jobQueue (view only)
scraper queries (view results, not modify)
```
