# Vexxx (Stash Fork) - AI Coding Instructions

> **Model Target**: Claude 4.x (Sonnet 4.5, Opus 4.5, Haiku 4.5)
>
> This document provides comprehensive context for Claude-based AI assistants working on the Vexxx codebase. It follows Claude 4 prompting best practices for precise instruction following and effective agentic coding.

---

## Project Overview

Vexxx is a **fork of Stash**, a self-hosted web application written in **Go** (backend) and **React/TypeScript** (frontend). It organizes and serves media collections with advanced metadata management, scraping capabilities, and extensible plugin architecture.

### Core Technologies

| Layer | Technology | Notes |
|-------|------------|-------|
| Backend | Go 1.24+ | Chi router, SQLite, GraphQL (gqlgen) |
| Frontend | React 18 + TypeScript | Material UI, Apollo Client, Vite |
| Database | SQLite | Embedded, migrations via golang-migrate |
| API | GraphQL | Schema-first with gqlgen code generation |
| Media Processing | FFmpeg | Transcoding, thumbnails, sprites |

---

## Architecture Overview

<architecture_context>
Vexxx follows a clean separation between API layer, business logic, and data access:

```
├── cmd/stash/           # Application entrypoint
├── graphql/schema/      # GraphQL schema definitions (source of truth)
├── internal/
│   ├── api/             # GraphQL resolvers, HTTP routes, server
│   ├── manager/         # Core business logic, system status
│   ├── autotag/         # Auto-tagging engine
│   └── identify/        # Content identification
├── pkg/
│   ├── models/          # Domain models and interfaces
│   ├── sqlite/          # SQLite repository implementations
│   ├── scraper/         # Scraping framework
│   ├── plugin/          # Plugin system
│   └── ffmpeg/          # FFmpeg wrapper
└── ui/v2.5/
    ├── graphql/         # Frontend GraphQL operations
    └── src/
        ├── components/  # React components
        ├── core/        # Generated GraphQL hooks
        └── hooks/       # Custom React hooks
```
</architecture_context>

---

## GraphQL Development Workflow

<graphql_workflow>
Vexxx uses a **Schema-First** approach. The GraphQL schema is the source of truth.

### Implementation Cycle

1. **Define Schema**: Add types/queries/mutations to `graphql/schema/schema.graphql` or type-specific files in `graphql/schema/types/`
2. **Generate Go Code**: Run `make generate` to update `internal/api/generated_models.go`
3. **Implement Resolvers**: Create resolver in `internal/api/resolver_*.go`
4. **Rebuild Backend**: Run `make stash` - schema changes require binary rebuild
5. **Define Frontend Operations**: Create `.graphql` file in `ui/v2.5/graphql/queries/`
6. **Generate Frontend Hooks**: Run `pnpm run generate` in `ui/v2.5/`
7. **Use in Components**: Import from `src/core/generated-graphql`

### Schema Locations

- Main schema: `graphql/schema/schema.graphql`
- Type definitions: `graphql/schema/types/*.graphql`
- Frontend queries: `ui/v2.5/graphql/queries/**/*.graphql`
- Frontend mutations: `ui/v2.5/graphql/mutations/**/*.graphql`
</graphql_workflow>

---

## Database Patterns

<database_patterns>
### SQLite with golang-migrate

- Schema version tracked in `pkg/sqlite/database.go` (`appSchemaVersion`)
- Migrations embedded via `//go:embed migrations/*.sql`
- Repository pattern: interfaces in `pkg/models/`, implementations in `pkg/sqlite/`

### Key Tables

| Entity | Model File | Repository |
|--------|-----------|------------|
| Scene | `pkg/models/model_scene.go` | `pkg/sqlite/scene.go` |
| Performer | `pkg/models/model_performer.go` | `pkg/sqlite/performer.go` |
| Studio | `pkg/models/model_studio.go` | `pkg/sqlite/studio.go` |
| Tag | `pkg/models/model_tag.go` | `pkg/sqlite/tag.go` |
| Gallery | `pkg/models/model_gallery.go` | `pkg/sqlite/gallery.go` |

### Transaction Pattern

```go
// Use txn.WithDatabase for transactional operations
err := txn.WithDatabase(ctx, r.repository, func(ctx context.Context) error {
    // All operations here are transactional
    return nil
})
```
</database_patterns>

---

## Frontend Architecture

<frontend_architecture>
### Component Organization

