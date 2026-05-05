# MUI Quirks & Workarounds

A collection of non-obvious MUI behaviour and the fixes we've applied.

---

## Menu / Popover — dark overlay on open

**Symptom:** Opening a `<Menu>` causes the rest of the page to darken (the Modal backdrop renders with its default semi-transparent black colour).

**Root cause:** MUI's `Menu` is built on `Modal`, which renders a `Backdrop` component by default. The backdrop intercepts pointer events and applies `background-color: rgba(0,0,0,0.5)` via the theme.

**Fix:** Pass `disableScrollLock` and override the backdrop styles to be fully transparent via `slotProps`. The backdrop must remain in the DOM so that click-outside detection (which fires `onClose`) continues to work — that rules out `hideBackdrop`.

```tsx
<Menu
  anchorEl={anchorEl}
  open={open}
  onClose={handleClose}
  disableScrollLock
  slotProps={{
    backdrop: {
      sx: { backgroundColor: "transparent", backdropFilter: "none" },
    },
  }}
>
```

**Why not `hideBackdrop`?** Removing the backdrop element entirely also removes the click-outside listener, so the menu can no longer be dismissed by clicking away.

**Why not `invisible: true` on Backdrop?** MUI's `invisible` prop only suppresses the transition; the theme colour still applies in MUI v7.

**Established precedent in this codebase:** `SavedFilterList.tsx` (`SavedFilterDropdown`).

---

## Menu / Popover — page scroll locked while menu is open

**Symptom:** When a `<Menu>` opens, the page body scroll is locked (a `padding-right` is added to the body to compensate for the scrollbar disappearing).

**Fix:** Add `disableScrollLock` to the `<Menu>` (same prop as above). This is safe for menus that are anchored to a button because they don't need the page to be non-scrollable.

```tsx
<Menu ... disableScrollLock>
```
