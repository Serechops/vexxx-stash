/**
 * useVRPlayback — wires the immersive player's raw <video> element into the
 * same app-level concerns the 2D VideoJS player handles:
 *   - interactive / funscript (Handy) sync via [InteractiveContext]
 *   - play-count + resume-time activity tracking (mirrors [track-activity.ts])
 *
 * Kept as a hook so the GL/session code in [xrSession.ts] stays UI-framework
 * agnostic.
 */
import { useContext, useEffect, useRef } from "react";
import {
  ConnectionState,
  InteractiveContext,
} from "src/hooks/Interactive/context";
import {
  useSceneSaveActivity,
  useSceneIncrementPlayCount,
} from "src/core/StashService";
import { useConfigurationContext } from "src/hooks/Config";
import * as GQL from "src/core/generated-graphql";
import { isStashSceneId } from "./types";
import { vrLog } from "./vrLog";

const INTERVAL_SECONDS = 1;
const SEND_INTERVAL_SECONDS = 10;

/** Plain-DOM port of TrackActivityPlugin's play-count/resume bookkeeping. */
class VRActivityTracker {
  enabled = true;
  minimumPlayPercent = 0;
  countOnStart = false;
  segmentStart = 0;
  segmentEnd = 0;
  saveActivity: (resume: number, playDuration: number) => Promise<void> = () =>
    Promise.resolve();
  incrementPlayCount: () => Promise<void> = () => Promise.resolve();

  private total = 0;
  private current = 0;
  private lastResume = 0;
  private lastDuration = 0;
  private incremented = false;
  private intervalId: number | undefined;
  private video: HTMLVideoElement | null = null;

  attach(video: HTMLVideoElement) {
    this.video = video;
  }

  start() {
    if (!this.enabled || this.intervalId || !this.video) return;
    if (this.countOnStart && !this.incremented) {
      this.incrementPlayCount();
      this.incremented = true;
    }
    this.lastResume = this.video.currentTime;
    this.lastDuration = this.video.duration;
    this.intervalId = window.setInterval(
      () => this.tick(),
      INTERVAL_SECONDS * 1000
    );
  }

  stop() {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = undefined;
      this.send();
    }
  }

  private get effectiveDuration(): number {
    const dur = this.video?.duration ?? this.lastDuration;
    if (this.segmentEnd > 0) return this.segmentEnd - this.segmentStart;
    return dur;
  }

  private tick() {
    if (!this.enabled || !this.video) return;
    this.lastResume = this.video.currentTime;
    this.lastDuration = this.video.duration;
    this.total += INTERVAL_SECONDS;
    this.current += INTERVAL_SECONDS;
    if (this.total % SEND_INTERVAL_SECONDS === 0) this.send();
  }

  private send() {
    if (this.total <= 0) return;
    let resumeTime = this.video?.currentTime ?? this.lastResume;
    const eff = this.effectiveDuration;
    const segmentPos = resumeTime - this.segmentStart;
    const percentCompleted = eff > 0 ? (100 / eff) * segmentPos : 0;
    const percentPlayed = eff > 0 ? (100 / eff) * this.total : 0;

    if (
      this.enabled &&
      !this.incremented &&
      percentPlayed >= this.minimumPlayPercent
    ) {
      this.incrementPlayCount();
      this.incremented = true;
    }
    if (percentCompleted >= 98) {
      resumeTime = this.segmentStart > 0 ? this.segmentStart : 0;
    }
    this.saveActivity(resumeTime, this.current);
    this.current = 0;
  }
}

