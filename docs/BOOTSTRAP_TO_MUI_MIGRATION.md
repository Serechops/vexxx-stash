# Bootstrap → MUI Migration Plan

> **Goal**: Fully remove the `bootstrap` npm package and all Bootstrap CSS/SCSS dependencies, replacing them with MUI's `sx` prop, MUI `Grid`/`Stack`/`Box`, and Tailwind utilities where appropriate.

---

## Current State Summary

| Item | Status |
|------|--------|
| `react-bootstrap` imports | **Fully removed** ✅ |
| MUI ThemeProvider + CssBaseline | **Active at root** ✅ |
| MUI components (Box, Button, Grid, etc.) | **~200+ files adopted** ✅ |
| MUI Icons | **80 centralized + 30+ direct imports** ✅ |
| `bootstrap` npm package | **Still installed** (v4.6.2) ❌ |
| Full Bootstrap SCSS import | **Still in `_theme.scss`** ❌ |
| Bootstrap utility classes in TSX | **~540+ usages in ~70-80 files** ❌ |
| Bootstrap variables/mixins in SCSS | **~106 usages in ~16 SCSS files** ❌ |
| `Layouts.tsx` shim (Row/Col → Grid) | **Bridge exists**, used in ~16 files |

---

## Migration Phases

### Phase 0: Preparation & Infrastructure (1-2 days)

**Objective**: Set up the tooling and patterns that all subsequent phases depend on.

#### 0.1 — Create a Bootstrap utility → MUI/Tailwind mapping reference

| Bootstrap Class | Replacement Strategy | MUI `sx` | Tailwind |
|----------------|---------------------|----------|----------|
| `mb-1` to `mb-5` | `sx={{ mb: N }}` or Tailwind `mb-N` | `mb: 1` (8px units) | `mb-2` (0.5rem) |
| `mt-1` to `mt-5` | `sx={{ mt: N }}` | `mt: 1` | `mt-2` |
| `mr-1` to `mr-5` | `sx={{ mr: N }}` | `mr: 1` | `mr-2` |
| `ml-1` to `ml-5` | `sx={{ ml: N }}` | `ml: 1` | `ml-2` |
| `p-1` to `p-5` | `sx={{ p: N }}` | `p: 1` | `p-2` |
| `px-1` to `px-5` | `sx={{ px: N }}` | `px: 1` | `px-2` |
| `py-1` to `py-5` | `sx={{ py: N }}` | `py: 1` | `py-2` |
| `d-flex` | `sx={{ display: 'flex' }}` | `display: 'flex'` | `flex` |
| `d-block` | `sx={{ display: 'block' }}` | `display: 'block'` | `block` |
| `d-none` | `sx={{ display: 'none' }}` | `display: 'none'` | `hidden` |
| `d-inline-block` | `sx={{ display: 'inline-block' }}` | — | `inline-block` |
| `text-center` | `sx={{ textAlign: 'center' }}` | `textAlign: 'center'` | `text-center` ✓ |
| `text-right` | `sx={{ textAlign: 'right' }}` | — | `text-right` ✓ |
| `text-left` | `sx={{ textAlign: 'left' }}` | — | `text-left` ✓ |
| `text-muted` | `<Typography color="text.secondary">` | `color: 'text.secondary'` | `text-muted-foreground` |
| `text-danger` | `<Typography color="error">` | `color: 'error.main'` | `text-destructive` |
| `text-success` | `<Typography color="success">` | `color: 'success.main'` | `text-green-500` |
| `text-warning` | `color="warning"` | `color: 'warning.main'` | `text-yellow-500` |
| `text-info` | `color="info"` | `color: 'info.main'` | `text-blue-400` |
| `text-truncate` | `sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}` | — | `truncate` |
| `justify-content-center` | `sx={{ justifyContent: 'center' }}` | — | `justify-center` |
| `justify-content-end` | `sx={{ justifyContent: 'flex-end' }}` | — | `justify-end` |
| `justify-content-between` | `sx={{ justifyContent: 'space-between' }}` | — | `justify-between` |
| `align-items-center` | `sx={{ alignItems: 'center' }}` | — | `items-center` |
| `align-items-start` | `sx={{ alignItems: 'flex-start' }}` | — | `items-start` |
| `flex-grow-1` | `sx={{ flexGrow: 1 }}` | — | `grow` |
| `flex-shrink-0` | `sx={{ flexShrink: 0 }}` | — | `shrink-0` |
| `w-100` | `sx={{ width: '100%' }}` | — | `w-full` |
| `h-100` | `sx={{ height: '100%' }}` | — | `h-full` |
| `no-gutters` | `<Grid container spacing={0}>` | — | — |
| `row` | `<Grid container>` or `<Stack direction="row">` | — | `flex flex-row` |
| `col-N` | `<Grid size={{ xs: N }}>` | — | — |
| `col-md-N` | `<Grid size={{ md: N }}>` | — | — |
| `form-control` | `<TextField>` or `<Select>` | — | — |
| `form-group` | `<FormControl>` | — | — |
| `input-group` | `<TextField InputProps={{ startAdornment/endAdornment }}` | — | — |
| `badge badge-secondary` | `<Chip size="small">` | — | — |
| `font-weight-bold` | `sx={{ fontWeight: 'bold' }}` | — | `font-bold` |
| `small` (class) | `<Typography variant="body2">` | `fontSize: '0.875rem'` | `text-sm` |
| `container-fluid` | `<Container maxWidth={false}>` | — | — |
| `bg-secondary` | `sx={{ bgcolor: 'background.paper' }}` | — | `bg-secondary` |
| `bg-dark` | `sx={{ bgcolor: 'grey.900' }}` | — | `bg-zinc-900` |