```
ui/v2.5/src/components/
├── Scenes/           # Scene list, detail, edit views
├── Performers/       # Performer management
├── Settings/         # Configuration UI
├── ScenePlayer/      # Video player with segment support
├── Tagger/           # Metadata identification
├── Shared/           # Reusable components
└── FrontPage/        # Landing page with carousels
```

### State Management

- **Apollo Client**: Primary data fetching via generated hooks
- **React Context**: Auth state, theme, read-only mode
- **Local State**: Component-specific with useState/useReducer

### Generated Hooks Pattern

```typescript
// Use generated hooks from core/generated-graphql
import * as GQL from "src/core/generated-graphql";

// Queries
const { data, loading } = GQL.useFindScenesQuery({ variables: { filter } });

// Mutations
const [updateScene] = GQL.useSceneUpdateMutation();

// Lazy queries for on-demand fetching
const [validatePath] = GQL.useValidateLibraryPathLazyQuery();
```

### Internationalization

- Locale files in `ui/v2.5/src/locales/`
- Primary: `en-GB.json`
- Use `<FormattedMessage id="key.path" />` or `intl.formatMessage()`
</frontend_architecture>

---

## Vexxx-Specific Features

<vexxx_features>
### Virtual Scenes (Segments)

Scenes can have `start_point` and `end_point` (Float, seconds) to represent segments of a video file without file duplication.

```go
// Scene model includes segment bounds
type Scene struct {
    // ...
    StartPoint *float64 `json:"start_point"`
    EndPoint   *float64 `json:"end_point"`
}
```

### Docker Detection

The application detects Docker environment for path validation:

```go
// manager.go
func isDockerized() bool {
    // Checks /.dockerenv, /proc/self/cgroup, DOCKER_CONTAINER env
}
```

### Scheduled Tasks

Cron-based task scheduling with granular control over library maintenance operations.

### Resource Monitoring

Real-time memory and goroutine metrics available in the Task Dashboard.
</vexxx_features>

---

## Code Style Guidelines

<code_style>
### Go Backend

- Use `golangci-lint` for linting
- Follow standard Go formatting (`gofmt`)
- Error handling: return errors up the stack, wrap with context
- Prefer table-driven tests
- Use `context.Context` for cancellation and timeouts

### TypeScript Frontend

- Strict TypeScript mode enabled
- Functional components with hooks
- Use Material UI components consistently
- Format with Prettier via `pnpm run format`

### Resolver Naming Convention

```
resolver_query_<entity>.go      # Query resolvers
resolver_mutation_<entity>.go   # Mutation resolvers
resolver_model_<entity>.go      # Field resolvers
```
</code_style>

---

## Build Commands Reference

<build_commands>
```bash
# Backend
make pre-ui          # Install UI dependencies (first time)
make generate        # Generate GraphQL Go code
make stash           # Build backend binary
make build-release   # Production build

# Frontend (from ui/v2.5/)
pnpm install         # Install dependencies
pnpm run generate    # Generate GraphQL TypeScript
pnpm run start       # Development server
pnpm run build       # Production build

# Full Development
make server-start    # Run backend dev server
make ui-start        # Run frontend dev server

# Testing
make validate        # Run all tests and checks
make lint            # Go linting
make it              # Integration tests
```
</build_commands>

---

## Claude-Specific Guidance

<claude_guidance>
### Effective Prompting Patterns

Following Claude 4.x best practices for this codebase:

#### Be Explicit About Intent

When working on Vexxx, explicitly state whether you want:
- Research/exploration only
- Implementation with file changes
- Schema changes (requires full generation cycle)

#### Code Exploration First

```
<investigate_before_answering>
Always read and understand relevant files before proposing code edits. 
For GraphQL changes, check both schema files AND existing resolvers.
For frontend changes, verify the generated hooks exist before using them.
</investigate_before_answering>
```

#### Parallel Operations

When making related changes across multiple files, batch them:
- Schema + resolver + frontend query can be planned together
- Use multi-file edits for related changes

#### State Tracking for Long Tasks

For multi-step migrations or refactors:
1. Define the complete scope upfront
2. Track progress in structured format
3. Commit incrementally
4. Verify each step compiles before proceeding

### Common Pitfalls to Avoid

<avoid_pitfalls>
1. **GraphQL Generation Order**: Schema must be valid before `make generate` succeeds
2. **Frontend Hook Availability**: Hooks don't exist until `pnpm run generate` completes
3. **Backend Binary Rebuild**: Schema changes require `make stash` rebuild
4. **Transaction Boundaries**: Database operations must use proper transaction context
5. **Docker Path Validation**: Host paths don't work in containers without volume mounts
</avoid_pitfalls>

