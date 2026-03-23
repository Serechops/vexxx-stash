# Upstream Integration Progress

This document tracks the integration of upstream Stash features and fixes into the Vexxx fork.

**Last reviewed:** March 22, 2026 — upstream at commit `11f9e7ac5` (v0.30.1-152, pre-v0.31.0)  
**Vexxx schema version:** 85 (custom: playlists, users, segments, trailers, etc.)  
**Upstream schema version:** 85 (diverged at 76 — see Schema Map below)

---

## Schema Divergence Map

Vexxx and upstream schemas diverged at migration 76. The numbers are the same but the content differs — all upstream schema features from 76+ must be ported as Vexxx schema 86+.

| # | Vexxx (current) | Upstream (to port) |
|---|---|----|
| 76 | `scene_segments` ← core Vexxx feature | `studio_custom_fields` → port as 86 |
| 77 | `performance_indexes` | `tag_custom_fields` → port as 87 |
| 78 | `has_preview` | `performer_career_dates` (part 1) → port as 88 |
| 79 | `potential_scenes` | `scene_custom_fields` → port as 89 |
| 80 | `image_optimization_indexes` | `studio_organized` → port as 90 |
| 81 | `stats_cache` | `gallery_custom_fields` → port as 91 |
| 82 | `group_trailer` | `group_custom_fields` → port as 92 |
| 83 | `content_profile` | `image_custom_fields` → port as 93 |
| 84 | `users` | `folder_basename` → port as 94 |
| 85 | `playlists` | `performer_career_dates` (final) → port as 95 |

---

## Integration Strategy

Work is organized into **waves** based on when upstream PRs were reviewed, then into phases by risk/effort within each wave.

### Wave 1 (Dec 17, 2025 – Feb 5, 2026) — PRs up to ~#6560
### Wave 2 (Feb 5, 2026 – Mar 22, 2026) — PRs #6559–#6734

---

## Wave 1 Summary

### Phase 1: Critical Bug Fixes ✅ COMPLETE

---

## Wave 1 — Phase 1: Critical Bug Fixes ✅ COMPLETE

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

## Wave 1 — Phase 2: Backend Features 🔄 IN PROGRESS (8/12 complete)

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

## Wave 1 — Phase 3: Major Features 📋 PENDING

High-value features requiring more extensive integration work:

| # | PR/Commit | Description | Estimated Complexity | Notes |
|---|-----------|-------------|----------------------|-------|
| 1 | #6498 | File scanning refactor | High | Test with Vexxx segments | - Integrated in 'e031466f312ff89caa46a0499daaf59fda11bd6a'
| 2 | #6510 | Add Performer Merge | High | Backend + UI work |
| 3 | #6469 | Troubleshooting mode | Medium | N/A |
| 4 | #6522 | Fix scanning with symlinks | Medium | Path handling |

**Testing Strategy:**
- PR #6498 requires validation with Vexxx's scene segments feature (start/end points)

---

## Wave 1 — Phase 4: Performance & Dependencies 📋 PENDING

Performance optimizations and dependency updates:

| # | PR/Commit | Description | Type |
|---|-----------|-------------|------|
| 1 | #6703 | Replace tag list view with tag list table | Performance |
| 2 | #6452 | Support DLNA subtitle selection | Feature |
| 3 | #6489 | Update dependencies | Maintenance |
| 4 | #6453 | Update build image | Infrastructure |
| 5 | #6444 | Update Chrome CDP version | Infrastructure |
| 6 | #6456 | Update Windows build dependencies | Infrastructure |
| 7 | #6499 | Update Vite and vitest | Frontend Build |

---

## Wave 1 — Phase 5: UI Enhancements 📋 PENDING

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

**Current Phase:** Wave 2 — Phase 8 🔄 IN PROGRESS (1/8 done: Studio `organized`)  
**Progress:** Phase 6 complete; Phase 7 complete (12/14 ported + 2 N/A); Phase 8 schema 87 (`organized`) complete  
**Next Action:** Port #6156 Studio custom fields (schema 88)

---

## Wave 2 — Phase 6: Bug Fixes ✅ COMPLETE

Straightforward fixes from upstream v0.31 development cycle. Low risk, no schema changes.