#### 0.2 — Add ESLint rule to prevent new Bootstrap class usage

Create a custom ESLint rule or use `eslint-plugin-no-restricted-syntax` to warn on className strings containing Bootstrap-specific patterns like `d-flex`, `no-gutters`, `text-muted`, `justify-content-`, `form-control`, `col-`, `row`.

#### 0.3 — Decide preference: `sx` prop vs Tailwind for utility replacements

**Recommendation**: 
- **MUI `sx`** for anything inside MUI components (spacing, colors, display on Box/Typography/Grid)
- **Tailwind** for container/wrapper divs and non-MUI elements (already in use for newer components like TagHero, Lightbox)
- Be consistent within each file — don't mix approaches in the same component

---

### Phase 1: SCSS Foundation — Remove Bootstrap Import (~3-5 days)

**Objective**: Eliminate `@import "node_modules/bootstrap/scss/bootstrap"` from `_theme.scss`.

This is the **hardest phase** because it removes all implicit Bootstrap CSS. Must be done carefully.

#### 1.1 — Extract used Bootstrap variables into custom variables

**File**: `ui/v2.5/src/styles/_theme.scss`

The following Bootstrap variables are referenced across SCSS files and need to be preserved as custom CSS custom properties or Sass variables:

```scss
// Already defined in _theme.scss — keep these:
$body-bg, $text-muted, $secondary, $success, $warning, $danger, $card-bg,
$text-color, $link-color, $link-hover-color, $font-family-sans-serif

// These come FROM Bootstrap and need new definitions:
$grid-breakpoints     → Already in MUI theme breakpoints (align values)
$border-radius        → Define explicitly or use MUI theme.shape.borderRadius
$input-bg             → Map to MUI theme palette  
$input-border-color   → Map to MUI theme
$font-size-base       → Already in MUI typography
```

#### 1.2 — Replace Bootstrap media-query mixins (~70 occurrences in 13 files)

| Bootstrap Mixin | Replacement |
|----------------|-------------|
| `@include media-breakpoint-up(sm)` | `@media (min-width: 600px)` |
| `@include media-breakpoint-up(md)` | `@media (min-width: 900px)` |
| `@include media-breakpoint-up(lg)` | `@media (min-width: 1200px)` |
| `@include media-breakpoint-up(xl)` | `@media (min-width: 1536px)` |
| `@include media-breakpoint-down(sm)` | `@media (max-width: 599.98px)` |
| `@include media-breakpoint-down(md)` | `@media (max-width: 899.98px)` |
| `@include media-breakpoint-down(lg)` | `@media (max-width: 1199.98px)` |

