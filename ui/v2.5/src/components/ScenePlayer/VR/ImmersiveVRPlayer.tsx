/**
 * ImmersiveVRPlayer — React root for the immersive WebXR session.
 *
 * Owns the <video> element (source selection, captions), the projection state
 * and all action handling, and bridges to the imperative [XRSessionManager].
 * Lazy-loaded by [EnterVRButton] so three.js never enters the main bundle.
 */
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import { useHistory } from "react-router-dom";
import * as GQL from "src/core/generated-graphql";
import { getClient } from "src/core/StashService";
import { languageMap } from "src/utils/caption";
import { generateFunscriptWaveform } from "src/utils/funscriptWaveform";
import { Icon } from "src/components/Shared/Icon";
import {
  faVrCardboard,
  faExclamationTriangle,
} from "@fortawesome/free-solid-svg-icons";
import { XRSessionManager } from "./xrSession";
import { VRThumbnails } from "./vttThumbnails";
import { IVRSceneInfo } from "./VRInfoPanels";
import { useVRPlayback } from "./useVRPlayback";
import { VRHomeLibrary } from "./vrHomeLibrary";
import { FapTapHomeLibrary, buildFapSceneFragment } from "./faptapLibrary";
import {
  PmvHavenHomeLibrary,
  buildPmvSceneFragment,
  pmvhavenFunscriptPending,
} from "./pmvhavenLibrary";
import { getPlatformURL } from "src/core/createClient";
import { sceneSupportsAlphaPassthrough } from "./passthrough";
import { VRGalleryLibrary } from "./vrGalleryLibrary";
import { VRGroupLibrary } from "./vrGroupLibrary";
import {
  InteractiveContext,
  ConnectionState,
} from "src/hooks/Interactive/context";
import { PatternRunner } from "src/hooks/Interactive/patterns";
import type { IInteractiveClient } from "src/hooks/Interactive/utils";
import {
  IProjectionSettings,
  clampZoom,
  cycleFov,
  cycleStereo,
  projectionForVrMode,
} from "./projection";
import {
  VRControlAction,
  IVRMarker,
  IVRPlaybackState,
  IVRHandyState,
  IVRHomeSettings,
  DEFAULT_VR_HOME_SETTINGS,
  IVRPassthroughSettings,
  DEFAULT_VR_PASSTHROUGH_SETTINGS,
} from "./types";
import { vrLog } from "./vrLog";
import { orderSourcesByDecodeSupport } from "./vrDecodeHints";

// A currentTime jump bigger than this between consecutive `timeupdate` ticks
// is treated as a deliberate seek (vs. the ~0.25s natural playback advance) —
// used to tell "scrubbed away from the looped chapter" apart from "looped
// playback just wrapped".
const LOOP_SEEK_JUMP_SECONDS = 1.5;

const VR_SETTINGS_KEY = "vrHomeSettings";
// ".v2": the schema changed from key-colour HSV fields to metric weights —
// stale v1 values would mis-map onto the new sliders, so start fresh.
const VR_PT_SETTINGS_KEY = "vrPassthroughSettings.v2";

