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
  /**
   * Filter the immersive Home grid by a studio/performer/tag, or clear (id
   * omitted). `label` lets callers outside the rail (e.g. an info-panel chip
   * drill-down) supply the display name directly when it can't be resolved from
   * the cached rail lists.
   */
  | {
      type: "setHomeFilter";
      kind: "studio" | "performer" | "tag" | null;
      id?: string;
      label?: string;
    }
  /** Switch the Home wall's media-type filter (all / VR / 2D / funscript). */
  | { type: "setMediaFilter"; filter: "all" | "vr" | "flat" | "funscript" }
  /** Change the Home grid sort order (handled in-manager → re-queries the pager). */
  | { type: "setHomeSort"; sort: "recent" | "rating" | "title" }
  /** Toggle an immersive Home preference (persisted React-side). */
  | { type: "setVrSetting"; key: "hoverLaunch" | "soundOnPlay"; value: boolean }
  /** Set the gaze-dwell auto-launch delay in ms (persisted React-side). */
  | { type: "setVrDwellMs"; ms: number }
  // ── Galleries (immersive Home content mode + XR gallery viewer) ─────────
  /** Switch the Home wall between the Scenes, Galleries and Movies grids. */
  | { type: "setContentMode"; mode: "scenes" | "galleries" | "movies" }
  /** Open the XR gallery viewer for a gallery (thumbnail grid sub-view). */
  | { type: "openGallery"; galleryId: string; title?: string }
  /** Close the gallery viewer and return to the Home wall. */
  | { type: "closeGallery" }
  // ── Movies / Groups (immersive Home content mode, in-wall drill-down) ───
  /**
   * Drill into a movie/group: scope the group library's scene paging to this
   * group so the Home wall's grid shows that movie's scenes (handled in-manager).
   */
  | { type: "openGroup"; groupId: string; title?: string }
  /** Leave the movie scene grid and return to the movie poster grid. */
  | { type: "closeGroup" }
  /** Open a single image full-size (lightbox) from the gallery grid. */
  | { type: "galleryImageOpen"; index: number }
  /** Step to the previous/next image while the lightbox is open. */
  | { type: "galleryImageNav"; dir: 1 | -1 }
  /** Close the lightbox and return to the gallery thumbnail grid. */
  | { type: "galleryImageClose" }
  /** Toggle slideshow auto-advance on/off. */
  | { type: "galleryImageSlideshowToggle" }
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
  filter: { kind: "studio" | "performer" | "tag"; id: string } | null;
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

// ── Galleries: server-backed library for the Home wall + XR gallery viewer ──
// Mirrors the scene library: galleries are paged/sorted/filtered on the server
// (so the wall scales to any library size), and an active gallery's images are
// paged on demand for the thumbnail grid + lightbox.

/** A gallery cover tile rendered in the Home wall's Galleries grid. */
export interface IVRGalleryEntry {
  id: string;
  title: string;
  /** Cover image URL (paths.cover), or null when the gallery has no cover. */
  coverUrl: string | null;
  /** Number of images in the gallery (drives the count badge). */
  imageCount: number;
  studioName: string | null;
  studioLogoUrl?: string | null;
  /** Gallery rating 0–100 (rating100). */
  rating?: number | null;
  /** ISO date string from the gallery `date` field. */
  date?: string | null;
  performers: string[];
  performerDetails?: { id: string; name: string; imageUrl: string | null }[];
  tags?: { id: string; name: string }[];
}

/** A single image within a gallery, rendered as a thumbnail / lightbox plane. */
export interface IVRGalleryImageEntry {
  id: string;
  title: string;
  /** Small thumbnail URL (paths.thumbnail) for the grid. */
  thumbnailUrl: string | null;
  /** Full-size image URL (paths.image) for the lightbox. */
  imageUrl: string | null;
  previewUrl?: string | null;
  width?: number | null;
  height?: number | null;
}

/** One page of gallery tiles plus the total count for pager geometry. */
export interface IVRGalleryPageResult {
  gen: number;
  pageIndex: number;
  galleries: IVRGalleryEntry[];
  totalCount: number;
}