| # | PR | Description | Status | Notes |
|---|----|----|--------|-------|
| 1 | #6654 | Support string-based fingerprints in hashes filter | ✅ COMPLETE | Backend filter fix |
| 2 | #6651 | Fix infinite re-render loop in gallery image list | ✅ COMPLETE | React bug fix |
| 3 | #6705 | Make gallery/scene association during scan more consistent | ✅ COMPLETE | Scan reliability |
| 4 | #6734 | Fix Tag Modal cutting off | ✅ COMPLETE | Applied to PerformerModal.tsx |
| 5 | #6711 | Replace "Source" with "Combined" in merge dialogs | ✅ COMPLETE | UX clarity |
| 6 | #6697 | Keep tag/entity select input focused after creating a new item | ✅ COMPLETE | UX polish |
| 7 | #6700 | Add option to ignore zip contents during clean | ✅ COMPLETE | Clean task |

---

## Wave 2 — Phase 7: Backend / Non-Schema Features ✅ COMPLETE

Backend features requiring no (or minimal) schema changes.

| # | PR | Description | Complexity | Status |
|---|----|----|--------|-------|
| 1 | #6485 | `.stashignore` support (gitignore-style scan exclusions) | Medium | ✅ COMPLETE |
| 2 | #6701 | Add `{phash}` argument to queryURLParameters | Low | ✅ COMPLETE |
| 3 | #6494 | Add `basename` and `parent_folders` to Folder GraphQL type | Low | ✅ COMPLETE |
| 4 | #6636 | Folder criteria filter for scenes/images/galleries + sidebars | Medium | ✅ COMPLETE |
| 5 | #6641 | Use ffmpeg as fallback when generating phash | Low | ✅ COMPLETE |
| 6 | #6709 | Add StashID GUID consideration into select boxes | Low | ✅ COMPLETE |
| 7 | #6712 | Make hover volume configurable | Low | ✅ COMPLETE |
| 8 | #6637 | Add "From Clipboard" to Set Image | Low | ✅ COMPLETE |
| 9 | #5910 | Performer Merge (Wave 1 Phase 3 carryover) | High | ✅ COMPLETE |
| 9b | #6688 | Add stash IDs to performer merge dialog | Low | ✅ COMPLETE |
| 9a | #6510 | Loop feature for markers + AB prefill | Low | ✅ COMPLETE |
| 10 | #6469 | Troubleshooting mode (Wave 1 Phase 3 carryover) | Medium | ❌ N/A (not needed for Vexxx) |
| 11 | #6522 | Fix scanning with symlinks (Wave 1 Phase 3 carryover) | Medium | ❌ N/A (not in upstream/develop) |
| 12 | #6703 | Replace tag list view with tag list table (upstream commit 208c19a) | Low | ✅ COMPLETE |
| 13 | #6452 | Support DLNA subtitle selection (Wave 1 Phase 4 carryover) | Medium | ❌ N/A (not in upstream/develop) |

---

## Wave 2 — Phase 8: Schema Extensions (Custom Fields, Career Dates) � IN PROGRESS

**⚠ Schema Note:** Vexxx uses 76-86 for its own features. Upstream schemas 76-85 map to Vexxx 87-95. Upstream 84 (folder_basename) was already applied as Vexxx 86 in Phase 7.

### Exact Schema Mapping

| Vexxx Schema | Upstream Schema | PR | Description | Status |
|--------------|-----------------|----|-------------|--------|
| 87 | 80 | #6303 | Studio `organized` flag | ✅ COMPLETE |
| 88 | 76 | #6156 | Studio custom fields | 📋 PENDING |
| 89 | 77 | #6546 | Tag custom fields | 📋 PENDING |
| 90 | 79 | #6584 | Scene custom fields | 📋 PENDING |
| 91 | 81 | #6592 | Gallery custom fields | 📋 PENDING |
| 92 | 82 | #6596 | Group custom fields | 📋 PENDING |
| 93 | 83 | #6598 | Image custom fields | 📋 PENDING |
| 94 | 78+85 | #6682 | Performer career dates (combined) | 📋 PENDING |

**Frontend for custom fields:** PR #6601 adds the full frontend custom field UI for all types (Phase 9 item #2).

---

## Wave 2 — Phase 9: UI Features 📋 PENDING

UI features compatible with Vexxx's MUI v7 architecture. Most need adaptation rather than direct port.

