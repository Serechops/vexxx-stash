/**
 * ImmersiveVRPlayer — React root for the immersive WebXR session.
 *
 * Owns the <video> element (source selection, captions), the projection state
 * and all action handling, and bridges to the imperative [XRSessionManager].
 * Lazy-loaded by [EnterVRButton] so three.js never enters the main bundle.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Button, Typography } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { languageMap } from "src/utils/caption";
import { generateFunscriptWaveform } from "src/utils/funscriptWaveform";
import { XRSessionManager } from "./xrSession";
import { VRThumbnails } from "./vttThumbnails";
import { useVRPlayback } from "./useVRPlayback";
import {
  IProjectionSettings,
  clampZoom,
  cycleFov,
  cycleStereo,
  projectionForVrMode,
} from "./projection";
import { VRControlAction, IVRMarker, IVRPlaybackState } from "./types";

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

  const getChapterTitle = useCallback((): string | null => {
    const v = videoRef.current;
    if (!v) return null;
    const t = v.currentTime;
    const active = [...markersRef.current]
      .reverse()
      .find((m) => t >= m.seconds);
    return active ? active.title : null;
  }, []);

  const getState = useCallback((): IVRPlaybackState => {
    const v = videoRef.current;
    if (!v) {
      return {
        paused: true,
        currentTime: 0,
        duration: 0,
        volume: 1,
        muted: false,
        playbackRate: 1,
        bufferedAhead: 0,
        waiting: false,
        captionsOn: captionsOnRef.current,
      };
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
    return {
      paused: v.paused,
      currentTime: v.currentTime,
      duration: v.duration,
      volume: v.volume,
      muted: v.muted,
      playbackRate: v.playbackRate,
      bufferedAhead,
      waiting: v.readyState < 3 && !v.paused,
      captionsOn: captionsOnRef.current,
    };
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
        case "toggleLock":
          managerRef.current?.toggleLock();
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
      }
    },
    [seekToMarker, toggleCaptions, onNext, onPrevious]
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
      getState,
      getMarkers: () => markersRef.current,
      getChapterTitle,
      getCaption: () => (captionsOnRef.current ? activeCueRef.current : null),
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
  }, [videoEl, session, getState, getChapterTitle]);

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