**Note**: Breakpoints should match the MUI theme configuration in `theme/theme.ts`. Use find-and-replace with regex.

**Files requiring mixin replacement** (priority order):
1. `index.scss` (~13 occurrences)
2. `components/Scenes/styles.scss` (~12)
3. `components/Shared/styles.scss` (~12)
4. `components/Studios/styles.scss` (~6)
5. `components/Galleries/styles.scss` (~6)
6. `components/Tags/styles.scss` (~5)
7. `components/Playlists/PlaylistPlayer.scss` (~5)
8. `components/Tagger/styles.scss` (~4)
9. `components/Settings/styles.scss` (~3)
10. `components/Performers/styles.scss` (~2)
11. `components/Recommendations/styles.scss` (~2)

#### 1.3 — Replace Bootstrap grid SCSS with custom CSS Grid or Flexbox

Audit which SCSS files use Bootstrap's `.row`, `.col-*` rules as selectors (not just class names in TSX). These need equivalent CSS.

#### 1.4 — Recreate essential Bootstrap base styles

After removing the import, some global resets/styles will vanish. Create a slim replacement:

```scss
// _base-reset.scss — replaces Bootstrap's reboot
*, *::before, *::after { box-sizing: border-box; }
body { 
  margin: 0; 
  font-family: $font-family-sans-serif;
  background-color: $body-bg;
  color: $text-color;
}
a { color: $link-color; text-decoration: none; }
a:hover { color: $link-hover-color; }
```

**Note**: MUI's `<CssBaseline />` already handles most of this. Verify overlap before adding custom resets.

#### 1.5 — Create Bootstrap utility class compatibility layer (temporary)

If removing all ~540 class usages at once is too risky, create a thin SCSS file that defines just the Bootstrap utility classes still in use:

```scss
// _bootstrap-compat.scss (temporary — remove after Phase 2)
.d-flex { display: flex; }
.d-block { display: block; }
.d-none { display: none; }
.d-inline-block { display: inline-block; }
.text-muted { color: $text-muted; }
.text-danger { color: $danger; }
.text-center { text-align: center; }
.text-right { text-align: right; }
.justify-content-center { justify-content: center; }
// ... etc
```

This allows removing the full Bootstrap import while preserving visual correctness during incremental TSX migration.

---

### Phase 2: TSX Component Migration — Bootstrap Classes → MUI/Tailwind (~2-3 weeks)

**Objective**: Remove all Bootstrap CSS class usage from `.tsx` files.

Work in order of **least-dependent → most-complex** to avoid regressions.

#### Tier 1: Low-complexity standalone components (~2 days)

| Component | Bootstrap Issues | Estimated Effort |
|-----------|-----------------|-----------------|
| `Stats.tsx` | Pure BS layout (`col`, `row`, `m-sm-auto`) | 30 min |
| `Changelog/Version.tsx` | `d-block` | 10 min |
| `PageNotFound.tsx` | Minimal classes | 10 min |
| `ErrorBoundary.tsx` | Minimal | 10 min |
| `App.tsx` root | `container-fluid` → `<Container maxWidth={false}>` | 15 min |

#### Tier 2: Shared components — highest leverage (~3 days)

Fixing these propagates improvements to all consumers.

