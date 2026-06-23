/**
 * Shared types for the immersive WebXR VR scene player.
 *
 * These are intentionally framework-agnostic (no three.js / WebXR imports) so
 * they can be shared between the React layer, the session manager and the
 * canvas-drawn control panel without creating import cycles.
 */
// Type-only import — erased at runtime, so no module cycle is created.
import type { IVRSceneEntry } from "./VRScenesPanel";

/** A snapshot of the underlying <video> element, pulled each render frame. */
export interface IVRPlaybackState {
  paused: boolean;
  /** Seconds. */
  currentTime: number;
  /** Seconds. NaN/0 until metadata loads. */
  duration: number;
  /** 0..1 */
  volume: number;
  muted: boolean;
  playbackRate: number;
  /** Seconds buffered ahead of currentTime (for the scrubber buffer bar). */
  bufferedAhead: number;
  /** True while the media is seeking/stalled (shows a spinner hint). */
  waiting: boolean;
  captionsOn: boolean;
}

/** A scene marker projected onto the VR scrubber + chapter list. */
export interface IVRMarker {
  title: string;
  seconds: number;
  endSeconds: number | null;
  /** CSS colour string for the tick, when known. */
  color?: string;
}

/**
 * Every interactive control surface emits one of these. The React layer
 * ([ImmersiveVRPlayer]) is the single place that mutates the video element /
 * projection state, keeping GL + DOM ownership cleanly separated.
 */
export type VRControlAction =
  | { type: "playpause" }
  /** Absolute seek to a fraction (0..1) of duration — scrubber drag/click. */
  | { type: "seekFraction"; fraction: number }
  /** Relative skip in seconds (± buttons / thumbstick). */
  | { type: "seekRelative"; seconds: number }
  | { type: "setVolume"; value: number }
  | { type: "toggleMute" }
  | { type: "setRate"; value: number }
  | { type: "cycleFov" }
  | { type: "cycleStereo" }
  | { type: "toggleSwapEyes" }
  | { type: "setZoom"; value: number }
  | { type: "recenter" }
  | { type: "nextMarker" }
  | { type: "prevMarker" }
  | { type: "seekSeconds"; seconds: number }
  | { type: "toggleCaptions" }
  | { type: "next" }
  | { type: "previous" }
  | { type: "exit" }
  /** Toggle the collapsible compact Handy panel (left side, handled in-manager). */
  | { type: "handyPanelToggle" }
  /** Toggle the Browse side panel (Info + Scenes tabs, handled in-manager). */
  | { type: "browsePanelToggle" }
  /** Switch the active Browse tab (handled in-manager). */
  | { type: "browseSetTab"; tab: "info" | "scenes" }
  /** Navigate to a different scene from the VR scenes panel. */
  | { type: "navigateToScene"; sceneId: string }
  /** Switch to a different scene while staying in the active XR session. */
  | { type: "switchScene"; sceneId: string }
  /** Return to the immersive Home/lobby wall (pause playback, show the gallery). */
  | { type: "goHome" }
  /** Filter the immersive Home grid by a studio/performer, or clear (id omitted). */
  | { type: "setHomeFilter"; kind: "studio" | "performer" | null; id?: string }
  /** Switch the Home wall's media-type filter (all / VR / 2D / funscript). */
  | { type: "setMediaFilter"; filter: "all" | "vr" | "flat" | "funscript" }
  /** Change the Home grid sort order (handled in-manager → re-queries the pager). */
  | { type: "setHomeSort"; sort: "recent" | "rating" | "title" }
  /** Toggle an immersive Home preference (persisted React-side). */
  | { type: "setVrSetting"; key: "hoverLaunch" | "soundOnPlay"; value: boolean }
  /** Set the gaze-dwell auto-launch delay in ms (persisted React-side). */
  | { type: "setVrDwellMs"; ms: number }
  // ── Handy interactive device ───────────────────────────────────────────
  | { type: "handyToggle" }
  | { type: "handyPatternStart"; patternId: string }
  | { type: "handyPatternStop" }
  | { type: "handyEmergencyStop" }
  | { type: "handyConnect" }
  | { type: "handySync" }
  /** Set the device stroke-zone envelope (min/max, each 0..1) from the VR panel. */
  | { type: "setHandyStroke"; min: number; max: number };

