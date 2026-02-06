# Upstream Integration Progress

This document tracks the integration of upstream Stash features and fixes into the Vexxx fork. The integration focuses on valuable features from commits after December 17, 2025 through February 5, 2026.

## Integration Strategy

The integration is organized into 5 phases, prioritizing backend features first to avoid conflicts with Vexxx's MUI v7 migration:

1. **Phase 1**: Critical Bug Fixes (8 commits) ✅ COMPLETE
2. **Phase 2**: Backend Features (12 commits) 🔄 IN PROGRESS (5/12 complete)
3. **Phase 3**: Major Features (4 commits) 📋 PENDING
4. **Phase 4**: Performance & Dependencies (7 commits) 📋 PENDING  
5. **Phase 5**: UI Enhancements (9 commits) 📋 PENDING

---

## Phase 1: Critical Bug Fixes ✅ COMPLETE

All 8 bug fixes from Phase 1 have been addressed:

| # | PR/Commit | Description | Status | Notes |
|---|-----------|-------------|--------|-------|
| 1 | #6493 | Fix duplicate file detection in zip archives | ✅ FIXED | Applied fix, verified compilation |
| 2 | #6535 | Image phashing fails on certain formats | ✅ FIXED | Added missing image format decoders |
| 3 | #6502 | Marker wall filter crash | ✅ ALREADY PRESENT | Vexxx already includes this fix |
| 4 | #6484 | Cover image association edge case | ✅ ALREADY PRESENT | Vexxx already includes this fix |
| 5 | #6465 | Scene wall page number bug | ✅ ALREADY PRESENT | Vexxx already includes this fix |
| 6 | #6451 | Performer disambiguation UI fix | ✅ ALREADY PRESENT | Vexxx already includes this fix |
| 7 | #6440 | File reassign edge case | ✅ ALREADY PRESENT | Vexxx already includes this fix |
| 8 | #6435 | Package path URL handling | ✅ ALREADY PRESENT | Vexxx already includes this fix |

