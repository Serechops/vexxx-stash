# ScenePlayer Upgrades

Tracking document for planned improvements to `ui/v2.5/src/components/ScenePlayer/`.

---

## Status Key

| Symbol | Meaning |
|--------|---------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Done |

---

## Upgrade 1 — Retire `SegmentPlayer`, route all scenes through `ScenePlayer` ✅

**Priority**: High — correctness / feature parity

### Problem
`Scene.tsx` routes virtual scenes (`start_point > 0 || end_point > 0`) through the separate
`SegmentPlayer.tsx` (196 lines, raw `<video>` + MUI buttons). This player lacks:
- Keyboard hotkeys
- VTT sprite thumbnails
- Marker dots on progress bar
- Rating button
- Source selector (quality switch)
- A/B loop
- Interactive / Handy support
- Chromecast / AirPlay
- Autostart toggle
- Play count / activity tracking
- Scrubber momentum scrolling

`ScenePlayer` already handles virtual scenes correctly — it has `isVirtual`,
`virtualStart`, `virtualEnd`, and enforces segment bounds in the `timeupdate` handler.

### Plan
1. **`Scene.tsx`** — remove the `isSegment` branch; always render `<ScenePlayer>`.
2. **`SegmentPlayer.tsx`** — delete the file.
3. **`ScenePlayer` virtual progress bar** — currently hides the native VideoJS progress
   control (`progressControl: !isVirtual`) because it would show file-relative time.
   Instead, keep it visible but override displayed time/duration to show segment-relative
   values using the existing `virtualStart`/`virtualEnd` bounds. Add a custom time display
   plugin or patch the `vjs-current-time` / `vjs-duration` elements via the existing
   `timeupdate` event.
4. Verify scrubber `start`/`end` props already pass segment bounds (they do: `Scene.tsx`
   passes `start={scene.start_point ?? 0}` / `end={scene.end_point ?? file.duration}`).

### Files
- `ui/v2.5/src/components/Scenes/SceneDetails/Scene.tsx`
- `ui/v2.5/src/components/ScenePlayer/SegmentPlayer.tsx` ← delete
- `ui/v2.5/src/components/ScenePlayer/ScenePlayer.tsx` (virtual progress display)

---

## Upgrade 2 — Marker ticks on the sprite scrubber ✅

**Priority**: High — discoverability / navigation UX

### Problem
Markers are rendered as colored dots on the VideoJS progress bar (via `markers.ts`
`addDotMarkers`) but the `ScenePlayerScrubber` below shows no marker positions at all.
The scrubber is wider than the progress bar and is the primary seek surface for long
content — markers there would be far more useful.

### Plan
1. **`ScenePlayerScrubber.tsx`** — accept a new optional prop:
   ```tsx
   markers?: Array<{ seconds: number; title: string; color?: string }>
   ```
2. Compute each marker's `left` offset as a percentage of `scrubWidth` (reuse the same
   percentage calculation already done for the position ref).
3. Render a `<Box>` overlay per marker: small colored vertical line (3 px wide, full
   scrubber height) with a `Tooltip` showing `title`. Use the marker color if available,
   otherwise `theme.palette.primary.main`.
4. **`ScenePlayer.tsx`** — pass `scene.scene_markers` mapped to `{ seconds, title }`
   down to `<ScenePlayerScrubber>`.

### Files
- `ui/v2.5/src/components/ScenePlayer/ScenePlayerScrubber.tsx`
- `ui/v2.5/src/components/ScenePlayer/ScenePlayer.tsx`

---

## Upgrade 3 — Live chapter/marker name overlay during playback ✅

**Priority**: Medium — immersion / context

### Problem
There is no on-screen indication of what scene chapter the current timestamp is in,
even though marker data is already loaded and `time` state is kept in sync.

### Plan
1. **`ScenePlayer.tsx`** — derive `activeMarker` from `time` and `scene.scene_markers`:
   ```ts
   const activeMarker = useMemo(() => {
     return [...scene.scene_markers]
       .reverse()
       .find(m => time >= m.seconds) ?? null;
   }, [time, scene.scene_markers]);
   ```
2. Render a fading `<Typography>` overlay in the bottom-left of the video wrapper
   (above the control bar, z-index below `vjs-control-bar`). Use a CSS transition on
   `opacity` so it fades in when the marker changes and fades out after 3 s.
3. Only display when the player is active (`vjs-user-active`) so it doesn't clutter
   a paused screenshot.

### Files
- `ui/v2.5/src/components/ScenePlayer/ScenePlayer.tsx`
- `ui/v2.5/src/components/ScenePlayer/styles.scss`

---

## Upgrade 4 — URL timestamp sync (`?t=`) ⬜

**Priority**: Medium — shareability

### Problem
Navigating to `/scenes/42` always starts from the saved resume position (or beginning).
There is no way to share a link to a specific moment.

### Plan
1. On mount, parse `?t=<seconds>` from `window.location.search` and pass it as
   `initialTimestamp` (the prop already exists and is wired to `player.currentTime()`
   on `ready`).
2. On `timeupdate` (throttled to once per second via `useRef` debounce), call
   `history.replaceState` to update `?t=<Math.floor(time)>` without triggering a
   re-render or navigation.