| # | PR | Description | MUI Effort | Priority |
|---|----|----|--------|------|
| 1 | #6559 | Tags Tagger (hierarchy-aware tagger) | Medium | High |
| 2 | #6601 | Custom Fields frontend (all entity types) | High | High (with Phase 8) |
| 3 | #6565 | Is-missing filter options across all entity types | Low | Medium |
| 4 | #6588 | Custom sprite generation | Medium | Medium |
| 5 | #6621 | Selective generate | Low-Medium | Medium |
| 6 | #6603 | Sidebar for scene markers list | Medium | Medium |
| 7 | #6607 | Sidebar for images list | Medium | Medium |
| 8 | #6610 | Sidebar for tag list | Medium | Medium |
| 9 | #6642 | Sort performers/studios by scenes file size | Low | Low |
| 10 | #6663 | Show scene resolution/duration in tagger | Low | Low |
| 11 | #6713 | Make tagger views consistent | Low | Low |
| 12 | #6503 | Update marker carousel for scenes (Wave 1 Phase 5) | Medium | Medium |
| 13 | #6483 | Multi-scene zoom slider (Wave 1 Phase 5) | Low | Medium |
| 14 | #6461 | Scene chapter editor (Wave 1 Phase 5) | High | Low |
| 15 | #6460 | Marker list item keyboard controls (Wave 1 Phase 5) | Low | Low |

---

## v0.30 Features Confirmation Checklist 📋

These shipped in upstream v0.29.0-v0.30.1. Verify Vexxx includes them:

| Feature | PR | Status |
|---------|-----|--------|
| SFW content mode | #6262 | ❓ Verify |
| Trash location for deleted files | #6237 | ❓ Verify |
| AVIF image support | #6288 | ✅ Already present (noted in previous session) |
| Screen Wake Lock during playback | #6331 | ❓ Verify |
| Media Session API integration | #6298 | ❓ Verify |
| o-count on Studio/Group cards | #5982/#6122 | ❓ Verify |
| Performer age slider in scene filter | #6267 | ❓ Verify |
| Markers option on front page | #6065 | ❓ Verify |
| Partial dates (year-only, month/year) | #6359 | ❓ Verify |
| Multiple Studio URLs | #6223 | ❓ Verify |

---

## Build Verification

After each PR integration:
```bash
# Verify Go compilation
go build ./...

# Regenerate GraphQL code (if schema changed)
make generate

# Build full binary
make stash

# Frontend (if UI changed)
cd ui/v2.5 && pnpm run generate && pnpm run build
```

---

## Preserved Vexxx Features

All integrations must maintain compatibility with:

- ✅ Scene segments (start_point/end_point) — schema 76
- ✅ MUI v7 UI (no React-Bootstrap)
- ✅ Mixed-media Playlists — schema 85
- ✅ Users/auth system — schema 84
- ✅ Group trailers — schema 82
- ✅ Content profiles — schema 83
- ✅ Potential scenes / auto-identify — schema 79
- ✅ Concurrent task system (4 parallel tasks)
- ✅ Scheduled tasks with cron expressions
- ✅ Global search modal (Cmd+K)
- ✅ Stats cache — schema 81

---

## Session History

### Session 1: Image Phashing (Feb 2026)
- Implemented PR #6497 (56 files) — phash for images
- Fixed issue #6535 (image format decoders)

### Session 2: Phase 1 + Phase 2 Start (Feb 2026)
- Completed Phase 1 (8 bug fixes — 7 already present, 1 applied)
- PR #6401 StashID filtering, PR #6514 duplicate aliases
- Commits: `ac4ed4c`, `6d2b9f3`

### Session 3: Phase 2 Completion (Feb 2026)
- PR #6442 (Gallery generate) — commit `1f297fb`
- PR #6437 (Destroy file DB entries) — commit `6818e93`
- PR #6542 (Cover merge bugfix) — commit `d1df5bc`
- Phase 2 deferred: PR #6156 (studio custom fields — large migration)

### Session 4: Wave 2 Review + Phase 6 Start (Mar 22, 2026)
- Reviewed upstream through v0.31.0-dev (commit `11f9e7ac5`)
- Identified 40+ new PRs across phases 6-9
- Updated schema divergence map
- Starting Wave 2 Phase 6 bug fixes

