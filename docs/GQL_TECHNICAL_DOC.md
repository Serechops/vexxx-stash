# Stash GraphQL Technical Guide & Migration Lessons

This document outlines the workflow, challenges, and best practices for migrating features to GraphQL in Stash, based on the **Scheduled Tasks** refactor. It is intended to assist developers in future GraphQL iterations.

## 1. The GraphQL Workflow

Stash uses a **Schema-First** approach. The source of truth is `graphql/schema/schema.graphql`.

### Step-by-Step Implementation Cycle

1.  **Define Schema**: Add types, queries, and mutations to `graphql/schema/schema.graphql` (and other `.graphql` files in that dir).
2.  **Generate Go Interfaces**: Run `make generate` (or the specific `gqlgen` command).
    *   This updates `internal/api/generated_models.go` and `internal/api/models.go`.
3.  **Implement Resolvers (Backend)**:
    *   Locate/Create resolver files in `internal/api/` (e.g., `resolver_mutation_scheduled_task.go`).
    *   Implement the methods defined in the generated interfaces.
4.  **Backend Build & Rebuild**:
    *   You **must** rebuild the Go binary (`make build`) for the schema changes to be exposed to the frontend.
5.  **Define Frontend Operations**:
    *   Create `ui/v2.5/graphql/queries/<Feature>.graphql`.
    *   Write your named queries and mutations.
6.  **Generate Frontend Hooks**:
    *   Run `npm run gqlgen --prefix ui/v2.5` (or `npm run seq` to build everything).
    *   This generates TypeScript types and Apollo hooks in `src/core/generated-graphql.tsx`.
7.  **Implement UI**:
    *   Use the generated hooks (`use<Feature>Query`) in your components.

---

## 2. Resolving Build Issues ("Chicken and Egg" Problem)

A common issue encountered during migration is the dependency cycle between code generation and compilation.