3. Clear `?t` param when the scene ends / changes.
4. The implementation belongs in the `Scene.tsx` page component, which owns routing,
   not inside `ScenePlayer` itself — keeps the player stateless w.r.t. URL.

### Files
- `ui/v2.5/src/components/Scenes/SceneDetails/Scene.tsx`

---

## Upgrade 5 — Keyboard shortcuts help overlay (`?` key) ✅

**Priority**: Medium — discoverability

### Problem
`handleHotkeys` in `ScenePlayer.tsx` implements ~15 keyboard shortcuts (seek, volume,
fullscreen, A/B loop, percent seek, gallery, etc.) but there is no way for users to
discover them. No tooltip, no modal, no `?` key.

### Plan
1. Add `case 191` (`?` / `/`) to `handleHotkeys` — call `player.trigger('show-shortcuts')`.
2. In `ScenePlayer.tsx`, listen for `show-shortcuts` and toggle a `showShortcuts` state.
3. Render a MUI `Dialog` (or a `Popover` anchored to the player container) listing all
   shortcuts in a two-column table.
4. The complete shortcut list:

   | Key | Action |
   |-----|--------|
   | `Space` / `Enter` | Play / Pause |
   | `→` / `←` | +10s / −10s |
   | `Shift+→` / `Shift+←` | +5s / −5s |
   | `Ctrl+→` / `Ctrl+←` | +60s / −60s |
   | `]` / `[` | +10% / −10% |
   | `1`–`9` | Jump to 10%–90% |
   | `0` | Jump to start |
   | `↑` / `↓` | Volume +10% / −10% |
   | `M` | Mute toggle |
   | `F` | Fullscreen toggle |
   | `L` | A/B loop toggle |
   | `Shift+L` | Player loop toggle |
   | `G` | Open gallery creator |
   | `?` | Show this help |

### Files
- `ui/v2.5/src/components/ScenePlayer/ScenePlayer.tsx`

---

## Upgrade 6 — A/B loop region band on the progress bar ⬜

**Priority**: Low — power-user polish

### Problem
When an A/B loop is active the control bar shows no visual indication of the loop
region. Users set it blindly and must rely on `abLoopPlugin` button state alone.

### Plan
1. In `ScenePlayer.tsx`, listen on `player.on('abloopupdate', ...)` (the event fired by
   `videojs-abloop` whenever options change).
2. Derive `loopStart` and `loopEnd` as percentages of file duration.
3. Inject a `<div class="vjs-ab-loop-band">` inside `.vjs-progress-holder` via
   `player.el()` — positioned absolutely with `left: X%` and `width: (Y−X)%`.
4. Style it in `styles.scss`: semi-transparent accent fill, 4 px tall (matching the
   progress bar height), pulsing outline animation while active.

### Files
- `ui/v2.5/src/components/ScenePlayer/ScenePlayer.tsx`
- `ui/v2.5/src/components/ScenePlayer/styles.scss`

---

## Upgrade 7 — Playback speed keyboard shortcut ✅

**Priority**: Low — quality of life

### Problem
`playbackRates` is set to `[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]` but there is no
keyboard shortcut to step through rates. Users must click the rate control.

### Plan
Add to `handleHotkeys`:
- `>` (Shift+`.`, keyCode 190) → next rate up
- `<` (Shift+`,`, keyCode 188) → next rate down

Derive next rate by finding the current rate in the `playbackRates` array and
incrementing/decrementing the index.

### Files
- `ui/v2.5/src/components/ScenePlayer/ScenePlayer.tsx`

---

## Upgrade 8 — Theme-consistent CSS custom properties ⬜

**Priority**: Low — visual consistency

### Problem
`styles.scss` hardcodes colors (`rgba(0,0,0,0.4)`, `#1976d2`, `rgba(255,255,255,0.15)`)
that do not automatically update when the MUI theme switches between dark/light or when
the user changes the accent color. `var(--primary-color, #1976d2)` is used inconsistently.

### Plan
1. At theme initialization (likely `App.tsx` or `ThemeProvider`), emit MUI palette values
   as CSS custom properties on `:root`:
   ```ts
   document.documentElement.style.setProperty('--primary-color', theme.palette.primary.main);
   document.documentElement.style.setProperty('--surface-overlay', theme.palette.mode === 'dark'
     ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.3)');
   ```
2. Replace all raw hex/rgba literals in `styles.scss` that map to theme values with
   `var(--primary-color)`, `var(--surface-overlay)`, etc.

### Files
- `ui/v2.5/src/components/ScenePlayer/styles.scss`
- `ui/v2.5/src/App.tsx` (or theme provider)

---

## Order of Implementation

```
1. Upgrade 1  (SegmentPlayer retirement)     — biggest correctness gain
2. Upgrade 2  (scrubber marker ticks)        — visible UX improvement
3. Upgrade 3  (live chapter overlay)         — low-effort, high feel
4. Upgrade 5  (keyboard shortcut help)       — discoverability
5. Upgrade 4  (URL ?t= sync)                 — shareability
6. Upgrade 7  (speed hotkeys)                — trivial, add during Upgrade 5
7. Upgrade 6  (A/B loop band)                — power-user polish
8. Upgrade 8  (CSS tokens)                   — housekeeping last
```