export function useVRPlayback(params: {
  scene: GQL.SceneDataFragment;
  video: HTMLVideoElement | null;
  /**
   * Manual activation gate. When false the device is left completely idle even
   * if the InteractiveContext has auto-connected — the funscript is not
   * uploaded and no play/seek drives the device. Flipping it true arms the
   * device for the current scene; flipping it false pauses it immediately.
   */
  interactiveEnabled: boolean;
}) {
  const { scene, video, interactiveEnabled } = params;
  const { configuration } = useConfigurationContext();
  const uiConfig = configuration?.ui;

  const {
    interactive: interactiveClient,
    state: interactiveState,
    initialised: interactiveInitialised,
    uploadScript,
  } = useContext(InteractiveContext);

  const [sceneSaveActivity] = useSceneSaveActivity();
  const [sceneIncrementPlayCount] = useSceneIncrementPlayCount();

  const interactiveReady = useRef(false);
  const tracker = useRef(new VRActivityTracker());

  // Upload the funscript when the scene is interactive — but only once the user
  // has armed the device. Until then we leave it idle (nothing uploaded, so
  // interactiveReady stays false and playback never drives the device). When the
  // upload completes while already playing, start motion so arming mid-scene
  // takes effect without waiting for the next play event.
  useEffect(() => {
    if (scene.interactive && interactiveInitialised && interactiveEnabled) {
      interactiveReady.current = false;
      uploadScript(scene.paths.funscript || "").then(() => {
        interactiveReady.current = true;
        if (interactiveEnabled && video && !video.paused) {
          interactiveClient.play(video.currentTime);
        }
      });
    }
  }, [
    uploadScript,
    interactiveInitialised,
    interactiveEnabled,
    interactiveClient,
    video,
    scene.interactive,
    scene.paths.funscript,
  ]);

  // Disarming (or losing arm on scene change) pauses the device immediately so
  // it can't keep stroking to a stale script.
  useEffect(() => {
    if (!interactiveEnabled) {
      interactiveReady.current = false;
      interactiveClient.pause();
    }
  }, [interactiveEnabled, interactiveClient]);

  // Configure the activity tracker from UI config + scene segment bounds.
  useEffect(() => {
    const t = tracker.current;
    t.enabled = uiConfig?.trackActivity ?? true;
    t.minimumPlayPercent = uiConfig?.minimumPlayPercent ?? 0;
    t.countOnStart = uiConfig?.countOnStart ?? false;
    t.segmentStart = scene.start_point ?? 0;
    t.segmentEnd = scene.end_point ?? 0;
    t.saveActivity = async (resume, playDuration) => {
      if (!isStashSceneId(scene.id)) return;
      // Jitter probe: bracket the mutation so the profiler can see its cost
      // window (network + Apollo cache write + the re-render it triggers) and
      // line it up against a main-thread stall. Inert outside vrprofile=jitter.
      vrLog.note("activity_send", { id: scene.id });
      const t0 = performance.now();
      await sceneSaveActivity({
        variables: { id: scene.id, playDuration, resume_time: resume },
        // Smooth-playback fix: the shared hook's `update()` runs cache.modify on
        // the Scene's resume_time/play_duration fields, which invalidates the
        // watched query feeding `scene` and re-renders the whole immersive tree
        // on the XR main thread every 10s — measured as a 50–100ms frame-dropping
        // longtask (plus a GC after-shock). The mutation returns only a Boolean,
        // so the manual update is the sole cache effect; override it with a no-op
        // to keep the activity save off the render-critical path. The server
        // still records resume_time/play_duration; only the optimistic local
        // cache update is skipped (refreshed on next fetch). Scoped to VR — the
        // 2D player keeps the shared hook's optimistic behaviour.
        update: () => {},
      });
      vrLog.note("activity_done", { ms: +(performance.now() - t0).toFixed(1) });
    };
    t.incrementPlayCount = async () => {
      if (!isStashSceneId(scene.id)) return;
      vrLog.note("playcount_send", { id: scene.id });
      await sceneIncrementPlayCount({
        variables: { id: scene.id },
        // Same render-loop hazard as saveActivity above: the shared hook's
        // `update()` runs cache.modify on the Scene's play_count/last_played_at/
        // play_history (plus updateStats), invalidating the watched query that
        // feeds `scene` and re-rendering the whole immersive tree on the XR main
        // thread. It fires once, ~15s in when the min-play-percent threshold is
        // crossed — measured as an ~88ms longtask + ~286ms GC aftershock (dt=288
        // frame stall). Override with a no-op so the increment stays off the
        // render-critical path; the server still records the play (refreshed on
        // next fetch). Scoped to VR — the 2D player keeps optimistic behaviour.
        update: () => {},
      });
      vrLog.note("playcount_done", {});
    };
  }, [
    uiConfig?.trackActivity,
    uiConfig?.minimumPlayPercent,
    uiConfig?.countOnStart,
    scene.id,
    scene.start_point,
    scene.end_point,
    sceneSaveActivity,
    sceneIncrementPlayCount,
  ]);

  // Wire video element events → interactive client + activity tracker.
  useEffect(() => {
    if (!video) return;
    const t = tracker.current;
    t.attach(video);

    const onPlaying = () => {
      t.start();
      if (interactiveEnabled && scene.interactive && interactiveReady.current) {
        interactiveClient.play(video.currentTime);
      }
    };
    const onPause = () => {
      t.stop();
      interactiveClient.pause();
    };
    const onSeeking = () => {
      if (
        interactiveEnabled &&
        !video.paused &&
        scene.interactive &&
        interactiveReady.current
      ) {
        interactiveClient.play(video.currentTime);
      }
    };
    const onWaiting = () => t.stop();
    const onEnded = () => t.stop();
    // Drift correction: the device's script clock free-runs, so without a
    // periodic nudge it walks away from the video over a long scene. The client
    // throttles the sync ops itself, so this is cheap on `timeupdate`.
    const onTimeUpdate = () => {
      if (
        interactiveEnabled &&
        !video.paused &&
        scene.interactive &&
        interactiveReady.current
      ) {
        interactiveClient.ensurePlaying(video.currentTime);
      }
    };

    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", onTimeUpdate);

    return () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTimeUpdate);
      t.stop();
      interactiveClient.pause();
    };
  }, [video, scene.interactive, interactiveClient, interactiveEnabled]);

  // If the script becomes ready while already playing, start it — but only when
  // the user has armed the device.
  useEffect(() => {
    if (!interactiveEnabled) return;
    if (interactiveState !== ConnectionState.Ready) return;
    if (!video || video.paused) return;
    interactiveClient.ensurePlaying(video.currentTime);
  }, [interactiveEnabled, interactiveState, video, interactiveClient]);
}
