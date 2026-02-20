# VEXXX Changelog

Commits since 3b2f512b85be85f0d4a18c2507950438834563ca (exclusive) up to HEAD

### feat: update README with Vexxx branding and enhanced feature descriptions (c1c09c7)


==END==

### feat: update installation instructions and add Patreon link for support (451eb8e)

### fix: correct typo in installation instructions (32d5a4a)

### chore: remove build and badge links from README (898f688)

### feat(ui): Comprehensive MUI v7 styling overhaul with responsive design and polish (0173d72)

Massively enhanced the frontend with MUI v7 best practices, modern animations,
responsive design, and glassmorphism effects across all major components.

Theme Enhancements (theme.ts):
- Add responsive typography with responsiveFontSizes() for better mobile scaling
- Implement transitions system (fast/normal/slow/spring) for consistent animations
- Add shadow system (glow/card/elevated) with alpha-based variants
- Add 30+ component overrides with unified transitions and hover states
- Enhance MuiPaper, MuiButton, MuiIconButton, MuiChip with elevation and glow
- Add glassmorphism to MuiDialog, MuiDrawer, MuiMenu with backdrop blur
- Improve MuiMenuItem, MuiTooltip, MuiSwitch, MuiSlider styling
- Add custom scrollbar styling and focus-visible accessibility
- Export colors, transitions, shadows, alpha for component reuse

New Theme Utilities (useThemeUtils.ts):
- Add useBreakpoints() hook for responsive logic (isMobile, isTablet, etc.)
- Add useTouchDevice() hook for touch detection
- Provide sxPatterns for glass, cardHover, truncate, lineClamp, center
- Add animation keyframes (fadeIn, slideUp, pulse, shimmer)
- Add spacing and zIndex constants for consistent values

Component Polish:
- LoadingIndicator: Add pulse and float keyframe animations, glow ring effect
- Carousel: Add drag-to-scroll, gradient fade indicators, mobile dots, tablet support
- Modal: Add SlideTransition, fullScreen on mobile, glassmorphism backdrop blur
- GridCard: Convert to sx patterns, add alpha-based hover states, glow progress bar
- MainNavbar: Add SwipeableDrawer, glassmorphism AppBar, alpha-based active states

Skeleton Loaders (All 7 converted to MUI):
- SceneCard, PerformerCard, StudioCard, TagCard: Use MUI Skeleton with wave animation
- GalleryCard, GroupCard, ImageCard: Add gradient overlays and proper aspect ratios
- Remove Tailwind classes in favor of sx prop patterns
- Add proper placeholder structure (badges, icons, text) for better perceived loading

Key Patterns Applied:
- sx prop over className for all styling
- alpha() utility for transparent colors
- Responsive values with breakpoint objects {xs, sm, md, lg, xl}
- Theme tokens over hardcoded values
- Consistent transitions using theme.transitions
- Wave animation on all Skeleton components
- Glassmorphism effects (alpha + backdrop-filter)

This update brings the frontend in line with MUI v7 best practices while adding
significant polish and modern visual effects. All changes maintain accessibility
and improve the mobile experience.

### feat: Replace star rating system with horizontal bar gauge UI (0806b82)

Replaced the entire application's rating UI with a new horizontal bar gauge
design that provides better visual feedback and improved UX. The new system
includes fullscreen rating capability in the video player.

Key changes:
- Created RatingBar component as universal rating UI (replaces RatingStars/RatingNumber)
- Added video.js plugin for fullscreen rating overlay (rating-button.tsx)
- Updated RatingSystem to exclusively use RatingBar
- Modified RatingFilter and SceneListTable to use new compact mode
- Added fullscreen-only rating gauge with mouse activity detection

Features:
- Horizontal layout with value beside bar (better inline fit)
- Backend-compatible rating100 conversion (1-100 scale)
- Full precision support (Full, Half, Quarter, Tenth stars)
- Compact mode for lists/filters/tables
- Tick marks for visual reference
- Gold gradient fill with hover effects
- Toggle rating off by clicking current value

Technical details:
- rating100 scale: Stars 1-5 → 20-100, Decimal 1-10 → 10-100
- Step-based value rounding respects precision settings
- React 17 compatible (ReactDOM.render API)
- CSS-only fullscreen detection (no JS polling)
- Consistent typography (14px for both value and max)

### feat(rating): replace star UI with horizontal gauge + touch support (5067e28)

- Introduce `RatingBar` as universal horizontal gauge (replaces `RatingStars`/`RatingNumber`)
- Add fullscreen video.js overlay plugin (`rating-button.tsx`) to rate without exiting fullscreen
- Implement compact mode for lists, filters and table cells
- Support backend `rating100` scale conversion and full precision (Full/Half/Quarter/Tenth)
- Add comprehensive touch handlers (touch start/move/end) for mobile slider-like interaction
- Update `RatingSystem`, `RatingFilter`, `SceneListTable` and plugin API to use new gauge
- Styling: horizontal layout, consistent typography, tick marks, gold gradient fill, hover effects
- Toggle behavior: click/tap current value to clear rating

Files added/modified (high level):
- Added: `RatingBar.tsx`, `rating-button.tsx`
- Modified: `RatingSystem.tsx`, `RatingFilter.tsx`, `SceneListTable.tsx`, `styles.scss`, `pluginApi.d.ts`, and related imports

### Integrate upstream features: image phashing, StashID filtering, and partial alias deduplication (bb199de)

