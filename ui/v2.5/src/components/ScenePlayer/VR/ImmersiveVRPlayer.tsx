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
import { Box, Button, Typography } from "@mui/material";
import { useHistory } from "react-router-dom";
import * as GQL from "src/core/generated-graphql";
import { getClient } from "src/core/StashService";
import { languageMap } from "src/utils/caption";
import { generateFunscriptWaveform } from "src/utils/funscriptWaveform";
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
import { VRControlAction, IVRMarker, IVRPlaybackState, IVRHandyState } from "./types";

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

export interface IImmersiveVRPlayerProps {
  scene: GQL.SceneDataFragment;
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
  const patternRunnerRef = useRef<PatternRunner>(new PatternRunner(interactiveCtx.interactive));

  const [projection, setProjection] = useState<IProjectionSettings>(() =>
    projectionForVrMode(scene.vr_mode)
  );
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const sources = useMemo(() => candidateSources(scene), [scene.id]);
  const loadedSrcRef = useRef<string | null>(null);

  // Wire interactive sync + activity tracking to the live video element.
  useVRPlayback({ scene, video: videoEl });

  const markers = useMemo<IVRMarker[]>(
    () =>
      [...scene.scene_markers]
        .sort((a, b) => a.seconds - b.seconds)
        .map((m) => ({
          title: markerTitle(m),
          seconds: m.seconds,
          endSeconds: m.end_seconds ?? null,
        })),
    [scene.scene_markers]
  );
  const markersRef = useRef(markers);
  markersRef.current = markers;

  // Static, per-scene info for the performers + scene-info panels. Keyed on
  // scene.id (like `sources`) so cache-driven scene identity changes don't
  // rebuild it; it's only read once when the manager is created.
  const info = useMemo<IVRSceneInfo>(
    () => ({
      title: scene.title ?? "",
      performers: scene.performers.map((p) => ({
        name: p.name,
        imageUrl: p.image_path ?? null,
      })),
      tags: scene.tags.map((t) => t.name),
      markers: [...scene.scene_markers]
        .sort((a, b) => a.seconds - b.seconds)
        .map((m) => ({ title: markerTitle(m), seconds: m.seconds })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene.id]
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
    return !!(scene.interactive && scene.paths.funscript);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.interactive, scene.paths.funscript]);

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

  // ── VR Scenes panel data ───────────────────────────────────────────────
  // Exclude the current scene from the list so the user sees other VR content.
  const scenesRef = useRef<IVRSceneEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    getClient()
      .query<GQL.FindScenesQuery>({
        query: GQL.FindScenesDocument,
        variables: {
          scene_filter: {
            vr_mode: {
              value: [
                GQL.VrMode.Lr180,
                GQL.VrMode.Mono360,
                GQL.VrMode.Tb360,
              ],
              modifier: GQL.CriterionModifier.Includes,
            },
          },
        },
      })
      .then((result) => {
        if (cancelled) return;
        scenesRef.current = result.data.findScenes.scenes
          .filter((s) => s.id !== scene.id)
          .slice(0, 50)
          .map((s) => ({
            id: s.id,
            title: s.title ?? `Scene ${s.id}`,
            thumbnailUrl: s.paths.screenshot ?? null,
            streamUrl: s.paths.stream ?? null,
            studioName: s.studio?.name ?? null,
            performers: s.performers.map((p) => p.name),
          }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id]);

  const getScenes = useCallback((): IVRSceneEntry[] => {
    return scenesRef.current;
  }, []);

  // Handle navigation from VR scenes panel — exit VR then navigate.
  const handleNavigateToScene = useCallback(
    (sceneId: string) => {
      managerRef.current?.end();
      history.push(`/scenes/${sceneId}`);
    },
    [history]
  );

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
        case "navigateToScene":
          handleNavigateToScene(a.sceneId);
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
    [seekToMarker, toggleCaptions, onNext, onPrevious, handleNavigateToScene]
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
      if (sources.length === 0) setError("No playable source for this scene.");
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
      getThumbnail: (time) => thumbnailsRef.current?.getAt(time) ?? null,
      onAction: (a) => actionRef.current(a),
      onEnd: () => onExitRef.current(),
    });
    managerRef.current = manager;

    manager.init(session).catch((e) => {
      if (!disposed) setError(`Failed to start VR session: ${e?.message ?? e}`);
    });

    return () => {
      disposed = true;
      manager.dispose();
      managerRef.current = null;
    };
  }, [videoEl, session, getState, getChapterTitle, buildHandyState, getFunscriptLoaded, getScenes]);

  // Push projection changes to the dome renderer.
  useEffect(() => {
    managerRef.current?.setProjection(projection);
  }, [projection]);

  // Load VTT thumbnails for the scrubber-hover preview (read via the manager's
  // getThumbnail closure each frame, so no manager re-creation is needed).
  useEffect(() => {
    if (!scene.paths.vtt) {
      thumbnailsRef.current = null;
      return;
    }
    const t = new VRThumbnails();
    thumbnailsRef.current = t;
    t.load(scene.paths.vtt).catch(() => undefined);
    return () => {
      t.dispose();
      if (thumbnailsRef.current === t) thumbnailsRef.current = null;
    };
  }, [scene.paths.vtt]);

  // Generate the funscript heatmap strip for the scrubber.
  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    if (!scene.interactive || !scene.paths.funscript) {
      manager.setHeatmap(null);
      return;
    }
    let cancelled = false;
    fetch(scene.paths.funscript)
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
  }, [scene.interactive, scene.paths.funscript, videoEl]);

  const captionTracks = useMemo(() => {
    if (!scene.captions) return [];
    return scene.captions.map((c) => {
      const lang = c.language_code;
      const label = `${languageMap.get(lang) ?? lang} (${c.caption_type})`;
      return {
        src: `${scene.paths.caption}?lang=${lang}&type=${c.caption_type}`,
        lang,
        label,
      };
    });
  }, [scene.captions, scene.paths.caption]);

  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "rgba(0,0,0,0.92)",
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
        poster={scene.paths.screenshot ?? undefined}
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

      <Typography variant="h6" sx={{ color: "white", zIndex: 31 }}>
        {error ? "VR Player" : "Immersive VR active"}
      </Typography>
      <Typography variant="body2" sx={{ color: "grey.400", zIndex: 31 }}>
        {error ??
          "Put on your headset to watch. Remove it or press Exit to return."}
      </Typography>
      <Button
        variant="outlined"
        color="inherit"
        sx={{
          color: "white",
          borderColor: "rgba(255,255,255,0.4)",
          zIndex: 31,
        }}
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