/** Load persisted immersive-Home preferences, falling back to defaults. */
function loadVRHomeSettings(): IVRHomeSettings {
  try {
    const raw = window.localStorage.getItem(VR_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_VR_HOME_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* SSR / blocked storage / bad JSON — use defaults */
  }
  return { ...DEFAULT_VR_HOME_SETTINGS };
}

function saveVRHomeSettings(s: IVRHomeSettings) {
  try {
    window.localStorage.setItem(VR_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const VR_FUNSCRIPT_SELECTION_KEY = "vrFunscriptSelection";

/**
 * Per-scene in-VR funscript pick (sceneId → funscript path), so re-entering a
 * scene resumes the script the user selected in the Handy panel rather than
 * always resetting to the server default (`funscript_path`). Deliberately kept
 * out of `funscript_path` itself — that field is the shared/server-side default
 * everyone gets; this is a local, per-viewer override.
 */
function loadFunscriptSelection(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(VR_FUNSCRIPT_SELECTION_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* SSR / blocked storage / bad JSON — start empty */
  }
  return {};
}

function saveFunscriptSelection(m: Record<string, string>) {
  try {
    window.localStorage.setItem(VR_FUNSCRIPT_SELECTION_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

/** Load persisted passthrough / chroma-key tuning, falling back to defaults. */
function loadVRPassthroughSettings(): IVRPassthroughSettings {
  try {
    const raw = window.localStorage.getItem(VR_PT_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_VR_PASSTHROUGH_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* SSR / blocked storage / bad JSON — use defaults */
  }
  return { ...DEFAULT_VR_PASSTHROUGH_SETTINGS };
}

function saveVRPassthroughSettings(s: IVRPassthroughSettings) {
  try {
    window.localStorage.setItem(VR_PT_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

interface IMarkerLike {
  title?: string | null;
  seconds: number;
  end_seconds?: number | null;
  primary_tag?: { name: string } | null;
  tags: Array<{ name: string }>;
}

function markerTitle(m: IMarkerLike): string {
  if (m.title) return m.title;
  let ret = m.primary_tag?.name ?? "";
  if (m.tags.length) ret += `, ${m.tags.map((t) => t.name).join(", ")}`;
  return ret;
}

/** Map the React-side connection enum onto the VR Handy panel's status. */
function handyStatusFor(s: ConnectionState): IVRHandyState["status"] {
  switch (s) {
    case ConnectionState.Ready:
      return "ready";
    case ConnectionState.Connecting:
      return "connecting";
    case ConnectionState.Syncing:
      return "syncing";
    case ConnectionState.Uploading:
      return "uploading";
    case ConnectionState.Error:
      return "error";
    case ConnectionState.Disconnected:
      return "disconnected";
    default:
      return "missing";
  }
}

/** Build the ordered list of candidate sources: direct stream first. */
function candidateSources(scene: GQL.SceneDataFragment): string[] {
  const out: string[] = [];
  if (scene.paths.stream) out.push(scene.paths.stream);
  for (const s of scene.sceneStreams) {
    if (s.url && !out.includes(s.url)) out.push(s.url);
  }
  return out;
}

/**
 * Seek a freshly-loaded video to pick up where the user left off. Only kicks
 * in past 30s in (short skips aren't worth rewinding for) and rewinds 5s so
 * playback doesn't resume mid-word/mid-action. If resume_time lands in the
 * scene's last minute, treat it as "finished" and restart from 0 instead of
 * resuming into the credits.
 */
function resumeStartTime(v: HTMLVideoElement, resumeTime: number | null | undefined): void {
  if (!resumeTime || resumeTime < 30) return;
  if (Number.isFinite(v.duration) && v.duration - resumeTime <= 60) return;
  v.currentTime = Math.max(0, resumeTime - 5);
}

/**
 * Empty scene for "lobby" mode — the session opens on the Home wall with no
 * video loaded. The cast avoids hand-writing every SceneDataFragment field; only
 * the fields the player reads (paths, streams, performers, tags, markers…) need
 * sensible empty values.
 */
const LOBBY_SCENE = {
  id: "",
  title: "",
  paths: {},
  sceneStreams: [],
  performers: [],
  tags: [],
  scene_markers: [],
  captions: [],
  interactive: false,
} as unknown as GQL.SceneDataFragment;

export interface IImmersiveVRPlayerProps {
  /** The scene to open, or null to start on the immersive Home wall (lobby). */
  scene: GQL.SceneDataFragment | null;
  session: XRSession;
  onExit: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
}

const ImmersiveVRPlayer: React.FC<IImmersiveVRPlayerProps> = ({
  scene,
  session,
  onExit,
  onNext,
  onPrevious,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const managerRef = useRef<XRSessionManager | null>(null);
  const thumbnailsRef = useRef<VRThumbnails | null>(null);
  // Server-backed Home wall library — pages/filters/sorts the whole library on
  // the server so the immersive Home wall scales past any in-memory cap.
  const homeLibraryRef = useRef<VRHomeLibrary>(new VRHomeLibrary());
  // Server-backed Galleries library — pages galleries + an active gallery's
  // images on the server, powering the Galleries content mode + XR gallery viewer.
  const galleryLibraryRef = useRef<VRGalleryLibrary>(new VRGalleryLibrary());
  // Server-backed Movies library — pages movie posters + an active movie's
  // scenes (ordered by scene_index) on the server, powering the Movies content
  // mode and its in-wall scene drill-down.
  const groupLibraryRef = useRef<VRGroupLibrary>(new VRGroupLibrary());
  // Premium FapTap library — pages the sidecar catalog server-side and powers
  // the locked FapTap content mode. Inert unless the sidecar database exists.
  const faptapLibraryRef = useRef<FapTapHomeLibrary>(new FapTapHomeLibrary());
  // Premium PMVHaven library — same server-paged sidecar pattern as FapTap;
  // powers the locked PMVHaven content mode and is inert without its database.
  const pmvhavenLibraryRef = useRef<PmvHavenHomeLibrary>(new PmvHavenHomeLibrary());
  const history = useHistory();
  const interactiveCtx = useContext(InteractiveContext);
  const handyRef = useRef<IInteractiveClient>(interactiveCtx.interactive);
  const patternRunnerRef = useRef<PatternRunner>(
    new PatternRunner(interactiveCtx.interactive)
  );

  const [projection, setProjection] = useState<IProjectionSettings>(() =>
    projectionForVrMode(scene?.vr_mode)
  );
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Manual Handy activation gate. The global InteractiveContext auto-connects,
  // but in VR we hold the device idle until the user taps Activate — so it never
  // starts stroking the moment a scene plays. Mirrored into a ref so the stable
  // buildHandyState / action handler read the latest without re-creating the XR
  // session.
  const [handyArmed, setHandyArmed] = useState(false);
  const handyArmedRef = useRef(handyArmed);
  handyArmedRef.current = handyArmed;

  // Live scene state — starts as the prop scene and is replaced on in-VR
  // scene switches without touching the XR session or rebuilding the dome.
  const [liveScene, setLiveScene] = useState<GQL.SceneDataFragment>(
    scene ?? LOBBY_SCENE
  );
  const liveSceneRef = useRef<GQL.SceneDataFragment>(liveScene);
  liveSceneRef.current = liveScene;
  // Which of the scene's assigned funscripts is active in the in-VR selector.
  // -1 = the server default (funscript_path / filename-derived). Rewriting the
  // live scene's funscript URL on switch re-fires the Handy upload + heatmap.
  const [activeFunscriptIndex, setActiveFunscriptIndex] = useState(-1);
  // When launched from the navbar with no scene, open on the Home wall (lobby).
  const startedInLobbyRef = useRef<boolean>(!scene);

  const projectionRef = useRef(projection);
  projectionRef.current = projection;

  // Index of the active caption track (-1 = off), into v.textTracks /
  // captionTracks. Tapping the CC control-bar button cycles through every
  // assigned language track, then off, rather than only ever toggling track 0.
  const activeCaptionRef = useRef(-1);
  const activeCueRef = useRef<string | null>(null);

  // Per-scene in-VR funscript picks (sceneId → path), persisted locally so
  // re-entering a scene resumes the last script chosen in the Handy panel
  // instead of always resetting to the server default.
  const funscriptSelectionRef = useRef<Record<string, string>>(
    loadFunscriptSelection()
  );

  // Persisted immersive-Home preferences (gaze-launch / dwell / audio). Held in
  // a ref so the stable action handler reads the latest without re-creating the
  // XR session; mutated in-place and persisted on each change.
  const settingsRef = useRef<IVRHomeSettings>(loadVRHomeSettings());
  // Persisted passthrough / chroma-key tuning (PT panel). Same ref pattern:
  // mutated + saved on each panel edit, seeded into the manager at creation.
  const ptSettingsRef = useRef<IVRPassthroughSettings>(
    loadVRPassthroughSettings()
  );

  const sourceIdx = useRef(0);
  // Key the source list on scene.id only. The `scene` object identity changes
  // whenever an activity-save / play-count mutation updates the Apollo cache
  // (every ~10s and on pause); if `sources` recomputed each time, the effect
  // below would reload the video from 0 — the cause of "playback restarts /
  // won't pause". This mirrors ScenePlayer.tsx's `scene.id === sceneId.current`
  // guard.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sources = useMemo(() => candidateSources(liveScene), [liveScene.id]);
  const loadedSrcRef = useRef<string | null>(null);

  // Wire interactive sync + activity tracking to the live video element. The
  // interactive device stays idle until the user manually arms it (handyArmed).
  useVRPlayback({
    scene: liveScene,
    video: videoEl,
    interactiveEnabled: handyArmed,
  });

  const markers = useMemo<IVRMarker[]>(
    () =>
      [...liveScene.scene_markers]
        .sort((a, b) => a.seconds - b.seconds)
        .map((m) => ({
          title: markerTitle(m),
          seconds: m.seconds,
          endSeconds: m.end_seconds ?? null,
          previewUrl: m.preview || null,
          screenshotUrl: m.screenshot || null,
          streamUrl: m.stream || null,
          vrMode: liveScene.vr_mode ?? null,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveScene.id]
  );
  const markersRef = useRef(markers);
  markersRef.current = markers;

  // Static, per-scene info for the performers + scene-info panels. Keyed on
  // scene.id (like `sources`) so cache-driven scene identity changes don't
  // rebuild it; it's only read once when the manager is created.
  const info = useMemo<IVRSceneInfo>(
    () => ({
      title: liveScene.title ?? "",
      performers: liveScene.performers.map((p) => ({
        id: p.id,
        name: p.name,
        imageUrl: p.image_path ?? null,
      })),
      tags: liveScene.tags.map((t) => ({ id: t.id, name: t.name })),
      markers: [...liveScene.scene_markers]
        .sort((a, b) => a.seconds - b.seconds)
        .map((m) => ({ title: markerTitle(m), seconds: m.seconds })),
      sceneId: liveScene.id,
      rating100: liveScene.rating100 ?? null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveScene.id]
  );
  const infoRef = useRef(info);
  infoRef.current = info;

  // Keep the Handy client ref current so the XR action handler (which lives
  // in a ref to avoid re-creating the session) always has the latest client.
  handyRef.current = interactiveCtx.interactive;
  // The whole interactive context, kept current for the VR Handy panel's
  // status read-out and its Connect/Sync actions.
  const ctxRef = useRef(interactiveCtx);
  ctxRef.current = interactiveCtx;

  // Where the scene's funscript stands: "generating" while it is being built
  // from the audio server-side (PMVHaven only — see the funscript effect, which
  // both triggers and awaits it), "failed" if that never produced one. Read
  // per-frame by getState/buildHandyState, so it's a ref, not state: flipping it
  // must not re-render the immersive tree mid-session.
  const scriptStatusRef = useRef<"idle" | "generating" | "failed">("idle");

  // Build the Handy connection snapshot the VR panel renders each frame. Stable
  // identity (reads through ctxRef), so it never re-creates the XR session.
  const buildHandyState = useCallback((): IVRHandyState => {
    const ctx = ctxRef.current;
    // A script that doesn't exist yet outranks the device's own state: the
    // device is connected and fine, it simply has nothing to play until the
    // analyzer finishes. Reporting "Uploading…" for the minute that takes tells
    // the user nothing about what is actually happening.
    if (scriptStatusRef.current === "generating") {
      return {
        status: "generating",
        label: "Generating haptics…",
        configured: !!ctx.interactive.handyKey,
        active: handyArmedRef.current,
      };
    }
    const status = handyStatusFor(ctx.state);
    const configured = !!ctx.interactive.handyKey;
    let label: string;
    switch (status) {
      case "ready":
        label = "Ready";
        break;
      case "connecting":
        label = "Connecting…";
        break;
      case "syncing":
        label = "Syncing…";
        break;
      case "uploading":
        label = "Uploading…";
        break;
      case "error":
        label = ctx.error ? `Error: ${ctx.error}` : "Error";
        break;
      case "disconnected":
        label = "Disconnected";
        break;
      default:
        label = configured ? "Disconnected" : "Handy";
    }
    // Distinguish "connected but idle" from "armed and driving". The global
    // context auto-connects (status ready) but we hold the device inactive until
    // the user taps Activate.
    if (status === "ready") label = handyArmedRef.current ? "Active" : "Inactive";
    return { status, label, configured, active: handyArmedRef.current };
  }, []);

  const getFunscriptLoaded = useCallback((): boolean => {
    return !!(
      liveSceneRef.current.interactive && liveSceneRef.current.paths.funscript
    );
  }, []);

  // No array copy — walk markers backwards. Called every render frame.
  const getChapterTitle = useCallback((): string | null => {
    const v = videoRef.current;
    if (!v) return null;
    const t = v.currentTime;
    const m = markersRef.current;
    for (let i = m.length - 1; i >= 0; i--) {
      if (t >= m[i].seconds) return m[i].title;
    }
    return null;
  }, []);

  // User-marked A-B loop bounds, or null when no loop is active. Enforced by
  // the timeupdate effect below; read into getState() each frame so the
  // control bar can light the A/B button.
  const loopRef = useRef<{ start: number; end: number } | null>(null);
  // The A point once the user has tapped A/B once, waiting for the second
  // (B) tap. Null when no mark is pending (button idle) or once the loop is
  // fully set (loopRef takes over).
  const abLoopPointARef = useRef<number | null>(null);

  // Reused state object — getState is polled every render frame, so mutating a
  // single object instead of allocating a fresh one keeps the XR loop free of
  // per-frame garbage (a cause of GC-stall black flicker). The manager consumes
  // the values synchronously each frame, so reuse is safe.
  const stateRef = useRef<IVRPlaybackState>({
    paused: true,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
    bufferedAhead: 0,
    waiting: false,
    captionsOn: false,
    loopActive: false,
    abLoopArmed: false,
    abLoopPointA: null,
    loopRange: null,
    loopSceneActive: false,
    notice: null,
  });
  const getState = useCallback((): IVRPlaybackState => {
    const st = stateRef.current;
    const v = videoRef.current;
    // Surfaced on the control bar's top line, where the user is already looking
    // for playback status — the Handy panel says the same thing, but it's a
    // panel they have to open, and this shows with no device in the picture.
    st.notice =
      scriptStatusRef.current === "generating"
        ? "Generating haptics for this scene…"
        : scriptStatusRef.current === "failed"
        ? "Haptics unavailable — generation failed"
        : null;
    if (!v) {
      st.paused = true;
      st.currentTime = 0;
      st.duration = 0;
      st.volume = 1;
      st.muted = false;
      st.playbackRate = 1;
      st.bufferedAhead = 0;
      st.waiting = false;
      st.captionsOn = activeCaptionRef.current >= 0;
      st.loopActive = !!loopRef.current;
      st.abLoopArmed = abLoopPointARef.current != null;
      st.abLoopPointA = abLoopPointARef.current;
      st.loopRange = loopRef.current;
      st.loopSceneActive = false;
      return st;
    }
    let bufferedAhead = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (
        v.currentTime >= v.buffered.start(i) &&
        v.currentTime <= v.buffered.end(i)
      ) {
        bufferedAhead = v.buffered.end(i) - v.currentTime;
        break;
      }
    }
    st.paused = v.paused;
    st.currentTime = v.currentTime;
    st.duration = v.duration;
    st.volume = v.volume;
    st.muted = v.muted;
    st.playbackRate = v.playbackRate;
    st.bufferedAhead = bufferedAhead;
    st.waiting = v.readyState < 3 && !v.paused;
    st.captionsOn = activeCaptionRef.current >= 0;
    st.loopActive = !!loopRef.current;
    st.abLoopArmed = abLoopPointARef.current != null;
    st.abLoopPointA = abLoopPointARef.current;
    st.loopRange = loopRef.current;
    st.loopSceneActive = v.loop;
    return st;
  }, []);

  const seekToMarker = useCallback((direction: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    const sorted = markersRef.current;
    if (direction === 1) {
      const next = sorted.find((m) => m.seconds > t + 0.5);
      if (next) v.currentTime = next.seconds;
    } else {
      const prev = [...sorted].reverse().find((m) => m.seconds < t - 1.5);
      v.currentTime = prev ? prev.seconds : 0;
    }
  }, []);

  // Tapping the CC button cycles Off → track 0 → track 1 → ... → Off, so every
  // assigned language is reachable without leaving VR (there's no separate
  // picker panel). A track's native `.label` (set from the <track label> JSX
  // below) is flashed onto the in-VR caption line for ~1.5s as confirmation.
  const cycleCaptions = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.textTracks.length) return;
    const n = v.textTracks.length;
    const next = activeCaptionRef.current >= n - 1 ? -1 : activeCaptionRef.current + 1;
    activeCaptionRef.current = next;
    for (let i = 0; i < n; i++) {
      v.textTracks[i].mode = i === next ? "hidden" : "disabled";
    }
    if (next === -1) {
      activeCueRef.current = null;
      return;
    }
    const label = v.textTracks[next].label || `Track ${next + 1}`;
    activeCueRef.current = label;
    // Clear the flash after a beat — but only if nothing else (a real cue
    // starting, or another cycle) has since overwritten it.
    window.setTimeout(() => {
      if (activeCueRef.current === label) activeCueRef.current = null;
    }, 1500);
  }, []);

  // ── VR Scenes data ─────────────────────────────────────────────────────
  // The peripheral Browse carousel is fully server-paged inside the manager
  // (VRCarouselLibrary): it pages VR-only scenes newest-first, excluding the
  // now-playing scene, and grows as the user scrolls — no capped in-memory list
  // or client-side splice here. The manager seeds + re-pages it from
  // updateCurrentSceneId, so there's nothing to fetch React-side.

  // Handle navigation from VR scenes panel — exit VR then navigate.
  const handleNavigateToScene = useCallback(
    (sceneId: string) => {
      managerRef.current?.end();
      history.push(`/scenes/${sceneId}`);
    },
    [history]
  );

  // Switch to a different scene inside the active XR session: swap the video
  // source, update the info panel and scenes list, but never touch the session.
  // Uses a generation counter to guard against stale query responses.
  const switchSceneGen = useRef(0);
  // Generation counter for the initial source-selection effect, which also
  // performs the full drain+metadata-wait cycle. Prevents stale onMeta
  // callbacks from racing handleSwitchScene.
  const drainStaleSrcCounter = useRef(0);
  // Apply an already-resolved scene fragment to the live session: drain + swap
  // the video source, update the info/projection, and re-key live state. Shared
  // by the Stash scene-switch path and the FapTap path so both keep the exact
  // same Quest-compositor-safe drain ordering. `gen` is the caller's switch
  // generation; stale applications (gen mismatch) are dropped.
  const applyScene = useCallback(
    (next: GQL.SceneDataFragment, gen: number, logId: string) => {
      // A loop's A-B bounds (and whole-scene loop flag) belong to the
      // outgoing scene — drop them, plus any half-set A mark, before the new
      // one's markers/duration are in place.
      loopRef.current = null;
      abLoopPointARef.current = null;
      const v = videoRef.current;
      if (v) {
        v.loop = false;
        // Decode-hint ordering (cached MediaCapabilities verdicts) picks the
        // swap source — async, so the drain below runs inside the callback and
        // the gen guard drops a switch that went stale while resolving.
        orderSourcesByDecodeSupport(next, candidateSources(next)).then(
          (ordered) => {
            if (gen !== switchSceneGen.current) return;
            // Detach the compositor from the <video> BEFORE draining it. A live
            // WebXR media layer samples this element directly; draining its
            // source out from under a bound layer hard-crashes the Quest
            // compositor (see XRSessionManager.prepareSourceSwap). The new
            // stream rebuilds a fresh layer via onVideoReady once its metadata
            // loads.
            managerRef.current?.prepareSourceSwap();
            // Full video drain: pause, reset time to 0, clear src, then load.
            // This prevents the browser from retaining the old video's position
            // and seeking the new source to an out-of-range timestamp.
            v.pause();
            v.currentTime = 0;
            v.removeAttribute("src");
            v.load();

            const nextSrc = ordered[0];
            if (nextSrc) {
              loadedSrcRef.current = nextSrc;
              sourceIdx.current = 0;
              v.muted = !settingsRef.current.soundOnPlay;

              // Set the new source AFTER the old one is fully drained. Wait for
              // metadata before attempting play.
              const onMeta = () => {
                v.removeEventListener("loadedmetadata", onMeta);
                if (gen !== switchSceneGen.current) return;
                v.currentTime = 0;
                resumeStartTime(v, next.resume_time);
                v.play().catch(() => undefined);
              };
              v.addEventListener("loadedmetadata", onMeta);
              v.src = nextSrc;
              vrLog.note("switchscene", { src: nextSrc, id: logId, gen });
              v.load();
            }
          }
        );
      }

      const nextInfo: IVRSceneInfo = {
        title: next.title ?? "",
        performers: next.performers.map((p) => ({
          id: p.id,
          name: p.name,
          imageUrl: p.image_path ?? null,
        })),
        tags: next.tags.map((t) => ({ id: t.id, name: t.name })),
        markers: [...next.scene_markers]
          .sort((a, b) => a.seconds - b.seconds)
          .map((m) => ({ title: markerTitle(m), seconds: m.seconds })),
        sceneId: next.id,
        rating100: next.rating100 ?? null,
      };
      if (gen !== switchSceneGen.current) return;
      managerRef.current?.updateSceneInfo(nextInfo);
      managerRef.current?.updateCurrentSceneId(next.id);
      // Auto-arm chroma-key passthrough for SLR-style alpha-matte encodes
      // (and disarm it for everything else).
      managerRef.current?.setVideoAlpha(sceneSupportsAlphaPassthrough(next));
      // Close the Browse panels so the user lands back in the immersive view.
      managerRef.current?.closeBrowse();

      // Switch projection to match the new scene's media type.
      if (next.vr_mode) {
        setProjection(projectionForVrMode(next.vr_mode));
      } else {
        setProjection({
          fov: "flat",
          stereo: "off",
          swapEyes: false,
          zoom: 1.2,
        });
      }

      // The carousel re-pages itself server-side around the new now-playing
      // scene — updateCurrentSceneId(next.id) above already triggered that, so
      // no client-side list rebuild is needed here.
      // Leave the Home/lobby wall now that a scene is loaded.
      managerRef.current?.setLobbyMode(false);

      if (gen !== switchSceneGen.current) return;
      // Update live scene state — this re-keys sources/markers/info memos.
      setLiveScene(next);
    },
    []
  );

  const handleSwitchScene = useCallback(
    (sceneId: string) => {
      const gen = ++switchSceneGen.current;
      getClient()
        .query<GQL.FindSceneQuery>({
          query: GQL.FindSceneDocument,
          variables: { id: sceneId },
        })
        .then((result) => {
          if (gen !== switchSceneGen.current) return;
          const next = result.data?.findScene;
          if (!next) return;
          applyScene(next as GQL.SceneDataFragment, gen, sceneId);
        })
        .catch(() => undefined);
    },
    [applyScene]
  );

  // Launch a FapTap (sidecar-catalog) video: resolve its best CDN source, then
  // synthesize a playable scene fragment and run it through the shared path.
  const handleSwitchFapScene = useCallback(
    (videoId: string) => {
      const gen = ++switchSceneGen.current;
      const detailURL = getPlatformURL(`faptap/videos/${videoId}`).toString();
      const sourcesURL = getPlatformURL(
        `faptap/videos/${videoId}/sources`
      ).toString();
      Promise.all([
        fetch(detailURL, { credentials: "include" }).then((r) => r.json()),
        fetch(sourcesURL, { credentials: "include" }).then((r) => r.json()),
      ])
        .then(([detail, srcs]) => {
          if (gen !== switchSceneGen.current) return;
          if (!detail || !srcs?.stream) return;
          applyScene(buildFapSceneFragment(detail, srcs), gen, `faptap:${videoId}`);
        })
        .catch(() => undefined);
    },
    [applyScene]
  );

  // Launch a PMVHaven (sidecar-catalog) video: resolve its CDN source, then
  // synthesize a playable scene fragment (flat projection, on-demand funscript)
  // and run it through the same shared path.
  const handleSwitchPmvScene = useCallback(
    (videoId: string) => {
      const gen = ++switchSceneGen.current;
      const detailURL = getPlatformURL(`pmvhaven/videos/${videoId}`).toString();
      const sourcesURL = getPlatformURL(
        `pmvhaven/videos/${videoId}/sources`
      ).toString();
      Promise.all([
        fetch(detailURL, { credentials: "include" }).then((r) => r.json()),
        fetch(sourcesURL, { credentials: "include" }).then((r) => r.json()),
      ])
        .then(([detail, srcs]) => {
          if (gen !== switchSceneGen.current) return;
          if (!detail || !srcs?.stream) return;
          applyScene(buildPmvSceneFragment(detail, srcs), gen, `pmvhaven:${videoId}`);
        })
        .catch(() => undefined);
    },
    [applyScene]
  );

  // Return to the immersive Home wall: pause + unload the video and re-enter
  // lobby mode. The XR session, dome, and controllers all stay alive.
  const handleGoHome = useCallback(() => {
    loopRef.current = null;
    abLoopPointARef.current = null;
    const v = videoRef.current;
    if (v) {
      v.loop = false;
      // Release the live media layer before draining the <video> (same Quest
      // compositor crash hazard as an in-VR scene switch).
      managerRef.current?.prepareSourceSwap();
      v.pause();
      v.removeAttribute("src");
      v.load();
    }
    loadedSrcRef.current = null;
    sourceIdx.current = 0;
    managerRef.current?.updateCurrentSceneId("");
    managerRef.current?.setLobbyMode(true);
    setLiveScene(LOBBY_SCENE);
  }, []);

  // Central action handler — the single place that mutates video / projection.
  const handleAction = useCallback(
    (a: VRControlAction) => {
      const v = videoRef.current;
      switch (a.type) {
        case "playpause":
          if (!v) return;
          if (v.paused) v.play().catch(() => undefined);
          else v.pause();
          break;
        case "seekFraction":
          if (v && v.duration) v.currentTime = a.fraction * v.duration;
          break;
        case "seekRelative":
          if (v)
            v.currentTime = Math.max(
              0,
              Math.min(v.duration || Infinity, v.currentTime + a.seconds)
            );
          break;
        case "seekSeconds":
          if (v) v.currentTime = a.seconds;
          break;
        case "setVolume":
          if (v) {
            v.volume = a.value;
            if (a.value > 0) v.muted = false;
          }
          break;
        case "toggleMute":
          if (v) v.muted = !v.muted;
          break;
        case "setRate":
          if (v) v.playbackRate = a.value;
          break;
        case "cycleFov":
          setProjection((p) => cycleFov(p));
          break;
        case "cycleStereo":
          setProjection((p) => cycleStereo(p));
          break;
        case "toggleSwapEyes":
          setProjection((p) => ({ ...p, swapEyes: !p.swapEyes }));
          break;
        case "setZoom":
          setProjection((p) => ({ ...p, zoom: clampZoom(a.value) }));
          break;
        case "recenter":
          managerRef.current?.recenter();
          break;
        case "togglePassthrough":
          managerRef.current?.toggleVideoPassthrough();
          break;
        case "setPassthroughSettings":
          // Emitted by the PT panel on slider release / reset / frame sample.
          // The manager already applied it live; persist + re-sync.
          ptSettingsRef.current = a.settings;
          saveVRPassthroughSettings(a.settings);
          managerRef.current?.setPassthroughSettings(a.settings);
          break;
        case "nextMarker":
          seekToMarker(1);
          break;
        case "prevMarker":
          seekToMarker(-1);
          break;
        case "loopChapter":
          // A/B loop, marked with two taps: first tap drops point A at the
          // playhead and arms the button; second tap drops point B and starts
          // looping between them (order-independent — B can land before A).
          // A third tap (while the loop is active) clears it and rearms for a
          // fresh A. If B lands within half a second of A, the mark is
          // dropped instead of creating a degenerate loop.
          if (loopRef.current) {
            loopRef.current = null;
            abLoopPointARef.current = null;
          } else if (v) {
            if (abLoopPointARef.current == null) {
              abLoopPointARef.current = v.currentTime;
            } else {
              const pointA = abLoopPointARef.current;
              const pointB = v.currentTime;
              abLoopPointARef.current = null;
              if (Math.abs(pointB - pointA) > 0.5) {
                loopRef.current = {
                  start: Math.min(pointA, pointB),
                  end: Math.max(pointA, pointB),
                };
              }
            }
          }
          break;
        case "toggleLoopScene":
          if (v) v.loop = !v.loop;
          break;
        case "toggleCaptions":
          cycleCaptions();
          break;
        // ── In-VR scene metadata edits (Info panel actions row) ──
        // The panel already applied the tap optimistically; here we persist it
        // and only push a patch back to reconcile or revert on failure.
        // Guarded against taps landing after a scene switch.
        case "setSceneRating": {
          if (a.sceneId !== liveSceneRef.current.id) break;
          const prevRating = liveSceneRef.current.rating100 ?? null;
          setLiveScene((p) => ({ ...p, rating100: a.rating100 }));
          getClient()
            .mutate({
              mutation: GQL.SceneUpdateDocument,
              variables: { input: { id: a.sceneId, rating100: a.rating100 } },
            })
            .catch(() => {
              if (liveSceneRef.current.id !== a.sceneId) return;
              setLiveScene((p) => ({ ...p, rating100: prevRating }));
              managerRef.current?.updateSceneMeta({ rating100: prevRating });
            });
          break;
        }
        case "next":
          onNext?.();
          break;
        case "previous":
          onPrevious?.();
          break;
        case "exit":
          managerRef.current?.end();
          break;
        // ── VR scenes panel ──
        case "switchScene":
          handleSwitchScene(a.sceneId);
          break;
        case "switchFapScene":
          handleSwitchFapScene(a.videoId);
          break;
        case "switchPmvScene":
          handleSwitchPmvScene(a.videoId);
          break;
        case "navigateToScene":
          handleNavigateToScene(a.sceneId);
          break;
        case "goHome":
          handleGoHome();
          break;
        // ── Immersive Home preferences (gear panel) ──
        case "setVrSetting": {
          const next = { ...settingsRef.current, [a.key]: a.value };
          settingsRef.current = next;
          saveVRHomeSettings(next);
          managerRef.current?.setHomeSettings(next);
          // Apply audio change live to whatever is currently playing.
          if (a.key === "soundOnPlay" && v) v.muted = !a.value;
          break;
        }
        case "setVrDwellMs": {
          const next = { ...settingsRef.current, dwellMs: a.ms };
          settingsRef.current = next;
          saveVRHomeSettings(next);
          managerRef.current?.setHomeSettings(next);
          break;
        }
        // scenesPanelToggle is handled in-manager (see routeSelect).
        // ── Handy interactive device ──
        case "handyConnect":
          ctxRef.current.initialise().catch(() => undefined);
          break;
        case "handyActivate": {
          // Manual activation toggle. Arming ensures the device is connected
          // (the global context usually already did this) and lets useVRPlayback
          // upload the script + drive playback. Disarming halts it immediately.
          const next = !handyArmedRef.current;
          setHandyArmed(next);
          if (next) {
            if (ctxRef.current.state !== ConnectionState.Ready) {
              ctxRef.current.initialise().catch(() => undefined);
            }
          } else {
            patternRunnerRef.current.stop();
            handyRef.current.emergencyStop?.();
          }
          break;
        }
        case "handySync":
          ctxRef.current.sync().catch(() => undefined);
          break;
        case "handyToggle":
          handyRef.current.emergencyStop?.();
          break;
        case "switchFunscript": {
          // Switch the active funscript at runtime. Rewriting the live scene's
          // funscript URL (a distinct `?funscript=<index>` per script) re-fires
          // both the Handy upload (useVRPlayback) and the scrubber heatmap
          // effect, which are keyed on paths.funscript — no extra plumbing. The
          // pick isn't written to the shared/server-side funscript_path, but it
          // IS remembered locally per-scene (see funscriptSelectionRef) so
          // reopening the scene resumes it instead of the server default.
          const s = liveSceneRef.current;
          const list = s.funscripts ?? [];
          if (a.index < 0 || a.index >= list.length) break;
          const base = (s.paths.funscript ?? `/scene/${s.id}/funscript`).split(
            "?"
          )[0];
          setActiveFunscriptIndex(a.index);
          setLiveScene((prev) => ({
            ...prev,
            interactive: true,
            paths: { ...prev.paths, funscript: `${base}?funscript=${a.index}` },
          }));
          if (s.id) {
            const next = {
              ...funscriptSelectionRef.current,
              [s.id]: list[a.index].path,
            };
            funscriptSelectionRef.current = next;
            saveFunscriptSelection(next);
          }
          break;
        }
        case "setHandyStroke": {
          // Apply the stroke-zone envelope to the device. /slider/stroke clamps
          // both HAMP and funscript (HSSP) motion into this min..max range.
          // Reflect the server's response back onto the VR panel so the user
          // gets explicit confirmation (or an error) without leaving the scene.
          const p = handyRef.current.setHampStroke?.(a.min, a.max);
          if (p) {
            p.then(
              () => managerRef.current?.setHandyStrokeStatus("confirmed"),
              () => managerRef.current?.setHandyStrokeStatus("error")
            );
          } else {
            // Client doesn't support stroke control — clear the pending state.
            managerRef.current?.setHandyStrokeStatus("error");
          }
          break;
        }
        case "handyPatternStart": {
          // Start the stepping loop — sends HDSP position commands on a timer
          patternRunnerRef.current.start(a.patternId);
          break;
        }
        case "handyPatternStop":
          patternRunnerRef.current.stop();
          handyRef.current.emergencyStop?.();
          break;
        case "handyEmergencyStop":
          patternRunnerRef.current.stop();
          handyRef.current.emergencyStop?.();
          break;
      }
    },
    [
      seekToMarker,
      cycleCaptions,
      onNext,
      onPrevious,
      handleNavigateToScene,
      handleSwitchScene,
      handleSwitchFapScene,
      handleSwitchPmvScene,
      handleGoHome,
    ]
  );
  const actionRef = useRef(handleAction);
  actionRef.current = handleAction;
  // Keep onExit in a ref so a parent re-render never re-runs the session
  // effect (which would dispose and recreate the live XR session).
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Capture the element once mounted so dependent effects/hooks can run.
  useEffect(() => {
    setVideoEl(videoRef.current);
    // Opt-in wireless telemetry (?vrlog=1) — inert unless configured.
    vrLog.start(videoRef.current);
    return () => vrLog.stop();
  }, []);

  // Jitter probe: mark every React commit, and separately the Apollo-cache-
  // driven `scene` prop identity change (the ~10s activity-save re-render), so
  // the profiler can tie a main-thread stall to a re-render. Inert outside
  // vrprofile=jitter (vrLog.note is a no-op unless telemetry is active).
  useEffect(() => {
    if (vrLog.profile === "jitter") vrLog.note("commit");
  });
  useEffect(() => {
    if (vrLog.profile === "jitter")
      vrLog.note("scene_prop_change", { id: scene?.id ?? "" });
  }, [scene]);

  // Source selection with transcode fallback on error.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || sources.length === 0) {
      // Lobby mode (no scene loaded yet) legitimately has no source — not an error.
      if (sources.length === 0 && liveSceneRef.current.id) {
        setError("No playable source for this scene.");
      }
      return;
    }
    // Guard against redundant reloads: if whatever is already loaded belongs
    // to this scene's candidate set (the effect re-running after an in-VR
    // applyScene, or a cache-driven re-render), don't drain and reload it.
    // Membership rather than ===sources[0], because the decode hint below may
    // have demoted the direct stream on the previous run. Prevents
    // mid-playback restarts.
    if (loadedSrcRef.current && sources.includes(loadedSrcRef.current)) return;
    drainStaleSrcCounter.current++;
    const drainGen = drainStaleSrcCounter.current;
    let disposed = false;
    let onError: (() => void) | null = null;

    // Decode-support hint: demote the direct stream below the transcodes when
    // MediaCapabilities says this device can't decode its codec — proactive,
    // instead of waiting for the <video> error fallback below to find out.
    orderSourcesByDecodeSupport(liveSceneRef.current, sources).then(
      (ordered) => {
        if (disposed || drainGen !== drainStaleSrcCounter.current) return;
        loadedSrcRef.current = ordered[0];
        sourceIdx.current = 0;

        // Detach any live media layer before draining (Quest compositor crash
        // hazard; no-op on the dome path / first load).
        managerRef.current?.prepareSourceSwap();
        // Drain the old source before loading the new one. This prevents the
        // browser from retaining the previous video's currentTime and trying
        // to seek the new source to an out-of-range position.
        v.pause();
        v.currentTime = 0;
        v.removeAttribute("src");
        v.load();

        // Use loadedmetadata to confirm the new source is ready, reset
        // currentTime, and start playback. Mirrors handleSwitchScene exactly.
        const onMeta = () => {
          v.removeEventListener("loadedmetadata", onMeta);
          if (drainGen !== drainStaleSrcCounter.current) return;
          v.currentTime = 0;
          resumeStartTime(v, liveSceneRef.current.resume_time);
          v.play().catch(() => undefined);
        };
        v.addEventListener("loadedmetadata", onMeta);
        v.src = ordered[0];
        vrLog.attach(v);
        vrLog.note("srcset", { src: ordered[0], count: ordered.length });
        v.muted = !settingsRef.current.soundOnPlay;

        // Walks the WHOLE candidate chain (the old handler removed itself and
        // never re-armed, so only one fallback step ever ran). Detached during
        // each drain and re-armed after the new src is set, so a spurious
        // error from the drain itself can't skip a candidate.
        const handleError = () => {
          v.removeEventListener("error", handleError);
          if (drainGen !== drainStaleSrcCounter.current) return;
          if (sourceIdx.current < ordered.length - 1) {
            sourceIdx.current += 1;
            loadedSrcRef.current = ordered[sourceIdx.current];
            // Drain + metadata-wait for the fallback source too.
            v.pause();
            v.currentTime = 0;
            v.removeAttribute("src");
            v.load();
            const onFallbackMeta = () => {
              v.removeEventListener("loadedmetadata", onFallbackMeta);
              if (drainGen !== drainStaleSrcCounter.current) return;
              v.currentTime = 0;
              resumeStartTime(v, liveSceneRef.current.resume_time);
              v.play().catch(() => undefined);
            };
            v.addEventListener("loadedmetadata", onFallbackMeta);
            v.src = ordered[sourceIdx.current];
            v.addEventListener("error", handleError);
            v.load();
          } else {
            setError("Unable to play this scene in VR (codec unsupported).");
          }
        };
        onError = handleError;
        v.addEventListener("error", handleError);
        v.load(); // kick off the network fetch
      }
    );
    return () => {
      disposed = true;
      if (onError) v.removeEventListener("error", onError);
    };
  }, [sources]);

  // Track the active caption cue for the in-VR caption line. Listens on every
  // track (not just index 0) since cycleCaptions can make any of them active;
  // each handler no-ops unless its own index is the currently active one.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !v.textTracks.length) return;
    const handlers: { track: TextTrack; onCue: () => void }[] = [];
    for (let i = 0; i < v.textTracks.length; i++) {
      const track = v.textTracks[i];
      const onCue = () => {
        if (activeCaptionRef.current !== i) return;
        const cues = track.activeCues;
        activeCueRef.current =
          cues && cues.length
            ? Array.from(cues)
                .map((c) => (c as VTTCue).text)
                .join("\n")
            : null;
      };
      track.addEventListener("cuechange", onCue);
      handlers.push({ track, onCue });
    }
    return () => {
      for (const { track, onCue } of handlers) {
        track.removeEventListener("cuechange", onCue);
      }
    };
  }, [videoEl]);

  // Enforce the user-marked A-B loop: wrap back to `start` once playback
  // crosses `end`. A large jump in currentTime between ticks (a deliberate
  // scrub, not the ~0.25s natural playback advance) that lands outside the
  // loop's bounds silently releases it — walking away from the marked range
  // is the drop signal, not an error to fight.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let lastT = v.currentTime;
    const onTimeUpdate = () => {
      const loop = loopRef.current;
      const t = v.currentTime;
      if (loop) {
        const jumped = Math.abs(t - lastT) > LOOP_SEEK_JUMP_SECONDS;
        if (jumped && (t < loop.start || t > loop.end)) {
          loopRef.current = null;
        } else if (t >= loop.end) {
          v.currentTime = loop.start;
        }
      }
      lastT = t;
    };
    v.addEventListener("timeupdate", onTimeUpdate);
    return () => v.removeEventListener("timeupdate", onTimeUpdate);
  }, [videoEl]);

  // Create the session manager once the video element exists.
  useEffect(() => {
    if (!videoEl || !containerRef.current) return;
    let disposed = false;

    const manager = new XRSessionManager({
      video: videoEl,
      container: containerRef.current,
      projection: projectionRef.current,
      info: infoRef.current,
      getState,
      getMarkers: () => markersRef.current,
      getChapterTitle,
      getCaption: () =>
        activeCaptionRef.current >= 0 ? activeCueRef.current : null,
      getHandyState: () => buildHandyState(),
      getFunscriptLoaded: () => getFunscriptLoaded(),
      homeData: homeLibraryRef.current,
      galleryData: galleryLibraryRef.current,
      groupData: groupLibraryRef.current,
      faptapData: faptapLibraryRef.current,
      pmvhavenData: pmvhavenLibraryRef.current,
      lobby: startedInLobbyRef.current,
      homeSettings: settingsRef.current,
      passthroughSettings: ptSettingsRef.current,
      getThumbnail: (time) => thumbnailsRef.current?.getAt(time) ?? null,
      onAction: (a) => actionRef.current(a),
      onEnd: () => onExitRef.current(),
    });
    managerRef.current = manager;

    manager
      .init(session)
      .then(() => {
        if (!disposed) {
          setIsInitializing(false);
          manager.updateCurrentSceneId(liveSceneRef.current.id);
          // Arm chroma-key passthrough if the launch scene is an alpha encode.
          manager.setVideoAlpha(
            sceneSupportsAlphaPassthrough(liveSceneRef.current)
          );
          // The Home wall sources its data from homeData (server-paged); the
          // manager kicks that off itself, so nothing to seed here.
        }
      })
      .catch((e) => {
        if (!disposed) {
          setError(`Failed to start VR session: ${e?.message ?? e}`);
          setIsInitializing(false);
        }
      });

    return () => {
      disposed = true;
      manager.dispose();
      managerRef.current = null;
    };
  }, [
    videoEl,
    session,
    getState,
    getChapterTitle,
    buildHandyState,
    getFunscriptLoaded,
  ]);

  // Push projection changes to the dome renderer.
  useEffect(() => {
    managerRef.current?.setProjection(projection);
  }, [projection]);

  // Load VTT thumbnails for the scrubber-hover preview (read via the manager's
  // getThumbnail closure each frame, so no manager re-creation is needed).
  useEffect(() => {
    if (!liveScene.paths.vtt) {
      thumbnailsRef.current = null;
      return;
    }
    const t = new VRThumbnails();
    thumbnailsRef.current = t;
    t.load(liveScene.paths.vtt).catch(() => undefined);
    return () => {
      t.dispose();
      if (thumbnailsRef.current === t) thumbnailsRef.current = null;
    };
  }, [liveScene.paths.vtt]);

  // Fetch the scene's funscript: it feeds the scrubber heatmap strip, and for a
  // PMVHaven scene it is also what *creates* the script in the first place —
  // those videos ship no authored funscript, so the endpoint builds one from the
  // audio (ffmpeg → beat analyzer) on the first request and blocks for the tens
  // of seconds that takes.
  //
  // Deliberately independent of the Handy: a script belongs to the scene, not to
  // a device. It is generated on every launch whether or not a device is
  // connected, armed, or even configured — so the heatmap draws for everyone,
  // the cache is warm for a device that gets armed mid-scene, and arming later
  // costs a cache read instead of a minute of analysis. Nothing here reads the
  // interactive context, and the manager is only consulted when there is a
  // heatmap to hand it: an XR session that isn't up yet must not cancel the
  // generation, it just means nobody is drawing a strip for it.
  useEffect(() => {
    if (!liveScene.interactive || !liveScene.paths.funscript) {
      managerRef.current?.setHeatmap(null);
      return;
    }
    const url = liveScene.paths.funscript;
    let cancelled = false;

    (async () => {
      // Probe the cache first, so the HUD can say "generating" for the wait that
      // follows rather than appearing to hang. A cache hit reports nothing and
      // falls straight through to the fetch.
      const generating = await pmvhavenFunscriptPending(liveScene.id);
      if (cancelled) return;
      scriptStatusRef.current = generating ? "generating" : "idle";
      try {
        const data = await fetch(url).then((r) => r.json());
        if (cancelled) return;
        scriptStatusRef.current = "idle";
        const actions = data?.actions;
        if (Array.isArray(actions) && actions.length >= 2) {
          managerRef.current?.setHeatmap(generateFunscriptWaveform(actions));
        }
      } catch {
        if (cancelled) return;
        // Generation is the only failure worth reporting: it depends on ffmpeg
        // and python being reachable, and a silent failure here reads as "the
        // haptics are just broken" with nothing to act on.
        scriptStatusRef.current = generating ? "failed" : "idle";
      }
    })();

    return () => {
      cancelled = true;
      scriptStatusRef.current = "idle";
    };
    // videoEl is a dep because the XR manager is built from it: re-running when
    // it changes is what gets the heatmap onto a manager that didn't exist when
    // the fetch resolved. The re-fetch that costs is a cache read (and if it
    // lands mid-generation, the backend serializes it onto the same run rather
    // than starting a second one).
  }, [liveScene.id, liveScene.interactive, liveScene.paths.funscript, videoEl]);

  // Reset the active-funscript selection when the scene changes, seeding it
  // from this viewer's remembered pick for the scene (falling back to the
  // scene's persisted funscript_path, else the server default, -1).
  useEffect(() => {
    const live = liveSceneRef.current;
    const list = live.funscripts ?? [];
    const sceneId = live.id;
    const remembered = sceneId
      ? funscriptSelectionRef.current[sceneId]
      : undefined;
    const fp = remembered ?? live.funscript_path;
    const idx = fp ? list.findIndex((f) => f.path === fp) : -1;
    setActiveFunscriptIndex(idx);
    // The scene fragment only serves the server default (funscript_path) by
    // URL; if the remembered pick differs, re-point paths.funscript so
    // playback/heatmap/Handy upload actually load it, not just the highlight.
    if (remembered && idx >= 0 && remembered !== live.funscript_path) {
      const base = (live.paths.funscript ?? `/scene/${live.id}/funscript`).split(
        "?"
      )[0];
      setLiveScene((prev) => ({
        ...prev,
        interactive: true,
        paths: { ...prev.paths, funscript: `${base}?funscript=${idx}` },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveScene.id]);

  // Push the scene's assigned funscripts + active index to the in-VR Handy
  // selector (redraws only when the list or selection actually changes).
  useEffect(() => {
    managerRef.current?.setFunscripts(
      (liveScene.funscripts ?? []).map((f) => ({ label: f.label })),
      activeFunscriptIndex
    );
  }, [liveScene.funscripts, activeFunscriptIndex, videoEl]);

  // Auto-advance: when a scene ends, switch to the next scene in the current
  // filtered order after a short delay. The manager keeps the filtered list;
  // lobby mode scenes (id="") return null so no advance fires from the home wall.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Bumped whenever the user resumes watching (replay/seek after `ended`),
    // voiding both the armed timer AND any getNextSceneId still resolving —
    // otherwise a replayed scene gets yanked away 3 s later.
    let armGen = 0;
    const cancelAdvance = () => {
      armGen++;
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const onEnded = () => {
      cancelAdvance();
      const gen = armGen;
      // getNextSceneId is async now (the next scene may live on an unfetched
      // server page); resolve it, then schedule the switch.
      const endedId = liveSceneRef.current.id;
      managerRef.current
        ?.getNextSceneId(endedId)
        .then((nextId) => {
          // Bail if the user resumed watching or the scene changed out from
          // under us while resolving.
          if (gen !== armGen) return;
          if (!nextId || liveSceneRef.current.id !== endedId) return;
          timer = setTimeout(() => handleSwitchScene(nextId), 3000);
        })
        .catch(() => undefined);
    };
    v.addEventListener("ended", onEnded);
    v.addEventListener("play", cancelAdvance);
    v.addEventListener("seeking", cancelAdvance);
    return () => {
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("play", cancelAdvance);
      v.removeEventListener("seeking", cancelAdvance);
      if (timer != null) clearTimeout(timer);
    };
  }, [videoEl, handleSwitchScene]);

  const captionTracks = useMemo(() => {
    if (!liveScene.captions) return [];
    return liveScene.captions.map((c) => {
      const lang = c.language_code;
      const label = `${languageMap.get(lang) ?? lang} (${c.caption_type})`;
      return {
        src: `${liveScene.paths.caption}?lang=${lang}&type=${c.caption_type}`,
        lang,
        label,
      };
    });
  }, [liveScene.captions, liveScene.paths.caption]);

  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: error ? "rgba(40,0,0,0.95)" : "rgba(0,0,0,0.92)",
        transition: "background-color 0.4s ease",
        zIndex: 30,
        gap: 2,
        textAlign: "center",
        px: 3,
      }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      {/* Hidden media element feeding the VR texture. */}
      <video
        ref={videoRef}
        crossOrigin="anonymous"
        playsInline
        preload="auto"
        poster={liveScene.paths.screenshot ?? undefined}
        style={{ display: "none" }}
      >
        {captionTracks.map((t) => (
          <track
            key={t.lang}
            kind="captions"
            src={t.src}
            srcLang={t.lang}
            label={t.label}
          />
        ))}
      </video>

      {isInitializing && !error ? (
        <>
          <CircularProgress
            size={40}
            sx={{ color: "primary.main", zIndex: 31 }}
          />
          <Typography variant="h6" sx={{ color: "white", zIndex: 31 }}>
            Starting VR session…
          </Typography>
          <Typography variant="body2" sx={{ color: "grey.500", zIndex: 31 }}>
            Initializing headset display
          </Typography>
        </>
      ) : error ? (
        <>
          <Box
            sx={{
              fontSize: "2.5rem",
              color: "error.main",
              zIndex: 31,
              lineHeight: 1,
            }}
          >
            <Icon icon={faExclamationTriangle} />
          </Box>
          <Typography variant="h6" sx={{ color: "error.light", zIndex: 31 }}>
            VR Error
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: "grey.400", zIndex: 31, maxWidth: 360 }}
          >
            {error}
          </Typography>
        </>
      ) : (
        <>
          <Box
            sx={{
              fontSize: "2.5rem",
              color: "primary.main",
              zIndex: 31,
              lineHeight: 1,
            }}
          >
            <Icon icon={faVrCardboard} />
          </Box>
          <Typography variant="h6" sx={{ color: "white", zIndex: 31 }}>
            Immersive VR active
          </Typography>
          <Typography variant="body2" sx={{ color: "grey.400", zIndex: 31 }}>
            {startedInLobbyRef.current
              ? "Put on your headset to browse your library. Remove it or press Exit to return."
              : "Put on your headset to watch. Remove it or press Exit to return."}
          </Typography>
        </>
      )}

      <Button
        variant={
          error ? "contained" : isInitializing ? "outlined" : "contained"
        }
        color={error ? "error" : "primary"}
        sx={{ zIndex: 31, mt: 1 }}
        onClick={() => {
          if (managerRef.current) managerRef.current.end();
          else onExit();
        }}
      >
        Exit VR
      </Button>
    </Box>
  );
};

export default ImmersiveVRPlayer;