### Minimal Solutions

```
<avoid_overengineering>
Keep solutions focused on the immediate task. This codebase values:
- Minimal dependencies
- Portable, offline-capable design
- Features as plugins when possible
- Clean separation of concerns

Don't add unnecessary abstractions, error handling for impossible scenarios,
or backwards-compatibility shims when direct changes are acceptable.
</avoid_overengineering>
```
</claude_guidance>

---

## Testing Patterns

<testing_patterns>
### Backend Tests

```go
// Table-driven tests
func TestSomething(t *testing.T) {
    tests := []struct {
        name     string
        input    string
        expected string
    }{
        {"case1", "input1", "expected1"},
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            // test logic
        })
    }
}
```

### Frontend Tests

- Jest for unit tests
- React Testing Library for component tests
- Located alongside components or in `__tests__/` directories

### Validation Commands

```bash
make validate        # Full validation suite
make validate-ui     # Frontend only
pnpm run test        # Jest tests (from ui/v2.5/)
```
</testing_patterns>

---

## API Endpoints Reference

<api_endpoints>
### GraphQL

- Main endpoint: `/graphql`
- GraphQL Playground: `/playground` (development)

### REST Routes

Located in `internal/api/routes_*.go`:

- `/scene/{id}/stream` - Video streaming
- `/scene/{id}/screenshot` - Scene thumbnails
- `/performer/{id}/image` - Performer images
- `/plugin/{id}/*` - Plugin assets
- `/downloads/*` - File downloads

### Static Assets

- Frontend: Served from embedded `ui.go` or development server
- Generated content: `/generated/` (thumbnails, sprites, transcodes)
</api_endpoints>

---

## Plugin Development

<plugin_development>
Vexxx supports JavaScript and Python plugins:

```
~/.stash/plugins/
├── my-plugin/
│   ├── my-plugin.yml    # Plugin manifest
│   ├── my-plugin.js     # JavaScript plugin
│   └── my-plugin.py     # Or Python plugin
```

### Plugin Capabilities

- Custom scraper logic
- Task hooks (post-scan, post-scrape)
- UI injection points
- GraphQL API access

### Plugin API

Plugins receive context and can call back to the GraphQL API:
```javascript
function main() {
    var result = callGraphQL("query { configuration { general { stashes { path } } } }");
    // Process result
}
```
</plugin_development>

---

## Troubleshooting Common Issues

<troubleshooting>
### "make generate" Fails

1. Ensure Go code compiles: `go build ./...`
2. Check schema syntax in `.graphql` files
3. Verify gqlgen.yml configuration

### Frontend Hooks Not Found

1. Run `pnpm run generate` in `ui/v2.5/`
2. Check that backend is running with latest schema
3. Verify query/mutation file is in correct directory

### Docker Path Issues

Paths must be container paths, not host paths:
```bash
# Mount host directory when starting container
docker run -v /host/path:/data/videos ...
# Then use /data/videos in Stash configuration
```

### Database Migration Errors

1. Check `appSchemaVersion` in `pkg/sqlite/database.go`
2. Backup database before migration
3. Migration files in `pkg/sqlite/migrations/`
</troubleshooting>

---

## Quick Reference

<quick_reference>
| Task | Command |
|------|---------|
| Full rebuild | `make clean && make` |
| Dev backend | `make server-start` |
| Dev frontend | `make ui-start` |
| Generate GraphQL | `make generate` |
| Generate frontend | `cd ui/v2.5 && pnpm run generate` |
| Lint Go | `make lint` |
| Format frontend | `cd ui/v2.5 && pnpm run format` |
| Run tests | `make validate` |

### Key Files

| Purpose | Path |
|---------|------|
| Main entrypoint | `cmd/stash/main.go` |
| GraphQL schema | `graphql/schema/schema.graphql` |
| Manager (core logic) | `internal/manager/manager.go` |
| API server | `internal/api/server.go` |
| Frontend app | `ui/v2.5/src/App.tsx` |
| Locale strings | `ui/v2.5/src/locales/en-GB.json` |
</quick_reference>

---

## Contributing

Before submitting changes:

1. Run `make validate` to ensure all tests pass
2. Follow existing code patterns and naming conventions
3. Update GraphQL schema documentation comments
4. Add locale strings for any new UI text
5. Consider plugin extensibility for large features

For complex features, discuss in issues before implementation to align with project goals of minimalism and extensibility.
