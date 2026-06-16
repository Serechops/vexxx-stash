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
  /** Toggle the panel between head-following and pinned/draggable. */
  | { type: "toggleLock" }
  | { type: "nextMarker" }
  | { type: "prevMarker" }
  | { type: "seekSeconds"; seconds: number }
  | { type: "toggleCaptions" }
  | { type: "next" }
  | { type: "previous" }
  | { type: "exit" };