| Component | Bootstrap Issues | Estimated Effort |
|-----------|-----------------|-----------------|
| `Shared/Layouts.tsx` | Bridge component — eventually remove if all callers use MUI directly | 1 hr |
| `Shared/Select.tsx` | `form-control` | 30 min |
| `Shared/URLField.tsx` | `mr-2`, `flex-grow-1` | 20 min |
| `Shared/StringListInput.tsx` | `invalid-feedback`, `mt-n2` | 20 min |
| `Shared/CollapseButton.tsx` | Custom BS-derived classes | 30 min |
| `Shared/ImageSelector.tsx` | `d-flex`, spacing | 30 min |
| `Shared/Sidebar.tsx` | Mixed BS + Tailwind classes | 45 min |
| `Shared/LoadingIndicator.tsx` | Minimal | 15 min |
| `Shared/ScrapeDialog/*.tsx` (3 files) | `px-3`, `pt-3`, `tag-item` | 1 hr |
| `Shared/StashBoxIDSearchModal.tsx` | Heavy: `text-muted`, `mt-*`, `mb-*`, `d-block`, `m-4`, `text-center` | 1 hr |
| `Shared/PackageManager/PackageManager.tsx` | Flexbox utilities | 30 min |
| `Shared/GridCard.tsx` | Card layout classes | 30 min |

#### Tier 3: Entity Cards — pattern-heavy, apply consistently (~2 days)

| Component | Bootstrap Issues |
|-----------|-----------------|
| `Tags/TagCard.tsx` | `card-popovers`, layout classes |
| `Studios/StudioCard.tsx` | `card-popovers`, `zoom-*` layout |
| `Groups/GroupCard.tsx` | Heavy spacing classes |
| `Performers/PerformerCard.tsx` | Card layout + spacing |
| `Scenes/SceneCard.tsx` | Card layout + badges |
| `Scenes/OverlayCard.tsx` | `badge badge-secondary` |
| `Galleries/GalleryCard.tsx` | Card layout |
| `Images/ImageCard.tsx` | Card layout |

**Strategy**: Create a consistent pattern for all entity cards using MUI `Card` + `sx`, then apply uniformly.

#### Tier 4: Detail/Edit panels (~3 days)

| Component | Bootstrap Issues |
|-----------|-----------------|
| `Scenes/SceneDetails/SceneEditPanel.tsx` | ~12 spacing/layout classes |
| `Performers/PerformerDetails/PerformerEditPanel.tsx` | ~10 spacing classes |
| `Images/ImageDetails/ImageEditPanel.tsx` | ~8 classes |
| `Galleries/GalleryDetails/GalleryEditPanel.tsx` | ~8 classes |
| `Tags/TagDetails/TagEditPanel.tsx` | `mr-2` + TODO comments |
| `Groups/GroupDetails/GroupEditPanel.tsx` | TODO comments + spacing |
| `Studios/StudioDetails/StudioEditPanel.tsx` | Spacing |

#### Tier 5: Create pages (~1 day)

| Component | Bootstrap Issues |
|-----------|-----------------|
| `Tags/TagDetails/TagCreate.tsx` | `col-md-8`, `text-center` |
| `Studios/StudioDetails/StudioCreate.tsx` | `col-md-8`, `text-center` |
| `Groups/GroupDetails/GroupCreate.tsx` | TODO comment |
| `Performers/PerformerDetails/PerformerCreate.tsx` | Layout classes |

#### Tier 6: List pages (~1 day)

| Component | Bootstrap Issues |
|-----------|-----------------|
| `Tags/TagList.tsx` | `item-list-container`, pagination |
| `Studios/StudioList.tsx` | Same pattern |
| `Scenes/SceneList.tsx` | If applicable |
| `Performers/PerformerList.tsx` | If applicable |

#### Tier 7: Tagger subsystem — heaviest Bootstrap user (~3 days)