### The Problem
`gqlgen` needs to parse the Go code to determine existing types. If your Go code currently has compilation errors (e.g., you deleted an old struct, or you are trying to reference a new struct that hasn't been generated yet), **`make generate` will fail**.

### The Solution
1.  **Write Schema First**: Don't touch Go code yet.
2.  **Generate Models**: Run `make generate`. It should succeed if the schema is valid, even if the implementation is missing (as long as the current Go code compiles).
3.  **Implement Stubs**: Create your new `resolver_*.go` files.
    *   *Tip*: You can look at `internal/api/generated_exec.go` (or similar generated artifacts) or the error message to see exactly what method signature `gqlgen` expects.
4.  **Compile**: Run `go build`.
5.  **Iterate**: Now that types exist, you can add your logic.

**Lesson Learned**: specifically for the Scheduled Tasks refactor, we had to ensure `pkg/scheduler` types were compatible or manually map them. We created specific resolver files (`resolver_mutation_scheduled_task.go`) to isolate the new logic, which kept the codebase clean and made compilation errors easier to track.

---

## 3. Data Validation & Type Safety

Moving from REST to GraphQL shifts where validation happens.

*   **GraphQL Types**: Enforce basic types (Int, Boolean, Enum).
    *   *Example*: `ScheduledTaskType` enum ensures the frontend can only send valid task types.
*   **Resolver Validation**: Business logic validation must happen in the Go resolver.
    *   *Example*: The "Cron Schedule" is a string in GraphQL. In the Go resolver (`resolver_mutation_scheduled_task.go`), we added logic to detect 5-field cron strings and automatically normalize them to the 6-field format required by the backend.
    *   *Takeaway*: Never assume the GQL input is perfectly formatted for the internal service. Normalize it at the resolver boundary that wraps the service.

## 4. Frontend Integration Tips

*   **Generated Hooks**: usage of `useScheduledTasksQuery` replaced manual `fetch` calls. This provides:
    *   **Auto-completion**: TypeScript knows exactly what `data.scheduledTasks` contains.
    *   **Caching**: Apollo Client automatically caches results. **Correction**: You often need to manually call `refetch()` after a mutation if the mutation doesn't automatically update the cache via specific IDs.
*   **Handling "NULL" or "Missing" Data**:
    *   For **instant jobs** (like a quick Scan), the job might start and finish between polling intervals. The UI might never see it in the `JobQueue`.
    *   *Advice*: Rely on the mutation response (which returns a `jobId`) to confirm start, rather than waiting for it to appear in the queue list.

## 5. Directory Structure for Reference

*   `graphql/schema/schema.graphql`: Main definition.
*   `internal/api/`: Backend resolvers (Go).
*   `ui/v2.5/graphql/queries/`: Frontend query definitions.
*   `ui/v2.5/src/core/generated-graphql.tsx`: The single output file for all frontend hooks.

---

**Summary**: The migration to GraphQL successfully resolved persistent `400 Bad Request` errors by enforcing structure and allowed for cleaner, typed frontend code. Future migrations should follow this pattern of **Schema -> Gen -> Stub -> Implement**.

---

## 6. Group Scenes (Virtual Scenes)

To support "Movies" where a single video file contains multiple scenes, we introduced the concept of **Group Scenes** (or Virtual Scenes).

### The Problem
Previously, one File mapped to one Scene (typically). Splitting a 2-hour movie into 10 scenes required file splitting (transcoding/lossy) or complex multi-file management.

### The Solution: Virtual Segments
We added `start_point` and `end_point` (Float, seconds) to the `Scene` entity.

*   **Data Model**: A Scene can now represent a *segment* of its assigned file(s).
*   **Playback**: The `ScenePlayer` must check for these properties. If present, it should:
    *   Seek to `start_point` on load.
    *   (Optional) Stop or loop at `end_point`.
*   **Scraping**: Scrapers can now populate these fields if they identify a scene as part of a movie timestamps.

### GraphQL Updates
*   `Scene`: Added `start_point`, `end_point`.
*   `SceneCreateInput` / `SceneUpdateInput`: Added corresponding fields.

This allows the user to have one 5GB "Movie.mp4" file and create 10 distinct Scene objects (with tags, performers, stats) that all point to that same file but different timestamps.

---

## 7. Database & Model Updates (Adding New Fields)

When a new GraphQL field requires backing by the database (e.g. `has_preview` for filtering), follow this workflow:

### 1- Database Migration
*   Create a new SQL file in `pkg/sqlite/migrations/`. 
    *   **Naming**: `<SequentialNumber>_<Description>.up.sql` (e.g., `78_has_preview.up.sql`).
    *   **Content**: Standard SQL to alter table (e.g., `ALTER TABLE scenes ADD COLUMN has_preview boolean not null default '0';`).
*   **Go Migration**: Generally, avoid complex Go post-migration scripts (`_postmigrate.go`) unless absolutely necessary. Using SQL mechanics is safer.

#### 1.1 - Registering the Migration
*   **Bump Version**: You **MUST** update `appSchemaVersion` in `pkg/sqlite/database.go` to match your new migration number (e.g., `78`). If you don't, the application will think it's up to date and ignore your new file.
*   **Generate Assets**: You **MUST** run `go generate ./cmd/stash` (or `go generate ./...`) to embed the new SQL file into the binary.
    *   *Failure Symptom*: Backend logs "no such column" errors but the migration setup screen never appears.

### 2- Update Go Models
*   **Main Model**: Update the struct in `pkg/models/model_<entity>.go`. Add the field with the JSON tag.
*   **Partial Model**: Update the `Partial` struct (e.g., `ScenePartial`) to include the field using `Optional<Type>` (e.g., `OptionalBool`). This allows partial updates through the API.
*   **Repository Layer**: Update `pkg/sqlite/<entity>.go`:
    *   `fromScene`: Map the model field to the DB struct.
    *   `resolve`: Map the DB struct back to the model.
    *   `fromPartial`: **Crucial** for updates. Map the `Optional` field to the update/insert query helper. If you forget this, your database column will simply never update.

### 3- Populate the Data
*   **New Data**: Update the relevant task handler (e.g., `internal/manager/task_generate_preview.go` or `scan.go`) to set the new field during creation/generation.
*   **Existing Data (Backfilling)**:
    *   Rather than a one-time migration script (which can delay startup and errors are hard to recover from), consider leveraging existing Tasks.
    *   **Example**: For `has_preview`, we updated the "Generate Preview" task. If it runs and detects the file *already exists* (fast scan), it updates the database flag. This allows users to "backfill" by simply running the task on their library without re-encoding everything.

### 4- Filter Support
*   If the field is for filtering, update `pkg/sqlite/<entity>_filter.go`.
*   Replace any temporary stub logic (e.g., `f.addWhere("0")`) with actual column checks (e.g., `f.addWhere("scenes.has_preview = 1")`).
