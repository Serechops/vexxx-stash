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
import { IVRSceneEntry } from "./VRScenesPanel";
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
} from "./types";

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

  // Live scene state — starts as the prop scene and is replaced on in-VR
  // scene switches without touching the XR session or rebuilding the dome.
  const [liveScene, setLiveScene] = useState<GQL.SceneDataFragment>(
    scene ?? LOBBY_SCENE
  );
  const liveSceneRef = useRef<GQL.SceneDataFragment>(liveScene);
  liveSceneRef.current = liveScene;
  // When launched from the navbar with no scene, open on the Home wall (lobby).
  const startedInLobbyRef = useRef<boolean>(!scene);

  const projectionRef = useRef(projection);
  projectionRef.current = projection;

  const captionsOnRef = useRef(false);
  const activeCueRef = useRef<string | null>(null);

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

  // Wire interactive sync + activity tracking to the live video element.
  useVRPlayback({ scene: liveScene, video: videoEl });

  const markers = useMemo<IVRMarker[]>(
    () =>
      [...liveScene.scene_markers]
        .sort((a, b) => a.seconds - b.seconds)
        .map((m) => ({
          title: markerTitle(m),
          seconds: m.seconds,
          endSeconds: m.end_seconds ?? null,
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
        name: p.name,
        imageUrl: p.image_path ?? null,
      })),
      tags: liveScene.tags.map((t) => t.name),
      markers: [...liveScene.scene_markers]
        .sort((a, b) => a.seconds - b.seconds)
        .map((m) => ({ title: markerTitle(m), seconds: m.seconds })),
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

  // Build the Handy connection snapshot the VR panel renders each frame. Stable
  // identity (reads through ctxRef), so it never re-creates the XR session.
  const buildHandyState = useCallback((): IVRHandyState => {
    const ctx = ctxRef.current;
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
    return { status, label, configured };
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
  });
  const getState = useCallback((): IVRPlaybackState => {
    const st = stateRef.current;
    const v = videoRef.current;
    if (!v) {
      st.paused = true;
      st.currentTime = 0;
      st.duration = 0;
      st.volume = 1;
      st.muted = false;
      st.playbackRate = 1;
      st.bufferedAhead = 0;
      st.waiting = false;
      st.captionsOn = captionsOnRef.current;
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
    st.captionsOn = captionsOnRef.current;
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

  const toggleCaptions = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.textTracks.length) return;
    const on = !captionsOnRef.current;
    captionsOnRef.current = on;
    for (let i = 0; i < v.textTracks.length; i++) {
      v.textTracks[i].mode = on && i === 0 ? "hidden" : "disabled";
    }
    if (!on) activeCueRef.current = null;
  }, []);

  // ── VR Scenes data (peripheral carousel + immersive Home wall) ──────────
  const scenesRef = useRef<IVRSceneEntry[]>([]);
  const homeScenesRef = useRef<IVRSceneEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    getClient()
      .query<GQL.FindScenesQuery>({
        query: GQL.FindScenesDocument,
        variables: {
          filter: {
            per_page: 200,
            sort: "date",
            direction: GQL.SortDirectionEnum.Desc,
          },
          scene_filter: {
            vr_mode: {
              value: [GQL.VrMode.Lr180, GQL.VrMode.Mono360, GQL.VrMode.Tb360],
              modifier: GQL.CriterionModifier.Includes,
            },
          },
        },
      })
      .then((result) => {
        if (cancelled) return;
        const all: IVRSceneEntry[] = result.data.findScenes.scenes.map((s) => ({
          id: s.id,
          title: s.title ?? `Scene ${s.id}`,
          thumbnailUrl: s.paths.screenshot ?? null,
          streamUrl: s.paths.stream ?? null,
          studioName: s.studio?.name ?? null,
          performers: s.performers.map((p) => p.name),
          previewUrl: s.paths.preview ?? null,
          vrMode: s.vr_mode ?? null,
          studioId: s.studio?.id ?? null,
          studioLogoUrl: s.studio?.image_path ?? null,
          performerDetails: s.performers.map((p) => ({
            id: p.id,
            name: p.name,
            imageUrl: p.image_path ?? null,
          })),
        }));
        // Home wall shows the whole VR library; the peripheral carousel excludes
        // whatever scene is currently playing.
        homeScenesRef.current = all;
        scenesRef.current = all
          .filter((s) => s.id !== liveSceneRef.current.id)
          .slice(0, 50);
        managerRef.current?.updateHomeScenes(all);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id]);

  const getScenes = useCallback((): IVRSceneEntry[] => {
    return scenesRef.current;
  }, []);

  const getHomeScenes = useCallback((): IVRSceneEntry[] => {
    return homeScenesRef.current;
  }, []);

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
  const handleSwitchScene = useCallback((sceneId: string) => {
    getClient()
      .query<GQL.FindSceneQuery>({
        query: GQL.FindSceneDocument,
        variables: { id: sceneId },
      })
      .then((result) => {
        const next = result.data?.findScene;
        if (!next) return;

        const v = videoRef.current;
        if (v) {
          v.pause();
          const nextSrc = next.paths.stream ?? next.sceneStreams[0]?.url;
          if (nextSrc) {
            loadedSrcRef.current = nextSrc;
            sourceIdx.current = 0;
            v.src = nextSrc;
            v.load();
            v.play().catch(() => undefined);
          }
        }

        const nextInfo: IVRSceneInfo = {
          title: next.title ?? "",
          performers: next.performers.map((p) => ({
            name: p.name,
            imageUrl: p.image_path ?? null,
          })),
          tags: next.tags.map((t) => t.name),
          markers: [...next.scene_markers]
            .sort((a, b) => a.seconds - b.seconds)
            .map((m) => ({ title: markerTitle(m), seconds: m.seconds })),
        };
        managerRef.current?.updateSceneInfo(nextInfo);
        managerRef.current?.updateCurrentSceneId(next.id);
        // Close the Browse panels so the user lands back in the immersive view.
        managerRef.current?.closeBrowse();

        // Update the scenes browser: remove the new scene, add the old one back.
        const prev = liveSceneRef.current;
        // Add the outgoing scene back into the carousel — unless it was the
        // empty lobby scene (switching in from the Home wall).
        const prevEntry: IVRSceneEntry[] = prev.id
          ? [
              {
                id: prev.id,
                title: prev.title ?? `Scene ${prev.id}`,
                thumbnailUrl: prev.paths.screenshot ?? null,
                streamUrl: prev.paths.stream ?? null,
                studioName: prev.studio?.name ?? null,
                performers: prev.performers.map((p) => p.name),
              },
            ]
          : [];
        const nextScenesList = [
          ...prevEntry,
          ...scenesRef.current.filter((s) => s.id !== next.id),
        ];
        scenesRef.current = nextScenesList;
        // Push the refreshed list to the manager so it doesn't show a stale
        // cache — the manager only reads getScenes() on first Browse open.
        managerRef.current?.updateScenes(nextScenesList);
        // Leave the Home/lobby wall now that a scene is loaded.
        managerRef.current?.setLobbyMode(false);

        // Update live scene state — this re-keys sources/markers/info memos.
        setLiveScene(next as GQL.SceneDataFragment);
      })
      .catch(() => undefined);
  }, []);

  // Return to the immersive Home wall: pause + unload the video and re-enter
  // lobby mode. The XR session, dome, and controllers all stay alive.
  const handleGoHome = useCallback(() => {
    const v = videoRef.current;
    if (v) {
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
        case "nextMarker":
          seekToMarker(1);
          break;
        case "prevMarker":
          seekToMarker(-1);
          break;
        case "toggleCaptions":
          toggleCaptions();
          break;
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
        case "navigateToScene":
          handleNavigateToScene(a.sceneId);
          break;
        case "goHome":
          handleGoHome();
          break;
        // scenesPanelToggle is handled in-manager (see routeSelect).
        // ── Handy interactive device ──
        case "handyConnect":
          ctxRef.current.initialise().catch(() => undefined);
          break;
        case "handySync":
          ctxRef.current.sync().catch(() => undefined);
          break;
        case "handyToggle":
          handyRef.current.emergencyStop?.();
          break;
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
      toggleCaptions,
      onNext,
      onPrevious,
      handleNavigateToScene,
      handleSwitchScene,
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
  }, []);

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
    // Guard against redundant reloads: only (re)assign the source when it
    // actually changes. Prevents mid-playback restarts from re-renders.
    if (loadedSrcRef.current === sources[0]) return;
    loadedSrcRef.current = sources[0];
    sourceIdx.current = 0;
    v.src = sources[0];

    const onError = () => {
      if (sourceIdx.current < sources.length - 1) {
        sourceIdx.current += 1;
        loadedSrcRef.current = sources[sourceIdx.current];
        v.src = sources[sourceIdx.current];
        v.load();
        v.play().catch(() => undefined);
      } else {
        setError("Unable to play this scene in VR (codec unsupported).");
      }
    };
    v.addEventListener("error", onError);
    v.play().catch(() => undefined);
    return () => v.removeEventListener("error", onError);
  }, [sources]);

  // Track the active caption cue for the in-VR caption line.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !v.textTracks.length) return;
    const track = v.textTracks[0];
    const onCue = () => {
      if (!captionsOnRef.current) return;
      const cues = track.activeCues;
      activeCueRef.current =
        cues && cues.length
          ? Array.from(cues)
              .map((c) => (c as VTTCue).text)
              .join("\n")
          : null;
    };
    track.addEventListener("cuechange", onCue);
    return () => track.removeEventListener("cuechange", onCue);
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
      getCaption: () => (captionsOnRef.current ? activeCueRef.current : null),
      getHandyState: () => buildHandyState(),
      getFunscriptLoaded: () => getFunscriptLoaded(),
      getScenes: () => getScenes(),
      getHomeScenes: () => getHomeScenes(),
      lobby: startedInLobbyRef.current,
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
          // The library query may have resolved before the manager existed.
          if (homeScenesRef.current.length) {
            manager.updateHomeScenes(homeScenesRef.current);
          }
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
    getScenes,
    getHomeScenes,
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

  // Generate the funscript heatmap strip for the scrubber.
  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    if (!liveScene.interactive || !liveScene.paths.funscript) {
      manager.setHeatmap(null);
      return;
    }
    let cancelled = false;
    fetch(liveScene.paths.funscript)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const actions = data?.actions;
        if (Array.isArray(actions) && actions.length >= 2) {
          manager.setHeatmap(generateFunscriptWaveform(actions));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [liveScene.interactive, liveScene.paths.funscript, videoEl]);

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