| Component | Bootstrap Issues | Effort |
|-----------|-----------------|--------|
| `Tagger/scenes/StudioModal.tsx` | `row`, `col-*`, `no-gutters`, `col-12`, `col-5`, `col-7` | 1.5 hr |
| `Tagger/scenes/StashSearchResult.tsx` | Layout + spacing heavy | 1 hr |
| `Tagger/scenes/PerformerResult.tsx` | `row`, `no-gutters`, `ml-2`, `col-3`, `text-right` | 45 min |
| `Tagger/scenes/StudioResult.tsx` | Same patterns | 45 min |
| `Tagger/scenes/TaggerScene.tsx` | Mixed MUI + BS | 1 hr |
| `Tagger/scenes/SceneTagger.tsx` | `mx-md-auto` | 30 min |
| `Tagger/scenes/TaggerReview.tsx` | `mx-1`, `mr-2` | 30 min |
| `Tagger/PerformerModal.tsx` | Grid layout, `ml-2`, `col-*` | 1 hr |
| `Tagger/studios/StudioTagger.tsx` | `mx-md-auto`, form groups | 1 hr |
| `Tagger/studios/StashSearchResult.tsx` | `col-6`, `mt-2`, `text-danger` | 45 min |
| `Tagger/performers/StashSearchResult.tsx` | Same | 45 min |
| `Tagger/performers/PerformerTagger.tsx` | Layout containers | 45 min |

#### Tier 8: Miscellaneous (~1 day)

| Component | Bootstrap Issues |
|-----------|-----------------|
| `Wall/WallPanel.tsx` | `w-100 row justify-content-center` |
| `Scenes/ScrapedSceneCard.tsx` | Layout + badges |
| `Scenes/ScrapedSceneCardsGrid.tsx` | Flexbox utilities |
| `Scenes/RenameScenesDialog.tsx` | Text utilities |
| `ScenePlayer/SegmentPlayer.tsx` | `d-flex`, spacing |
| `MovieFy/MovieFyQueue.tsx` | ~30 classes — heaviest single file |
| `Recommendations/` | Spacing + layout |
| Form utilities (`utils/form.tsx`) | `mb-3`, `pl-0`, `mr-2` |
| Toast hook (`hooks/Toast.tsx`) | Custom classes |

---

### Phase 3: SCSS File Cleanup (~2-3 days)

**Objective**: Remove all Bootstrap variable/mixin references from SCSS files.

After Phase 1 (removing the import) and Phase 2 (removing class usage), SCSS files may still reference Bootstrap variables.

#### 3.1 — Audit remaining Bootstrap variable usage

| Variable | Occurrences | Replacement |
|----------|------------|-------------|
| `$body-bg` | ~3 | CSS custom property `var(--bg-body)` or hard value |
| `$text-muted` / `$muted-gray` | ~5 | `var(--text-muted)` or theme token |
| `$secondary` | ~4 | `var(--color-secondary)` |
| `$danger` | ~3 | `var(--color-danger)` |
| `$card-bg` | ~3 | `var(--card-bg)` |
| `$text-color` | ~5 | `var(--text-primary)` |
| `$theme-colors` map | ~2 | Remove (no longer used by Bootstrap) |
| `$card-cap-bg` | ~1 | Inline value |
| `$grid-gap` | ~2 | Theme or CSS custom prop |

#### 3.2 — Convert to CSS custom properties

Create a `:root` block with CSS custom properties that mirror the MUI theme, so SCSS files can reference them:

```scss
:root {
  --color-primary: #52525b;
  --color-secondary: #27272a;
  --color-danger: #db3737;
  --color-success: #0f9960;
  --color-warning: #d9822b;
  --bg-body: #09090b;
  --bg-card: #18181b;
  --text-primary: #fafafa;
  --text-muted: #a1a1aa;
  --border-radius: 8px;
}
```

#### 3.3 — Consider migrating heavy SCSS files to CSS-in-JS or Tailwind

Files with heavy custom styling may benefit from migration to Tailwind or `sx`:
- `index.scss` (1460 lines) — gradually move styles to component-level
- `components/Scenes/styles.scss` — co-locate with React components
- `components/Shared/styles.scss` — co-locate

---

### Phase 4: Remove Bootstrap Package & Final Cleanup (~1 day)

#### 4.1 — Remove `bootstrap` from `package.json`

```bash
cd ui/v2.5 && pnpm remove bootstrap
```

#### 4.2 — Remove Bootstrap import from `_theme.scss`

Delete: `@import "node_modules/bootstrap/scss/bootstrap";`

#### 4.3 — Remove temporary compatibility layer

Delete `_bootstrap-compat.scss` if created in Phase 1.5.

