# Vexxx Styling Plan

A roadmap for applying semantic `vexxx-` CSS classes across the Vexxx (Stash fork) UI.

## Philosophy
- **MUI for Structure**: Grid, layout, accessibility.
- **SCSS for Theming**: Colors, borders, visual polish via `vexxx-` classes.
- **User Customizable**: Stable class names allow custom themes without breaking layouts.

---

## Phase 1: Pilot (Complete ✅)
| Component | Classes |
| :--- | :--- |
| `GroupSceneTable` | `.vexxx-scene-list-*` |
| `DetailImage` | `.vexxx-detail-image` |
| `Alert` | `.vexxx-alert-*` |
| `LoadingIndicator` | `.vexxx-loading-*` |

---

## Phase 2: High-Visibility Components (Complete ✅)

### Cards
| Component | Classes Applied |
| :--- | :--- |
| `SceneCard` | `.vexxx-scene-card` |
| `PerformerCard` | `.vexxx-performer-card` |
| `GroupCard` | `.vexxx-group-card` |

### Navigation
| Component | Classes Applied |
| :--- | :--- |
| `Sidebar` | `.vexxx-sidebar` |
| `MainNavbar` | `.vexxx-navbar` |

### Forms
| Component | Classes Applied |
| :--- | :--- |
| `FilterSelect` | `.vexxx-filter-select` |
| `DateInput` | `.vexxx-date-input` |

---

## Phase 3: Remaining Shared Components (Planned)
- `HoverPopover`, `TagLink`, `RatingBanner`, `CountButton`, etc.

---

## SCSS Location
All `vexxx-` classes are defined in:
`ui/v2.5/src/components/Shared/styles.scss`

---

## Custom Theme Guide
Users can override any `vexxx-` class in **Settings > Interface > Custom CSS**:
```css
.vexxx-scene-card {
  border: 2px solid gold;
}
```