/**
 * Confirmation state for an in-VR stroke-zone change, surfaced on the Handy
 * panel so the user gets feedback that the server accepted the new range.
 *  - `pending`   — request dispatched, awaiting the device/server response
 *  - `confirmed` — server acknowledged the new range (brief flash, auto-clears)
 *  - `error`     — the request failed; range may not have applied
 */
export type VRStrokeStatus = "idle" | "pending" | "confirmed" | "error";

/**
 * User-adjustable immersive-Home preferences (set in-headset via the gear panel,
 * persisted React-side to localStorage). Pushed into [VRHomePanel] for rendering
 * the toggle states and driving gaze-dwell timing.
 */
export interface IVRHomeSettings {
  /** Gaze at a card for `dwellMs` to auto-launch it (false = tap only). */
  hoverLaunch: boolean;
  /** Gaze-dwell duration before auto-launch, in milliseconds. */
  dwellMs: number;
  /** Play scene audio when a scene launches (false = start muted). */
  soundOnPlay: boolean;
}

/** Sensible defaults — dwell deliberately slower than the old 1.4 s. */
export const DEFAULT_VR_HOME_SETTINGS: IVRHomeSettings = {
  hoverLaunch: true,
  dwellMs: 2500,
  soundOnPlay: true,
};

// ── Immersive Home wall: server-backed library data source ──────────────────
// The Home wall scales to libraries of any size by paging + filtering on the
// server rather than loading the whole library into memory. These types are the
// contract between the React-side pager ([VRHomeLibrary]) and the session
// manager, which orchestrates page/rail/count requests for [VRHomePanel].

/** Home media-type toggle. */
export type VRMediaFilter = "all" | "vr" | "flat" | "funscript";
/** Home grid sort order. */
export type VRSortMode = "recent" | "rating" | "title";

/** A studio/performer tile in the Home filter rail. */
export interface IVRFilterEntry {
  id: string;
  name: string;
  imageUrl: string | null;
  count: number;
}

/** The current Home query: sort + media toggle + optional studio/performer. */
export interface IVRHomeQuery {
  sort: VRSortMode;
  mediaFilter: VRMediaFilter;
  filter: { kind: "studio" | "performer"; id: string } | null;
}

/** One page of grid scenes plus the total count for pager geometry. */
export interface IVRHomePageResult {
  /** Generation the page was fetched under — stale results (gen mismatch) are dropped. */
  gen: number;
  /** Absolute page index this result is for. */
  pageIndex: number;
  scenes: IVRSceneEntry[];
  /** Total scenes matching the current query (drives the page count). */
  totalCount: number;
}

/** Per-media-type counts for the rail toggle, under the active studio/performer filter. */
export interface IVRHomeCounts {
  all: number;
  vr: number;
  flat: number;
  funscript: number;
}

/** Top studios + performers for the filter rail. */
export interface IVRHomeRail {
  studios: IVRFilterEntry[];
  performers: IVRFilterEntry[];
}

/**
 * The server-backed Home library, implemented React-side over Apollo and
 * consumed by the session manager. All methods are query-state aware: callers
 * set the query once via [setQuery] (which returns the new generation), then
 * request pages / counts / rail under it.
 */
export interface IVRHomeDataSource {
  /** Apply a new query; clears caches, returns the new generation counter. */
  setQuery(q: IVRHomeQuery): number;
  /** The current generation (bumped on each setQuery). */
  readonly gen: number;
  /** Fetch a grid page (4×3) under the current query. */
  getPage(pageIndex: number): Promise<IVRHomePageResult>;
  /** Media-type counts under the active studio/performer filter (ignores media toggle). */
  getCounts(): Promise<IVRHomeCounts>;
  /** Top studios + performers for the rail (independent of the current query). */
  getRail(): Promise<IVRHomeRail>;
  /** Resolve the scene id that follows `currentId` in the current order, for auto-advance. */
  getNextSceneId(currentId: string): Promise<string | null>;
}

/** Handy device connection state, pulled each frame alongside playback. */
export interface IVRHandyState {
  status:
    | "missing"
    | "disconnected"
    | "connecting"
    | "syncing"
    | "uploading"
    | "ready"
    | "error";
  /** Human-readable label, e.g. "Ready" or "Error: ..." */
  label: string;
  /** Whether the connection key is configured in settings. */
  configured: boolean;
}