#### 4.4 — Remove `Layouts.tsx` bridge component

If all callers have been migrated to use MUI `Grid`/`Container` directly.

#### 4.5 — Clean up related dependencies

Consider removing if no longer needed:
- `flexbin` (used for gallery layouts — verify)
- Any Bootstrap-specific PostCSS plugins

#### 4.6 — Full visual regression test

Test every major view:
- [ ] Front page / Dashboard
- [ ] Scene list + detail + edit
- [ ] Performer list + detail + edit  
- [ ] Studio list + detail + edit
- [ ] Tag list + detail + edit
- [ ] Gallery list + detail + edit
- [ ] Image list + detail + edit
- [ ] Group list + detail + edit
- [ ] Tagger (scenes, performers, studios)
- [ ] Settings (all tabs)
- [ ] Setup wizard
- [ ] Lightbox
- [ ] Scene player
- [ ] Scrape dialogs
- [ ] Merge dialogs
- [ ] Global search
- [ ] Stats page

---

## Priority Ordering (Recommended Execution Sequence)

```
Phase 0  ──→  Phase 1.1-1.2  ──→  Phase 1.5 (compat layer)  ──→  Phase 1.4 (remove import)
                                         │
                                         ▼
                                   Phase 2 (TSX migration)
                                   ├── Tier 1 (standalone)
                                   ├── Tier 2 (shared)
                                   ├── Tier 3 (cards)
                                   ├── Tier 4 (edit panels)
                                   ├── Tier 5 (create pages)
                                   ├── Tier 6 (list pages)
                                   ├── Tier 7 (tagger)
                                   └── Tier 8 (misc)
                                         │
                                         ▼
                                   Phase 3 (SCSS cleanup)
                                         │
                                         ▼
                                   Phase 4 (remove package)
```

**Alternative approach**: If you prefer incremental safety, keep the Bootstrap import and compat layer throughout Phase 2, then do Phases 1, 3, and 4 together at the end as a single "cut-over" PR.

---

## Estimated Total Effort

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 0 (prep) | 1–2 days | Low |
| Phase 1 (SCSS foundation) | 3–5 days | **High** — breaking change |
| Phase 2 (TSX migration) | 2–3 weeks | Medium — incremental |
| Phase 3 (SCSS cleanup) | 2–3 days | Low |
| Phase 4 (final removal) | 1 day | Low (if preceded by testing) |
| **Total** | **~4–5 weeks** | |

---

## Files-at-a-Glance: Complete Migration Checklist

### SCSS Files (16 files, ~106 Bootstrap refs)

- [ ] `src/styles/_theme.scss` — **Bootstrap import + variables**
- [ ] `src/index.scss` — Media-query mixins (~13)
- [ ] `src/components/Scenes/styles.scss` (~12 mixins)
- [ ] `src/components/Shared/styles.scss` (~12 mixins)
- [ ] `src/components/Studios/styles.scss` (~6 mixins)
- [ ] `src/components/Galleries/styles.scss` (~6 mixins)
- [ ] `src/components/Tags/styles.scss` (~5 mixins)
- [ ] `src/components/Playlists/PlaylistPlayer.scss` (~5 mixins)
- [ ] `src/components/Tagger/styles.scss` (~4 mixins)
- [ ] `src/components/Settings/styles.scss` (~3 mixins)
- [ ] `src/components/Performers/styles.scss` (~2 mixins)
- [ ] `src/components/Recommendations/styles.scss` (~2 mixins)
- [ ] `src/components/Groups/styles.scss`
- [ ] `src/components/Images/styles.scss`
- [ ] `src/components/ScenePlayer/styles.scss`
- [ ] `src/components/FrontPage/styles.scss`

### TSX Files — Top 30 Most Affected