### Phase 1: Critical Bug Fixes (Complete)
- Fixed zip file duplicate detection (#6493)
  * Corrected zipSize variable usage in scan.go

### Phase 2: Backend Features (Partial - 3.5/12 PRs)

#### PR #6497: Image Phashing Implementation (Complete)
Backend:
- Added image phash generation support with goimagehash library
- Created GenerateImagePhashTask with MD5-based phash reuse optimization
- Extended GenerateMetadataInput with imagePhashes and imageIDs fields
- Extended ScanMetadataOptions with ScanGenerateImagePhashes field
- Added phash fingerprint support to image files
- Integrated image phash generation into scan and generate tasks
- Added phash distance criterion handler for image filtering
- Fixed image format decoder imports (GIF, JPEG, PNG, WebP) for #6535

Frontend:
- Added image phash UI to GenerateDialog (scene/image type support)
- Added phash display and navigation in ImageFileInfoPanel
- Added phash filter criterion to image list filters
- Extended ScanOptions and GenerateOptions with image phash controls
- Added Generate action to image detail page and list toolbar
- Updated locales with image phash terminology

Tools:
- Extended phasher CLI to support both image and video files

#### PR #6401 & #6403: StashID Array Filtering (Complete)
- Added StashIDsCriterionInput GraphQL type with multiple stash_ids support
- Implemented stashIDsCriterionHandler with OR/AND logic (equals/not-equals)
- Applied to all entities: performers, scenes, studios, tags
- Deprecated single stash_id_endpoint fields in favor of stash_ids_endpoint
- Updated all filter types with new criterion support

#### PR #6514: Auto-Remove Duplicate Aliases (50% Complete)
Backend:
- Added UniqueExcludeFold utility for case-insensitive alias deduplication
- Updated GraphQL schema documentation for all alias fields
  * Performers: alias_list (create/update/bulk)
  * Studios: aliases (create/update)
  * Tags: aliases (create/update/bulk)
- Documented deduplication behavior and bulk operation errors

Pending:
- Resolver mutations (performer, studio, tag) to apply deduplication
- Validation logic updates for name change scenarios
- Frontend form validation (yup schema updates)

### Technical Improvements
- Standardized phash error logging with file path context
- Corrected GraphQL documentation (stash_id vs stash_ids clarity)
- Added proper video/image phash terminology distinction

### Files Modified: 45
Backend: 25 files (Go models, SQLite filters, GraphQL resolvers, task handlers)
Frontend: 15 files (TypeScript components, filters, locales)
Schema: 5 GraphQL files (types, filters, metadata definitions)

### Build Status
 Full Go compilation successful (go build ./...)
 GraphQL code generation complete (make generate)
 All changes preserve Vexxx customizations (MUI v7, segments, concurrent tasks)

### Next Steps
1. Complete PR #6514 resolver mutations and validation
2. Phase 2 remaining: 8 backend PRs
3. Phase 3-5: Major features, performance, UI enhancements

### Complete PR #6514: Auto-remove duplicate aliases (backend) (89860ee)

Applied UniqueExcludeFold to alias handling in all entity mutations:

### Performers (resolver_mutation_performer.go)
- PerformerCreate: Remove duplicate aliases and those matching name
- PerformerUpdate: Sanitize aliases when name changes
- BulkPerformerUpdate: Sanitize aliases when name changes

### Studios (resolver_mutation_studio.go)
- StudioCreate: Remove duplicate aliases and those matching name
- StudioUpdate: Sanitize aliases when name changes

### Tags (resolver_mutation_tag.go)
- TagCreate: Remove duplicate aliases and those matching name
- TagUpdate: Sanitize aliases when name changes
- BulkTagUpdate: Added comment (no name support in bulk ops)

### Implementation Details
- All mutations trim whitespace before deduplication
- Case-insensitive comparison using UniqueExcludeFold utility
- Update operations check if both name and aliases are being modified
- Aliases matching the new name are automatically excluded
- Existing validation logic remains unchanged

### Testing
 Full Go compilation successful (go build ./...)
 GraphQL schema already documented (from previous commit)
 Frontend changes deferred (Vexxx uses MUI v7, not React-Bootstrap)

### Phase 2 Progress
Completed: 4/12 backend features
- #6401: StashID filtering
- #6403: Tag StashID filter
- #6402: Tag linking
- #6514: Duplicate aliases  (backend complete)

Next: #6156 - Studio custom fields backend support

### Complete PR #6442: Add Generate Task to Galleries (1f297fb)

- Added galleryIDs field to GraphQL metadata generation input
- Updated task_generate.go to process galleries and queue their images
- Modified GenerateDialog.tsx to support gallery type
- Updated GenerateOptions.tsx to show image options for galleries
- Integrated Generate menu item in Gallery detail page
- Added Generate operation to GalleryList toolbar

This allows users to generate metadata (thumbnails, phashes) for all
images in selected galleries directly from the gallery list or detail page.

### Add upstream integration progress documentation (8756937)

Comprehensive tracking document for Phase 1 and Phase 2 progress:
- Phase 1: All 8 bug fixes complete (7 pre-existing, 1 applied)
- Phase 2: 5/12 PRs complete (6401, 6403, 6402, 6514, 6442)
- Detailed implementation notes and commit references
- Next session starting point and commands
- Build verification status and preserved Vexxx features

### Complete PR #6437: Add Interfaces to Destroy File Database Entries (6818e93)

Added ability to destroy file database entries without deleting filesystem files:

GraphQL Schema Changes:
- Added destroyFiles mutation to delete file entries from database
- Added destroy_file_entry field to GalleryDestroyInput
- Added destroy_file_entry field to ImageDestroyInput and ImagesDestroyInput
- Added destroy_file_entry field to SceneDestroyInput and ScenesDestroyInput

Go Model Changes:
- Updated all destroy input structs with DestroyFileEntry field

Service Interface Updates:
- Updated SceneService.Destroy signature
- Updated ImageService.Destroy signature
- Updated GalleryService.Destroy signature

Resolver Changes:
- Added DestroyFiles mutation resolver
- Updated GalleryDestroy to pass destroyFileEntry parameter
- Updated ImageDestroy and ImagesDestroy resolvers
- Updated SceneDestroy and ScenesDestroy resolvers
- Updated task_clean.go destroy calls with const parameters

Service Implementation:
- Added destroyFileEntries functions to scene, image, gallery services
- Updated all Destroy method signatures to accept destroyFileEntry parameter
- Added logic to destroy database entries while preserving filesystem files
- Updated merge.go to pass destroyFileEntry=false

This feature is useful for removing orphaned database entries when files
should be preserved on disk, such as when reorganizing libraries or fixing
database inconsistencies.

### Complete PR #6542: Bugfix - Scene Cover Merge Removing Covers (d1df5bc)

Fixed bug where merging scenes would remove existing cover images when
no new cover image was provided. Added check to only update cover image
if coverImageData is not empty.

Changes:
- Updated SceneMerge resolver to conditionally update cover image
- Prevents accidental removal of existing covers during merge operations

This ensures cover images are preserved during scene merges unless explicitly
replaced with new cover data.

### Update upstream integration docs: Phase 2 progress (8/12 complete) (fed38b4)

- Added PR #6437 (Destroy file DB entries - 18 files)
- Added PR #6542 (Cover merge bugfix - 1 file)
- Documented PRs already present: #6433, #6448, #6443, #6447
- Updated session history and next steps
- Phase 2: 5 implemented, 3 already present, 1 deferred (#6156)

### Refactor file scanning and handling logic (6c19203)

- Moved directory walking and queuing functionality into scan task code

### Refactor file scanning and handling logic (7eb5d22)

- Moved directory walking and queuing functionality into scan task code

### Merge branch 'master' of https://github.com/Serechops/vexxx-stash (a1dd3a2)

### Refactor file scanning and handling logic (baf3c55)

- Moved directory walking and queuing functionality into scan task code

### Merge branch 'master' of https://github.com/Serechops/vexxx-stash (e6724ea)

### Add synchronous scanFile GraphQL mutation (e031466)

Implements a synchronous single-file scan mutation that returns results
immediately, in contrast to the existing async metadataScan operation.

Changes:
- Add ScanFileInput, ScanFileStatus, and ScanFileResult GraphQL types
- Add scanFile mutation to GraphQL schema
- Implement Manager.ScanFile() using refactored Scanner.ScanFile() method
- Add scanFile resolver with proper type conversion
- Generate updated GraphQL code

Benefits:
- Enables on-demand scanning of individual files without job queue overhead
- Returns immediate feedback with status (NEW/UPDATED/RENAMED/UNCHANGED/SKIPPED)
- Useful for integrations that need to programmatically trigger and verify scans
- Supports selective rescanning via rescan flag
- Complements the upstream Scanner refactor (prep work from PR #6498)

The synchronous approach is ideal for API clients that need to scan a single
file and immediately receive the result, such as file watcher integrations,
manual file addition workflows, or testing scenarios.

### fix(ui): resolve modal backdrop and menu interaction issues (e4f76e2)

Fixed dark backdrop overlays and click-outside behavior for all Menu and
Popover components throughout the application. Users can now interact with
page content while menus are open, and menus properly close when clicking
outside.

Changes:
- Added hideBackdrop prop to all Menu/Popover components to remove dark overlay
- Implemented pointer-events passthrough for operation menus that should allow
  page interaction while open (Scene, Image, Gallery, Performer operations)
- Added manual click-away detection via useEffect for menus using pointer-events
- Removed ellipsis from "Generate" menu item labels for cleaner UI

Components updated:
* Operations menus: Scene.tsx, Image.tsx, Gallery.tsx
* Shared components: ScraperMenu.tsx, ImageInput.tsx, HoverPopover.tsx,
  ExternalLinksButton.tsx
* List components: ListOperationButtons.tsx, Pagination.tsx, ListViewOptions.tsx,
  PlaylistList.tsx
* Scene components: SceneHistoryPanel.tsx, OCounterButton.tsx, SceneTagger.tsx
* Other: PerformerEditPanel.tsx, ParserInput.tsx, StashConfiguration.tsx
* Lists: SceneList.tsx, ImageList.tsx, GalleryList.tsx

fix(api): allow clearing scene cover images

Updated sceneUpdateCoverImage to properly handle empty cover image data,
allowing users to clear/remove cover images. This brings the fork in sync
with upstream fix while preserving Vexxx-specific features (virtual scenes,
auto-rename, gallery generation).

### Fix: Support local image URLs when authentication is enabled (#5538) (e5da35a)

Resolves stashapp/stash#5538

When setting a performer/studio/tag/scene image via a local Stash URL
(e.g., http://localhost:9999/performer/123/image), the backend would
make an unauthenticated HTTP request to itself. This fails with a 401
error when authentication is enabled, resulting in malformed images.

Changes:

Frontend (ImageInput.tsx):
- Detect same-origin image URLs and fetch them client-side using the
  browser's authenticated session (browser has cookies)
- Convert fetched image to base64 data URI before sending to backend
- Avoids backend self-requests entirely for all UI users

Backend (local_image.go + mutation resolvers):
- Add processLocalOrRemoteImage() method to Resolver
- Intercept relative paths (e.g., /performer/123/image) and read image
  data directly from database via GetImage() calls
- Bypasses HTTP layer completely for local resources
- Updated all 21 ProcessImageInput call sites across 7 mutation files

Supported local path patterns:
- /performer/{id}/image
- /studio/{id}/image
- /tag/{id}/image
- /scene/{id}/screenshot
- /group/{id}/frontimage
- /group/{id}/backimage

Benefits:
- Fixes image setting for all entity types when auth is enabled
- Works for both UI users and plugins/GraphQL API consumers
- No security concerns (no API key attachment, no auth bypass)
- Performance improvement (DB read vs HTTP roundtrip)
- Clean architecture (path-based routing in backend)

### Add duplicate title filter for galleries (#6516) (f494e6b)

Implements a new GraphQL filter to identify galleries with duplicate titles,
enabling users to find and manage galleries that share the same name.

Changes:
- Added title_duplicated boolean field to GalleryFilterType in GraphQL schema
- Implemented titleDuplicatedCriterionHandler in gallery SQL filters
- Filter uses SQL GROUP BY with HAVING COUNT to detect duplicates efficiently
- Supports both positive (show duplicates) and negative (show unique) filtering

Benefits:
- Enables deduplication workflows for gallery management
- Allows users to identify galleries that may need renaming or merging
- Provides efficient SQL-based duplicate detection without application-level processing
- Follows existing filter patterns for consistency with scene duplicate detection
- Empty and NULL titles are excluded from duplicate matching

The filter can be used via GraphQL queries:
  findGalleries(filter: { title_duplicated: true })   # Only duplicates
  findGalleries(filter: { title_duplicated: false })  # Only unique titles

### Optimize gallery zip scanning to skip contents when hash unchanged (#6512) (6adf976)

Implements performance optimization for gallery scanning by only iterating
through zip file contents when the container's hash has actually changed,
rather than whenever the file is rescanned or metadata-only changes occur.

Changes:
- Added HashChanged field to ScanFileResult in pkg/file/scan.go
- Modified onExistingFile() to track fingerprint changes separately from file updates
- Updated handleFile() in task_scan.go to check HashChanged instead of Updated for zips
- Uses Fingerprints.ContentsChanged() to detect actual hash changes vs metadata updates

Benefits:
- Dramatically reduces scan time for users with large gallery collections
- Avoids expensive iteration through thousands of images when only file metadata changed
- Still validates zip file integrity by recalculating the container hash
- Preserves existing behavior for new galleries (full scan on first detection)
- Maintains data accuracy - only skips iteration when hash confirms no content changes
- Particularly beneficial during forced rescans where previously all zip contents were re-processed

Technical Details:
The optimization distinguishes between:
- File metadata changes (modtime, permissions) → Skip zip iteration
- File content changes (hash differs) → Full zip iteration required
- New files → Full zip iteration required

When a zip file's modification time changes but its MD5/oshash remains the same,
the gallery record is updated but individual image files inside are not re-scanned.
This is safe because the zip's hash would change if any internal content was modified.

### Add duplicate title filter for galleries (#6516) (f5b7b7d)

Implements a complete frontend and backend solution for filtering galleries by
duplicate titles, enabling users to identify and manage galleries that share
the same name.

Backend Changes:
- Added title_duplicated boolean field to GalleryFilterType in GraphQL schema
- Implemented titleDuplicatedCriterionHandler in gallery SQL filters
- Filter uses SQL GROUP BY with HAVING COUNT to detect duplicates efficiently
- Supports both positive (show duplicates) and negative (show unique) filtering

Frontend Changes:
- Added "Duplicated Title" filter option to gallery list filters
- Integrated with Gallery filter UI using BooleanCriterionOption
- Added locale string for filter label in en-GB.json

Benefits:
- Enables deduplication workflows for gallery management
- Users can identify galleries that may need renaming or merging
- Efficient SQL-based duplicate detection without application-level processing
- Follows existing filter patterns for consistency with scene duplicate detection
- Empty and NULL titles are excluded from duplicate matching
- Seamless integration with existing filter UI and functionality

The filter can be used in the UI via the Galleries page filter panel, or
programmatically via GraphQL:
  findGalleries(filter: { title_duplicated: true })   # Only duplicates
  findGalleries(filter: { title_duplicated: false })  # Only unique titles

### fix: restore settings access when auth is disabled after user creation (1b0d0dc)

When an admin user removes all credentials and API keys, the system
should revert to "no authentication required" mode. However, this
created a dead state where /settings became permanently inaccessible:

- Admin cannot self-delete (protected by UserDestroy mutation)
- userCount remains > 0 (admin still exists in database)
- currentUser returns null (no auth session)
- isSetupMode = false (users exist)
- isAdmin = false (no authenticated user)
- Result: /settings route blocked by ProtectedRoute

The fix introduces "no-auth mode" detection in UserContext. When
the currentUser query succeeds without error but returns null, and
users exist in the database, the system recognizes that authentication
is not configured and grants full admin permissions.

This is distinguished from "user not logged in" (which returns 401
error) by checking that the query succeeded (!userError) while
returning null.

Benefits:
- Restores /settings access when switching from multi-user back to
  single-user mode
- Maintains backward compatibility with no-auth installations
- Preserves security: requires actual login when auth IS configured
  (401 errors correctly restrict access)
- Enables admins to manage users and re-enable auth after clearing
  credentials

Updated tests to verify both setup mode (userCount=0) and no-auth
mode (userCount>0, no current user, no error) grant admin access.

### Optimize SQLite path filtering for large databases (a530083)

Implements four complementary optimizations to address performance issues
with path-based filtering on large media collections (GitHub issue #6455):

A. Decomposed Path Search Strategy
   - Rewrote getPathSearchClause() to avoid per-row string concatenation
   - Exact matches: use concatenation (necessary for full path equality)
   - Patterns with separators: search folders.path directly
   - Patterns without separators: OR-based search on path and basename

B. Prefix-Matchable Pattern Detection
   - Added isAbsolutePath() to detect Unix/Windows absolute paths
   - Added containsPathSeparator() to identify folder-level patterns
   - Absolute paths now use prefix matching (no leading wildcard)
   - Enables SQLite B-tree index usage on folders.path

C. INNER JOIN for Path Filter Criteria
   - Added addFoldersTableInner() to scene/image/gallery repositories
   - Path filters now use INNER JOINs instead of LEFT JOINs
   - Allows query planner to reorder joins and start from indexed folders table
   - Original LEFT JOIN methods preserved for non-path contexts

D. Write-Side Whitespace Trimming
   - Added zeroStringFromTrimmed() helper in record.go
   - Updated setString()/setNullString() to trim on write
   - Updated all entity from<Type> methods (scene, gallery, image, performer,
     studio, tag, group) to use trimmed helper
   - Whitespace-only strings now stored as NULL, eliminating need for
     query-time TRIM() in IS NULL/NOT NULL checks

Benefits:
- Eliminates per-row string concatenation overhead (millions of rows affected)
- Enables index usage for absolute path prefix searches
- Allows query planner flexibility to start from indexed folders table
- Removes query-time TRIM() overhead for NULL checks
- Maintains backward compatibility (query behavior unchanged)
- No migration required (existing data works as-is, trimmed on next update)

Testing:
- Added 20 new unit tests covering all helper functions
- All existing 57 sqlite unit tests pass
- Full project compiles cleanly with no regressions

Technical Notes:
- filterBuilder's joins.addUnique() won't upgrade LEFT→INNER for same alias,
  so separate addFoldersTableInner() methods ensure INNER JOINs when needed
- Write-side trimming is forward-compatible: future migration could remove
  TRIM() from IS NULL checks once all data normalized
- Path separator detection handles both Unix (/) and Windows (\) paths

Files Modified:
- pkg/sqlite/criterion_handlers.go (path search decomposition + helpers)
- pkg/sqlite/scene_filter.go, image_filter.go, gallery_filter.go (INNER JOIN)
- pkg/sqlite/scene.go, image.go, gallery.go (INNER JOIN methods)
- pkg/sqlite/record.go (write-side trimming helpers)
- pkg/sqlite/performer.go, studio.go, tag.go, group.go (trimmed writes)
- pkg/sqlite/group_relationships.go (trimmed writes)
- pkg/sqlite/filter_internal_test.go (new tests)

### feat: integrate upstream studio list sidebar UI (PR #6549) (1f2e1c5)

Integrate upstream Stash PR #6549 "Revamp studio list with sidebar" with
necessary adaptations for Vexxx fork.

Backend changes:
- Add studios_filter field to TagFilterType in GraphQL schema
- Implement StudiosFilter in Go models and SQLite repositories
- Add studios join repository and filter handler to tag queries
- Enable filtering tags by related studios that meet criteria

Frontend changes:
- Refactor StudioList from ItemList pattern to sidebar-based architecture
- Implement FilteredStudioList component with useFilteredItemList hook
- Add collapsible sidebar sections for tags, rating, and favorite filters
- Update LabeledIdFilter to support Studios/Performers/Galleries filters
- Export FilteredStudioList and update all component imports
- Adapt Material UI imports (@mui/material vs react-bootstrap)
- Fix filter component props with required criterion options

Benefits:
- Modern, consistent sidebar UI across all entity list views
- Enhanced filtering: tags can now be filtered by related studios
- Improved user experience with collapsible filter sections
- Better maintainability using current architectural patterns
- Consistent with Scenes, Performers, and other entity lists
- More efficient filter state management and URL persistence

Upstream source: stashapp/stash#6549
Commits: fb143d4, 2030e9e

### feat: integrate upstream performer list sidebar UI pattern (a61d61a)

Integrate sidebar-based filtering UI for performer lists from upstream commit
2b38361a26f516825c734fb13ae52f8d70c10b3e, adapting react-bootstrap components
to Material UI for consistency with Vexxx fork architecture.

Changes:
- Refactor PerformerList.tsx to use sidebar pattern with useFilteredItemList hook
- Add SidebarOptionFilter component for gender and option-based filters
- Add SidebarAgeFilter support for age range filtering
- Update all panel components to use FilteredPerformerList export
- Fix PerformersHero positioning with conditional Box wrapper for main view
- Preserve merge functionality and all export operations

Modified Files:
- ui/v2.5/src/components/Performers/PerformerList.tsx
- ui/v2.5/src/components/List/Filters/OptionFilter.tsx
- ui/v2.5/src/components/Tags/TagDetails/TagPerformersPanel.tsx
- ui/v2.5/src/components/Studios/StudioDetails/StudioPerformersPanel.tsx
- ui/v2.5/src/components/Performers/Performers.tsx
- ui/v2.5/src/components/Performers/PerformerDetails/performerAppearsWithPanel.tsx
- ui/v2.5/src/components/Groups/GroupDetails/GroupPerformersPanel.tsx

Adapted Components:
- Button: react-bootstrap → @mui/material
- Form components → Material UI equivalents
- Preserved all existing functionality and keyboard shortcuts

Related: Follows studio list sidebar integration pattern

### feat: Integrate gallery list sidebar and add GalleriesHero component (71aca77)

Integrates the gallery list sidebar interface from upstream Stash commit
b5de30a, providing a consistent collapsible sidebar UI across all main
entity lists (Studios, Performers, and Galleries). Also adds a new
GalleriesHero component for visual appeal on the main galleries page.

Gallery List Sidebar Changes:
- Refactored GalleryList.tsx to use FilteredGalleryList with
  useFilteredItemList hook instead of ItemList pattern
- Added 5 sidebar filter sections: Studios, Performers, Tags, Rating,
  and Organized (boolean)
- Fixed SidebarPerformersFilter and SidebarStudiosFilter to include all
  required props (option, title, data-type, sectionID)
- Added missing criterion option imports (PerformersCriterionOption,
  StudiosCriterionOption)
- Updated Galleries.tsx to use FilteredGalleryList export
- Updated 3 gallery panel components: PerformerGalleriesPanel,
  StudioGalleriesPanel, and TagGalleriesPanel
- Preserved all 3 display modes: Grid, List, and Wall
- Adapted react-bootstrap components to Material UI (Button)
- Fixed import path for GalleryCardGrid (from GalleryGridCard.tsx)
- Added conditional Box wrapper for hero positioning (65vh margin with
  gradient blend on main Galleries page)

GalleriesHero Component:
- Created new GalleriesHero.tsx with 3D carousel of random galleries
- Displays 25 random gallery covers with auto-advance (3s intervals)
- Interactive click-to-navigate on active gallery
- Shows title and image count overlay on active item
- Matches ImagesHero dimensions and styling (h-[100%], top-[-1%])
- Uses gallery.paths.cover for cover image access
- Responsive design (hidden on mobile, visible on desktop)

The gallery list now provides the same modern filtering experience as
the studio and performer lists, with dedicated sidebar sections for each
filter type, a streamlined toolbar interface, and an elegant hero banner
for visual engagement.

Related upstream: stashapp/stash@b5de30a

### Refactor scraper package (#6495) (a9d8538)

* Remove reflection from mapped value processing
* AI generated unit tests
* Move mappedConfig to separate file
* Rename group to configScraper
* Separate mapped post-processing code into separate file
* Update test after group rename
* Check map entry when returning scraper
* Refactor config into definition
* Support single string for string slice translation
* Rename config.go to definition.go
* Rename configScraper to definedScraper
* Rename config_scraper.go to defined_scraper.go

### Future support for filtering tags list by current filter on Performers page (#6091) (67093d5)

### feat: Add performer filter support to tags list with sidebar refactor (fdc76c3)

- Cherry-pick upstream commit f629191b (tag performer filter backend support)
- Refactor TagList from old ItemList pattern to new sidebar pattern
- Add SidebarPerformersFilter to tags list (enables filtering tags by performers)
- Add SidebarRatingFilter to tags list
- Convert TagList to use useFilteredItemList hook
- Update Tags.tsx to use FilteredTagList component
- Preserve old TagList.tsx as TagList_OLD.tsx for reference

This completes the 'future support' infrastructure from upstream by providing
full UI implementation. Users can now filter tags by which performers they are
associated with, directly through the sidebar interface.

Benefits:
- Consistent sidebar UI across Studios/Performers/Galleries/Tags
- Better tag discovery through performer filtering
- Improved navigation with integrated search and filters
- Matches upstream's vision for cross-entity filtering

### chore: Remove unused TagList_OLD.tsx backup file (c18dc6c)

### FR: Add Generate Task to Galleries (#6442) (402fdfb)

### fix: Remove duplicate GalleryIDs section in task_generate.go (e1cc8f9)

The cherry-pick introduced duplicate code for handling gallery image generation.
Removed the duplicate section that had incorrect queueImageJob call signature.

### fix: Repair broken GalleryList and Gallery components after merge conflicts (686aabe)

GalleryList.tsx was completely broken due to corrupted merge combining old ItemList
pattern with new sidebar pattern. Rewrote entire file based on PerformerList.tsx
template to properly implement the modern useFilteredItemList pattern.

GalleryList.tsx fixes:
- Removed all duplicate code (old ItemListContext JSX, duplicate functions)
- Added ~30 missing imports (PatchContainerComponent, useFocus, useSidebarState,
  all sidebar filter components, criterion options, utility hooks, etc.)
- Removed duplicate modal/showModal/closeModal declarations
- Fixed JSX structure with proper div wrapper and Box hero wrapper
- Removed unsupported props from GalleryWallCard (selected/onSelectedChanged/selecting)
- Removed onInvertSelection (not available from useListSelect hook)
- Removed invert selection operation from toolbar menu

Gallery.tsx fixes:
- Removed duplicate GenerateDialog import and declaration
- Fixed 3 Dropdown.Item  MenuItem tag mismatches
- Fixed 3 div  Box opening tag mismatches
- Added missing collapsed state variable declaration

GalleryCard.tsx enhancement:
- Made selection checkbox visible on hover for better UX
- Added click handler to checkbox that prevents link navigation

Benefits:
- Galleries list now renders properly with full sidebar filter support
- Consistent UI architecture across all list components (Scenes/Performers/Tags/Galleries)
- Selection mode works correctly with hover-to-select functionality
- Build succeeds with zero TypeScript errors
- Clean separation of concerns between display components and list management

### fix: Prevent lightbox navigation arrows from sliding down on hover (4d46304)

Navigation arrows were sliding to the bottom of the screen when hovered,
making them unclickable and breaking the lightbox navigation experience.

Root causes:
1. Transform conflict - Used 'top: 50%; transform: translateY(-50%)' for
   vertical centering, but MUI IconButton applies its own transform during
   hover/ripple states, overriding translateY(-50%) and causing buttons to
   snap to 'top: 50%' then slide further down
2. Transition: all - SVG transition included all properties, potentially
   animating layout-affecting changes during hover state
3. Class conflict - Bootstrap 'd-lg-block' sets 'display: block !important'
   which conflicts with MUI's inline-flex and flex-based centering

Solutions:
- Replaced transform centering with flex-based centering (top: 0; bottom: 0;
  display: flex; align-items: center) - immune to MUI transform interference
- Changed SVG transition from 'all' to explicit 'opacity, color' properties
- Replaced Bootstrap visibility classes with Tailwind 'hidden lg:flex' for
  consistency and to avoid display property conflicts
- Increased z-index from 1045 to 2001 to ensure arrows render above header/
  footer controls (z-index 2000)
- Added padding to button containers for better hover target area

Benefits:
- Navigation arrows stay fixed in position when hovered
- Smooth hover transitions without layout shifts
- Improved clickability and user experience in lightbox
- Consistent behavior across different screen sizes
- No conflicts between CSS frameworks (Bootstrap/MUI/Tailwind)

### refactor: Mirror ImageDetailPanel layout for Gallery page (b31803d)

Completely restructured Gallery page to match the clean, responsive layout
from the Image detail page. This provides consistent UX across detail views
and resolves layout issues with tabs running across the page.

Layout changes:
- Replaced Bootstrap row/col classes with MUI Box flex layout
- Left panel (details/tabs): Fixed 450px width on desktop, stacked on mobile
- Right panel (images/add): Fluid width, takes remaining space
- Responsive ordering: Images first on mobile, details first on desktop
- Both panels constrained to viewport height with independent scrolling

Gallery details (left panel):
- Studio logo and title in flexbox layout with responsive sizing
- Toolbar with rating, organized button, and operations menu
- Sticky tabs that stay at top when scrolling content
- Tab panels: Details, Scenes, File Info, Chapters, Edit

Gallery content (right panel):
- Sticky tabs for Images/Add at top of container
- GalleryImagesPanel or GalleryAddPanel content below
- Independent scrolling from details panel

Styling improvements:
- MUI sx prop for all responsive styles (replaces inline classes)
- Typography uses responsive font sizes (xs: 1.5rem, xl: 1.75rem)
- Proper spacing and padding (15px, consistent with Image page)
- Toolbar items use columnGap for consistent spacing
- Rating component no longer stretches panel width

Removed:
- Bootstrap .row/.col/.details-tab/.content-container classes
- Old .gallery-page/.gallery-tabs/.gallery-container classes
- Unused 'collapsed' state variable
- Custom .gallery-sticky-tabs class (replaced by MUI sticky Box)

Benefits:
- Consistent layout and UX across Image and Gallery detail pages
- Proper responsive behavior on mobile/tablet/desktop
- Rating gauge no longer stretches the panel
- Both panels scroll independently - better for long content
- Cleaner code with MUI sx styling instead of mixed CSS classes
- Fixed issue where tabs would rearrange the entire page

### fix: Add missing FilterMode cases and criterion options for cross-entity filtering (89805f5)

LabeledIdFilter: Add FilterMode.Studios and FilterMode.Tags support
- Added TagFilterType import to LabeledIdFilter.tsx
- Extended IFilterType interface with tags_filter/tag_count and studios_filter/studio_count
- Added FilterMode.Studios case to setObjectFilter (sets studios_filter)
- Added FilterMode.Tags case to setObjectFilter (sets tags_filter)
- Changed default case from throwing error to silent skip for unsupported modes
- Fixes 'Invalid filter mode' errors when using SidebarTagsFilter on Studios page
  or SidebarPerformersFilter on Tags page

Tags filter model: Add PerformersCriterionOption to criterion options
- Imported PerformersCriterionOption in tags.ts
- Added to TagListFilterOptions criterionOptions array
- Fixes 'Unknown criterion parameter name: performers' error on Tags page
- Enables SidebarPerformersFilter to track UI state for performer selection

TagList UI: Remove unsupported SidebarRatingFilter
- Tags don't have rating100 field in GraphQL schema (TagFilterType)
- Removed SidebarRatingFilter component and unused imports
- Prevents potential crash when rating filter would be opened

Scene page layout: Fix viewport filling with dynamic height
- Added explicit sx props to scene-layout Box for proper flexbox layout
- Height: calc(100vh - 3.5rem) accounts for navbar + .main padding
- Ensures scene-layout MuiBox dynamically fills main container
- Works in harmony with existing Scenes/styles.scss rules

Benefits:
- Cross-entity filtering now works correctly across all entity pages
- Studios page can filter by tags (SidebarTagsFilter)
- Tags page can filter by performers (SidebarPerformersFilter)
- Scene detail pages properly fill viewport without extra scroll space
- Consistent sidebar filter behavior across all list pages
- Graceful handling of unsupported filter modes instead of crashes

### refactor(ui): complete Bootstrap removal and migrate to Sass module system (172f6c6)

BREAKING CHANGE: All Bootstrap 4 dependencies removed, migrated to MUI v7 + modern Sass

## Bootstrap Removal
- Remove bootstrap 4.6.2 npm package
- Delete _bootstrap-compat.scss (826 lines)
- Migrate ~75+ TSX components from Bootstrap classes to MUI components
- Remove ~350 lines of dead Bootstrap CSS selectors from index.scss
- Clean Bootstrap overrides from component styles (Shared, Tagger, Scenes, Performers, etc.)
- Delete unused Layouts.tsx shim
- Replace `container` className with `content-container` (11 files)

## Sass Module System Migration (@import → @use)
- Migrate all 27 SCSS files from deprecated @import to modern @use/@forward
- Add `@use "sass:map"` and `@use "sass:color"` for built-in modules
- Replace `map-get()` → `map.get()` in _theme.scss
- Replace `darken()` → `color.adjust($lightness: -N%)` (5 occurrences)
- Replace `lighten()` → `color.adjust($lightness: N%)` (1 occurrence)
- Configure Vite with `css.preprocessorOptions.scss.api: 'modern-compiler'`
- Move layout variables ($navbar-height, etc.) from index.scss to _theme.scss

## Bug Fixes
- Fix duplicate style attribute in MovieFyQueue.tsx
- Fix vestigial nav-tabs className in QuickSettings.tsx

## Build
- ✅ Zero Sass deprecation warnings (was 15+)
- ✅ Zero TypeScript errors
- ✅ Zero build errors
- ✅ Exit code 0

All code now compliant with Dart Sass 3.0.0 and ready for Bootstrap-free future.

### fix(ui): Studio cards now respect zoom slider settings (68df939)

- Changed StudioList to use SmartStudioCardGrid instead of StudioCardGrid
- Aligns studio list behavior with tag list implementation
- SmartStudioCardGrid includes virtualization support and proper zoom handling
- Fixes issue where studio grid cards weren't resizing based on zoom level

The studio card grid now correctly displays:
- Zoom 4: 3 cards wide
- Zoom 3: 4 cards wide
- Zoom 2: 5 cards wide
- Zoom 1 (default): 7 cards wide
- Zoom 0: 8 cards wide

### feat(ui): Major improvements to hero banners, zoom controls, and layouts (6a70d31)

Studio Cards & Zoom:
- Updated StudioList to use SmartStudioCardGrid for proper zoom handling
- Aligns studio grid behavior with tag grid implementation
- Studio cards now correctly resize at all zoom levels (3-8 cards wide)

Hero Banner Redesign:
- Completely redesigned ImagesHero with elegant floating grid mosaic
  * Full-screen blurred backdrop with Ken Burns animation
  * 4x2 floating thumbnail grid with smooth transitions
  * Radial vignette and floating particle effects
  * 5-second fade intervals between featured images

- Completely redesigned GalleriesHero with split-panel showcase
  * 2/3 featured panel with large cover and typography
  * 1/3 sidebar showing 6 additional galleries
  * Interactive hover states with scale and shadow effects
  * Staggered entrance animations
  * All galleries clickable for navigation

Mobile Improvements:
- Fixed excessive blank space on mobile where hero banners are hidden
- Reduced top margin from 50vw/4 spacing units to 2 (16px)
- Hero banners remain hidden on mobile (md: breakpoint)

Component Fixes:
- Added maxWidth constraints to RatingBar (200px compact, 300px normal)
- Prevents rating bar from stretching across entire page width

All designs feature premium aesthetics, layered depth with gradients,
smooth professional animations, and better content hierarchy.

### fix(ui): Selective Scan now shows all configured libraries at root (ca6d799)

Fixed navigation bug where "Selective Scan" dialog would immediately drill
into the first library's subdirectories instead of showing all configured
library paths for selection.

Changes:
- DirectorySelectionDialog: Initialize currentDirectory to empty string to
  start at root level showing all libraries
- FolderSelect: Added isAtRoot detection to override backend's home directory
  result with the configured library paths (defaultDirectories) when at root

Previously, the dialog would start at libraryPaths?.[0], and the backend's
getDir("") returns the home directory, so the library list was never shown.
Now users can browse the full list of configured libraries and navigate into
any of them.

### chore: removing unnecessary build artifacts from project root. (c434c63)

### refactor(ui): Migrate Tagger component from SCSS to MUI sx props (b4cc865)

Complete migration of the Tagger component folder to use MUI's sx prop system
instead of SCSS stylesheets, eliminating 754 lines of styles.scss.

Changes:
- Delete src/components/Tagger/styles.scss (754 lines)
- Migrate all 17+ Tagger TSX files from className to inline sx props
- Remove cx (classnames) utility where no longer needed
- Convert utility classes (flex, mt-2, ml-2, etc.) to sx equivalents
- Move parent context rules (li.active) to conditional sx on elements
- Preserve minimal classNames as CSS hooks where needed (IncludeButton)

Component improvements:
- Constrain scene preview to max-width: 240px to prevent oversized rows
- Refactor performer thumbnails from stacked Grid rows to horizontal wrap
  with compact 32px circular images
- Add playOnHover prop to ScenePreview for hover-based video playback
- Fix scene title/path layout with proper overflow handling

Files modified:
- All Tagger/*.tsx scene/performer/studio subfolders
- PerformerModal, PerformerFieldSelector, StudioFieldSelector
- IncludeButton, TaggerReview, Config files
- SceneCard.tsx (hover playback support)
- index.scss (remove Tagger styles import)

Bug fixes:
- Fix JSX tag mismatch in PerformerModal (</ul> → </Box>)

### refactor(ui): Complete Batch 3 SCSS-to-MUI migration and fix header image sizing (83989b7)

Batch 3 Components - SCSS Migrated:
- PackageManager (128 lines) - deleted styles.scss
- Galleries (292 lines) - deleted styles.scss
- Performers (331 lines) - deleted styles.scss
- Scenes (419 lines) - deleted styles.scss
  - Converted 21 scene-layout/page-content/toolbar/tabs classNames to sx
  - Migrated cross-component classes (card-popovers, card-section, performer-tag, group-tag, studio-logo, scene-cover, scene-performers, scene-card-preview)
  - Updated ScrapedImageRow interface to accept both className and style props
- ScenePlayer (952 lines) - retained with cleanup
  - Removed ~80 lines of dead scene layout code
  - Kept video.js CSS overrides (cannot be converted to sx)
- Shared (1115 lines) - retained with optimization
  - Removed ~170 lines of dead code (modal-icon-container, ml-label, StashBoxSearchModal, sidebar-toolbar, react-select-image-option, empty vexxx placeholders)
  - Converted 13 simple classes to sx/inline styles (~75 lines):
    * hover-popover-content, ErrorMessage-container, truncated-text, external-links-button
    * vexxx-detail-image, vexxx-scene-list-image, scrape-header-offset/row
    * scrape-url-button, double-range-sliders, double-range-slider-min, move-target
  - Reduced from 1115 → 841 lines (25% reduction)
  - Retained complex styles: grid-card, sidebar-pane, react-datepicker overrides, double-range-slider vendor pseudo-elements, scrape-dialog, custom-fields, etc.

Header Image Sizing Fixes:
- Fixed DetailImage.tsx: removed inline maxWidth: '100%' that was preventing CSS max-width rules from applying
- Added responsive size constraints for detail page headers:
  * Group images: 12rem (192px)
  * Performer images: 12-15rem (192-240px) based on expanded/collapsed state
  * Tag images: 14-18rem (224-288px) based on expanded/collapsed state
- Prevents header images from dominating page layout while keeping them visible and prominent

Cross-Component Updates:
- SceneCard, HoverVideoPreview: removed scene-card-preview className, moved portrait conditional to sx
- StashDBCard: removed dead classNames (scene-card-preview, performer-tag)
- ScrapedSceneCard: converted scene-card-preview and card-section to inline styles
- PerformerPopoverButton, GroupTag: converted to inline styles
- SceneDuplicateChecker: converted group-tag-container to inline style
- Image.tsx, Gallery.tsx: converted studio-logo to inline style
- TagCard, StudioCard, SceneMarkerCard: added card-popovers sx to ButtonGroup
- GridCard: added card-section mb/padding to existing sx
- PrimaryTags: converted card-section to inline style
- URLField, GroupEditPanel: converted scrape-url-button to sx with &:disabled rule
- DoubleRangeInput: converted to inline styles
- TruncatedText: removed cx import, converted to pure sx
- ScrapeDialog: converted header offset/row to sx with MUI breakpoints
- GroupSceneTable: converted vexxx-scene-list-image to inline styles
- ExternalLinksButton: converted to sx on Menu
- HoverPopover: converted to inline style
- ErrorMessage: converted container to inline style

Files Deleted (10):
- Galleries/styles.scss, Performers/styles.scss, Scenes/styles.scss
- Groups/styles.scss, Tags/styles.scss, Studios/styles.scss
- Settings/styles.scss, Recommendations/styles.scss
- PackageManager/styles.scss, Setup/styles.scss

Build Status: Verified (exit code 0)

Progress: Batch 3 complete. Remaining: _theme.scss, _scrollbars, _fonts, _range, sfw-mode, interactive, Lightbox, index.scss shared rules

### chore(ui): Batch 4 SCSS-to-MUI migration - Interactive, Lightbox, MovieFy, GlobalSearch, PlaylistPlayer (14b6835)

Migrate 5 SCSS files to MUI sx prop styling:

- Interactive (42 lines): Convert className-based state styling to sx with
  inline keyframes and color functions
- Lightbox (75 lines): Convert nav buttons, options container, thumb nav
  to sx on IconButton/Box components
- MovieFy (251 lines): Delete dead SCSS file (never imported anywhere)
- GlobalSearch CSS module (279 lines): Convert all 3 consumers
  (GlobalSearch.tsx, GlobalSearchResults.tsx, QuickSettings.tsx) from CSS
  module classes to sx props with Box components
- PlaylistPlayer (479 lines): Convert all 39 className usages across
  MediaPlayer, ImageViewer, QueuePanel, and main layout components to sx

12 files changed, 845 insertions, 1309 deletions (net -464 lines)
5 SCSS files deleted

### ui: implement performer hover preview in scene tagger and fix VideoJS plugin crashes (0122552)

- Add hover preview functionality to performer images in the Scene Tagger.
- Customize hover preview size to 140px (approx. 50% of standard card size).
- Update PerformerPopover and PerformerCard to support custom card width.
- Add defensive guards for VideoJS plugins (seekButtons, mobileUi, vr) to
  prevent "not a function" and "plugin does not exist" crashes in development
  environments where plugin registration may be inconsistent.
- Safeguard VRMenuPlugin in vrmode.ts against missing videojs-vr plugin.

### Refactor file info panels and fix layout issues (49c3ed7)

This commit includes several layout fixes and improvements:

- Refactored Image, Scene, and Gallery file info panels to use full width and improved grid layout.
- Moved 'Path' and 'URLs' fields to dedicated sections with word-break to handle long content gracefully.
- Updated 'dl.details-list' internal CSS to use 'overflow-wrap: anywhere' instead of 'overflow: hidden', preventing truncation of StashDB pills and URLs.
- Removed 'content-container' class from multiple Scene and Gallery detail tabs (Video Filters, Markers, Galleries, Scenes, Chapters) to fix width constraints.
- Added CSS to constrain oversized performer images in the Scrape Performer modal.

### feat(ui): enhance Queue tab with search, suggestions, and origin pinning (e0ae353)

- UI Refactor: Replaced the basic queue list with a modern QueueViewer
- Added search-to-add functionality with debounced scene searching
- Added smart suggestions using useSimilarScenesQuery (sparkle icon suggestions)
- Added "Now Playing" pinned origin scene at the top with a divider
- Implement hover video previews in suggestion/search list items
- Enlarge thumbnails to 120x68 and improved layout spacing
- Added "Clear All" functionality to empty the queue instantly
- Removed legacy auto-populate logic that filled queue from list filters
- Fixed INamedObject type compliance by adding missing 'id' field
- Optimized dropdown state management to resolve race conditions