**Commit References:**
- Initial checkpoint: `ac4ed4c` - "Integrate upstream features: image phashing, StashID filtering, and partial alias deduplication"
- Image format fix: Included in image phashing implementation (PR #6497)
- Zip file fix: Applied in checkpoint commit

---

## Phase 2: Backend Features 🔄 IN PROGRESS

Backend-focused PRs to avoid MUI v7 conflicts. Database schema changes deferred for later consideration.

### Completed (8/12)

| # | PR | Description | Status | Files Changed | Commit |
|---|-------|-------------|--------|---------------|--------|
| 1 | #6401 | Add StashID filtering to entities | ✅ COMPLETE | 15 files | `ac4ed4c` |
| 2 | #6403 | Add Tag StashID filter | ✅ COMPLETE | Included in #6401 | `ac4ed4c` |
| 3 | #6402 | Support tag linking via frontend | ✅ COMPLETE | Already present | N/A |
| 4 | #6514 | Auto-remove duplicate aliases | ✅ COMPLETE | 6 files | `6d2b9f3` |
| 5 | #6442 | Add Generate Task to Galleries | ✅ COMPLETE | 6 files | `1f297fb` |
| 6 | #6437 | Add Interfaces to Destroy File DB Entries | ✅ COMPLETE | 18 files | `6818e93` |
| 7 | #6542 | Add cover check (bugfix) | ✅ COMPLETE | 1 file | `d1df5bc` |
| 8 | #6433 | Allow Marker Screenshot Generation | ✅ COMPLETE | Already present | N/A |

**Key Implementation Details:**

**PR #6401 - StashID Filtering:**
- Added `StashIDsCriterionInput` to GraphQL schema with array support and OR/AND logic
- Implemented StashID filtering across performers, scenes, studios, and tags
- Updated criterion handlers and filter classes for all entities
- Files: `filters.graphql`, `stash_ids.go`, entity-specific filters

**PR #6514 - Duplicate Aliases:**
- Added `UniqueExcludeFold` utility for case-insensitive deduplication
- Applied to performer, studio, and tag mutation resolvers
- Backend complete, UI already handles duplicates client-side
- Files: `string_collections.go`, resolver mutation files, GraphQL docs

**PR #6442 - Gallery Generate:**
- Added `galleryIDs` field to `GenerateMetadataInput` in GraphQL schema
- Updated `task_generate.go` to load images from galleries and queue generation
- Modified `GenerateDialog.tsx` to support gallery type alongside scene/image
- Updated `GenerateOptions.tsx` to show image options for galleries
- Integrated Generate menu item in Gallery detail page and list toolbar
- Files: `metadata.graphql`, `task_generate.go`, `GenerateDialog.tsx`, `GenerateOptions.tsx`, `Gallery.tsx`, `GalleryList.tsx`

**PR #6437 - Destroy File DB Entries:**
- Added `destroyFiles` GraphQL mutation and `destroy_file_entry` fields to destroy inputs
- New service methods to destroy database entries while preserving filesystem files
- Separation of filesystem deletion from database cleanup
- Safety checks: Prevent destroying primary files, check for shared files
- Useful for cleaning orphaned database entries or library reorganization
- Files: GraphQL schemas (schema.graphql, gallery/image/scene.graphql), resolvers (mutation_file/gallery/image/scene.go), service implementations (gallery/image/scene delete.go), models, repository interfaces

**PR #6542 - Cover Merge Bugfix:**
- Fixed bug where scene merges would remove covers if no new cover provided
- Added conditional check: only update cover if `len(coverImageData) > 0`
- Prevents accidental removal of existing covers during merge operations
- Single file change: `resolver_mutation_scene.go`

**PR #6433 - Marker Screenshot Generation** (Already Present in Vexxx):
- Marker image and screenshot generation now independent of video generation
- Added VideoPreview, ImagePreview, Screenshot flags to marker generation tasks
- Removed disabled state from UI options - all three types can be generated independently
- Already implemented in Vexxx fork in `task_generate.go` and `task_generate_markers.go`

### Already Present in Vexxx (3)

| # | PR | Description | Implementation |
|---|-------|-------------|----------------|
| 9 | #6448 | Update Tray Notification to Include Port | System tray already shows "Vexxx is Running on port X" in `systray_nonlinux.go` |
| 10 | #6443 | Hide Already Installed Plugins or Scrapers | Package managers already filter using `installedPackageIds` in `PluginPackageManager.tsx` and `ScraperPackageManager.tsx` |
| 11 | #6447 | Autopopulate Stash-ID Search Box | StashBoxIDSearchModal already accepts `initialQuery` parameter, passed from all edit panels (Performer/Scene/Studio/Tag) |

**Note:** Vexxx fork is exceptionally well-maintained with many upstream features proactively integrated.

### Deferred

| # | PR | Description | Status | Reason |
|---|-------|-------------|--------|--------|
| 12 | #6156 | Studio custom fields (backend) | ⏸️ DEFERRED | 32 files (+796/-79), requires DB migration - evaluating for dedicated session |

### Phase 2 Summary

- **Completed:** 8/12 PRs (5 implemented, 3 already present)
- **Remaining:** 1 PR (#6156 - large DB migration)
- **Integration Status:** Clean - no MUI v7 conflicts, all backend features compile successfully
- **Commits:** `ac4ed4c`, `6d2b9f3`, `1f297fb`, `6818e93`, `d1df5bc`

---

## Phase 3: Major Features 📋 PENDING

High-value features requiring more extensive integration work:

| # | PR/Commit | Description | Estimated Complexity | Notes |
|---|-----------|-------------|----------------------|-------|
| 1 | #6498 | File scanning refactor | High | Test with Vexxx segments | - Integrated in 'e031466f312ff89caa46a0499daaf59fda11bd6a'
| 2 | #6510 | Add Performer Merge | High | Backend + UI work |
| 3 | #6469 | Troubleshooting mode | Medium | Diagnostic features |
| 4 | #6522 | Fix scanning with symlinks | Medium | Path handling |

**Testing Strategy:**
- PR #6498 requires validation with Vexxx's scene segments feature (start/end points)

---

## Phase 4: Performance & Dependencies 📋 PENDING

Performance optimizations and dependency updates:

| # | PR/Commit | Description | Type |
|---|-----------|-------------|------|
| 1 | #6539 | Optimize tag list generation | Performance |
| 2 | #6452 | Support DLNA subtitle selection | Feature |
| 3 | #6489 | Update dependencies | Maintenance |
| 4 | #6453 | Update build image | Infrastructure |
| 5 | #6444 | Update Chrome CDP version | Infrastructure |
| 6 | #6456 | Update Windows build dependencies | Infrastructure |
| 7 | #6499 | Update Vite and vitest | Frontend Build |

---

## Phase 5: UI Enhancements 📋 PENDING

UI features requiring adaptation from React-Bootstrap to MUI v7:

| # | PR/Commit | Description | MUI Conversion Required |
|---|-----------|-------------|------------------------|
| 1 | #6503 | Update marker carousel for scenes | Yes - carousel components |
| 2 | #6483 | Multi-scene zoom slider | Yes - slider components |
| 3 | #6475 | Performer birthdate clarification | Yes - form components |
| 4 | #6473 | Gallery select dialog improvements | Yes - dialog components |
| 5 | #6471 | Fix movie filter counts | Minor - filtering logic |
| 6 | #6461 | Scene chapter editor | Yes - complex form UI |
| 7 | #6460 | Marker list item keyboard controls | Yes - list components |
| 8 | #6450 | Grid view for file list | Yes - grid layout |
| 9 | ~~#6427~~ | ~~Plugin API getSystemStatus~~ | N/A - Moot for Vexxx |

**Strategy:**
- Convert React-Bootstrap patterns to MUI v7 equivalents
- Maintain Vexxx's existing MUI theme and component patterns
- Skip plugin API changes (Vexxx uses different plugin system)

---

## Major Features Already Integrated

### Image Phashing (PR #6497)
**Status:** ✅ COMPLETE  
**Commit:** `ac4ed4c`  
**Files Changed:** 56 files  
**Implementation:**
- Full perceptual hash (phash) system for duplicate image detection
- Backend: GraphQL schema updates, task generation, database models
- Frontend: Search UI, duplicate detection dialog, distance threshold controls
- Tested: Compilation verified, phash generation functional

**Bug Fix:** Issue #6535 (AVIF/JPEG XL/WebP support)
- Added missing image format decoders  
- WebP fully supported via `golang.org/x/image/webp`
- AVIF and JPEG XL remain unsupported (no stdlib decoders available)

---

## Build Verification

After each PR integration:
```bash
# Verify Go compilation
go build ./...

# Regenerate GraphQL code (if schema changed)
make generate

# Build full binary periodically
make stash
```

**Compilation Status:**
- ✅ Phase 1 fixes: All compile successfully
- ✅ PR #6401 (StashID): Compiles successfully
- ✅ PR #6514 (Aliases): Compiles successfully
- ✅ PR #6442 (Gallery Generate): Compiles successfully

---

## Preserved Vexxx Features

All integrations maintain compatibility with Vexxx-specific features:

- ✅ MUI v7 migration (no React-Bootstrap dependencies)
- ✅ Scene segments with start/end points
- ✅ Missing scenes detection + StashDB integration
- ✅ Concurrent task system (4 parallel tasks)
- ✅ Scheduled tasks with cron expressions
- ✅ Global search (Cmd+K modal)
- ✅ Custom performer filtering with studio hierarchies

---

## Session History

### Session 1: Image Phashing
- Implemented PR #6497 (56 files, 10 tasks)
- Fixed issue #6535 (image format decoders)
- Created upstream commit analysis (70 commits)
- Created integration plan (this document)

### Session 2: Phase 1 + Phase 2 Start
- Completed Phase 1 (8 bug fixes - 7 already present, 1 applied)
- Completed PR #6401 (StashID filtering - 15 files)
- Completed PR #6514 (Duplicate aliases - 6 files)
- Created checkpoint commit: `ac4ed4c`
- Created second checkpoint: `6d2b9f3`

### Session 3: Gallery Generate + Phase 2 Completion
- Completed PR #6442 (Gallery generate - 6 files) - Commit: `1f297fb`
- Completed PR #6437 (Destroy file DB entries - 18 files) - Commit: `6818e93`
- Completed PR #6542 (Cover merge bugfix - 1 file) - Commit: `d1df5bc`
- Verified PRs #6433, #6448, #6443, #6447 already present in Vexxx fork
- Phase 2 status: 8/12 complete (5 implemented, 3 already present)
- Deferred PR #6156 (large DB migration - 32 files) for evaluation

---

## Next Session Starting Point

**Current Phase:** Phase 2 (Backend Features) - Nearly Complete  
**Progress:** 8/12 complete (5 implemented + 3 already present), 1 deferred  
**Next Decision:** Evaluate PR #6156 (Studio Custom Fields) or begin Phase 3

**Option A - Complete Phase 2:**
```bash
# Assess PR #6156 complexity
curl https://github.com/stashapp/stash/pull/6156/files
# 32 files (+796/-79), DB migration required
# Check if already present in Vexxx fork
grep -r "custom_fields" pkg/sqlite/migrations/
```

**Option B - Begin Phase 3 (Major Features):**
Phase 3 includes 4 high-value PRs:
- #6477: Performer merge improvements
- #6560: Troubleshooting mode
- #6596: File scanning refactor (test with Vexxx segments!)
- #6654: Symlink support

User note: "Don't worry about setting up test db, already have them"

---

## Notes

- Integration follows upstream commits from Dec 17, 2025 - Feb 5, 2026
- ~50 valuable commits identified from ~70 total upstream commits
- Backend changes prioritized to minimize UI conflicts
- Database migrations deferred to dedicated sessions
- All changes preserve Vexxx customizations and features