/** One page of a gallery's images plus the total count for pager geometry. */
export interface IVRGalleryImagePageResult {
  gen: number;
  pageIndex: number;
  images: IVRGalleryImageEntry[];
  totalCount: number;
}

/**
 * Server-backed gallery library. The Galleries grid reuses the Home query's
 * sort + studio/performer/tag filter (media toggle is irrelevant to galleries),
 * so `setQuery` takes the same [IVRHomeQuery]. Image paging is scoped to the
 * gallery set via [setActiveGallery] and likewise generation-guarded.
 */
export interface IVRGalleryDataSource {
  /** Apply a new gallery query (sort + studio/performer/tag); bumps + returns gen. */
  setQuery(q: IVRHomeQuery): number;
  /** Current generation (bumped on each setQuery / setActiveGallery). */
  readonly gen: number;
  /** Fetch a grid page of gallery tiles under the current query. */
  getGalleryPage(pageIndex: number): Promise<IVRGalleryPageResult>;
  /** Total galleries matching the current query. */
  getGalleryTotal(): Promise<number>;
  /** Scope subsequent image paging to a gallery; bumps the image generation. */
  setActiveGallery(galleryId: string | null): number;
  /** Fetch a grid page of the active gallery's images. */
  getImagePage(pageIndex: number): Promise<IVRGalleryImagePageResult>;
  /** Total images in the active gallery. */
  getImageTotal(): Promise<number>;
}

// ── Movies / Groups: server-backed library for the Home wall's Movies mode ──
// Movies mode has two layers on the single Home wall: a poster grid of groups,
// and — once a group is drilled into — that group's scenes rendered with the
// same scene cards as the Scenes grid. Groups are paged/sorted/filtered on the
// server via `findGroups`; a drilled-in group's scenes are fetched in one
// `findScenes` call (groups have few scenes) and ordered by `scene_index`, with
// a server-order fallback for scenes that carry no index.

/** A movie/group poster tile rendered in the Home wall's Movies grid. */
export interface IVRGroupEntry {
  id: string;
  title: string;
  /** Front cover / poster URL (front_image_path), or null when absent. */
  posterUrl: string | null;
  /** Back cover URL (back_image_path), or null when absent. */
  backUrl: string | null;
  /** Number of scenes in the group (drives the count badge). */
  sceneCount: number;
  studioName: string | null;
  /** Group rating 0–100 (rating100). */
  rating?: number | null;
  /** ISO date string from the group `date` field. */
  date?: string | null;
}

/** One page of movie poster tiles plus the total count for pager geometry. */
export interface IVRGroupPageResult {
  gen: number;
  pageIndex: number;
  groups: IVRGroupEntry[];
  totalCount: number;
}

/** One page of an active group's scenes plus the total count for pager geometry. */
export interface IVRGroupScenePageResult {
  gen: number;
  pageIndex: number;
  scenes: IVRSceneEntry[];
  totalCount: number;
}

/**
 * Server-backed movie/group library. The Movies grid reuses the Home query's
 * sort + studio/performer filter (the media toggle is irrelevant to groups), so
 * `setQuery` takes the same [IVRHomeQuery]. Scene paging is scoped to a drilled-
 * in group via [setActiveGroup] and ordered by `scene_index`; both layers are
 * generation-guarded so stale results landing after a switch are dropped.
 */
export interface IVRGroupDataSource {
  /** Apply a new group query (sort + studio/performer); bumps + returns gen. */
  setQuery(q: IVRHomeQuery): number;
  /** Current generation (bumped on each setQuery / setActiveGroup). */
  readonly gen: number;
  /** Fetch a grid page of movie poster tiles under the current query. */
  getGroupPage(pageIndex: number): Promise<IVRGroupPageResult>;
  /** Total groups matching the current query. */
  getGroupTotal(): Promise<number>;
  /** Scope subsequent scene paging to a group; bumps the scene generation. */
  setActiveGroup(groupId: string | null): number;
  /** Fetch a grid page of the active group's scenes (ordered by scene_index). */
  getScenePage(pageIndex: number): Promise<IVRGroupScenePageResult>;
  /** Total scenes in the active group. */
  getSceneTotal(): Promise<number>;
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