- [ ] `components/MovieFy/MovieFyQueue.tsx` (~30 classes)
- [ ] `components/Tagger/scenes/StudioModal.tsx` (~10)
- [ ] `components/Tagger/scenes/StashSearchResult.tsx` (~10)
- [ ] `components/Tagger/studios/StashSearchResult.tsx` (~15)
- [ ] `components/Tagger/performers/StashSearchResult.tsx` (~12)
- [ ] `components/Tagger/scenes/PerformerResult.tsx` (~10)
- [ ] `components/Tagger/scenes/StudioResult.tsx` (~10)
- [ ] `components/Shared/StashBoxIDSearchModal.tsx` (~12)
- [ ] `components/Scenes/SceneDetails/SceneEditPanel.tsx` (~12)
- [ ] `components/Performers/PerformerDetails/PerformerEditPanel.tsx` (~10)
- [ ] `components/ScenePlayer/SegmentPlayer.tsx` (~10)
- [ ] `components/Stats.tsx` (~8)
- [ ] `components/Scenes/ScrapedSceneCard.tsx` (~8)
- [ ] `components/Images/ImageDetails/ImageEditPanel.tsx` (~8)
- [ ] `components/Galleries/GalleryDetails/GalleryEditPanel.tsx` (~8)
- [ ] `components/Tagger/PerformerModal.tsx` (~8)
- [ ] `components/Tagger/scenes/TaggerScene.tsx` (~8)
- [ ] `components/Shared/ScrapeDialog/ScrapeDialogRow.tsx` (~8)
- [ ] `components/Shared/ScrapeDialog/ScrapedObjectsRow.tsx` (~6)
- [ ] `components/Wall/WallPanel.tsx` (~5)
- [ ] `components/Tags/TagMergeDialog.tsx` (~5)
- [ ] `components/Tags/TagDetails/TagCreate.tsx` (~4)
- [ ] `components/Studios/StudioDetails/StudioCreate.tsx` (~4)
- [ ] `components/Shared/Sidebar.tsx` (~4)
- [ ] `components/Shared/Select.tsx` (~3)
- [ ] `components/Shared/URLField.tsx` (~3)
- [ ] `components/Shared/CollapseButton.tsx` (~3)
- [ ] `components/Shared/ImageSelector.tsx` (~3)
- [ ] `utils/form.tsx` (~3)
- [ ] `hooks/Toast.tsx` (~2)

---

## Migration Pattern Examples

### Spacing: Bootstrap → MUI `sx`

```tsx
// Before
<div className="mb-3 mt-2 ml-1">

// After (MUI sx)
<Box sx={{ mb: 3, mt: 2, ml: 1 }}>

// After (Tailwind) 
<div className="mb-3 mt-2 ml-1">  // Same names! But ensure Tailwind generates them
```

### Layout: Bootstrap row/col → MUI Grid

```tsx
// Before
<div className="row no-gutters align-items-center">
  <div className="col-5">Label</div>
  <div className="col-7">Value</div>
</div>

// After
<Grid container spacing={0} alignItems="center">
  <Grid size={{ xs: 5 }}>Label</Grid>
  <Grid size={{ xs: 7 }}>Value</Grid>
</Grid>
```

### Text: Bootstrap utilities → MUI Typography

```tsx
// Before
<span className="text-muted small">Some text</span>

// After
<Typography variant="body2" color="text.secondary">Some text</Typography>
```

### Display: Bootstrap → MUI sx

```tsx
// Before
<div className="d-flex justify-content-between align-items-center">

// After
<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
// OR
<Stack direction="row" justifyContent="space-between" alignItems="center">
```

### Form: Bootstrap → MUI

```tsx
// Before  
<input className="form-control" type="text" />

// After
<TextField fullWidth variant="outlined" />
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Visual regressions after removing Bootstrap | Phase 1.5 compatibility layer; visual regression testing |
| Spacing scale mismatch (BS uses rem, MUI uses 8px units) | Document exact mapping; verify each component |
| SCSS files break without Bootstrap variables | Phase 1.1 extracts all used variables first |
| Large PR size | Break into per-tier PRs; each tier is independently shippable |
| Tailwind + MUI `sx` inconsistency | Establish convention in Phase 0.3; enforce via linting |
| Performance regression from removing CSS | MUI CssBaseline + Tailwind cover all resets; measure bundle size before/after |
