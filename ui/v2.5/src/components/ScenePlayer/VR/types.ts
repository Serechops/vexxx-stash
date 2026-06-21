/**
 * Shared types for the immersive WebXR VR scene player.
 *
 * These are intentionally framework-agnostic (no three.js / WebXR imports) so
 * they can be shared between the React layer, the session manager and the
 * canvas-drawn control panel without creating import cycles.
 */

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
  | { type: "handySync" };

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
