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
}) {
  const { scene, video } = params;
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

  // Upload the funscript when the scene is interactive.
  useEffect(() => {
    if (scene.interactive && interactiveInitialised) {
      interactiveReady.current = false;
      uploadScript(scene.paths.funscript || "").then(() => {
        interactiveReady.current = true;
      });
    }
  }, [
    uploadScript,
    interactiveInitialised,
    scene.interactive,
    scene.paths.funscript,
  ]);

  // Configure the activity tracker from UI config + scene segment bounds.
  useEffect(() => {
    const t = tracker.current;
    t.enabled = uiConfig?.trackActivity ?? true;
    t.minimumPlayPercent = uiConfig?.minimumPlayPercent ?? 0;
    t.countOnStart = uiConfig?.countOnStart ?? false;
    t.segmentStart = scene.start_point ?? 0;
    t.segmentEnd = scene.end_point ?? 0;
    t.saveActivity = async (resume, playDuration) => {
      if (!scene.id) return;
      await sceneSaveActivity({
        variables: { id: scene.id, playDuration, resume_time: resume },
      });
    };
    t.incrementPlayCount = async () => {
      if (!scene.id) return;
      await sceneIncrementPlayCount({ variables: { id: scene.id } });
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
      if (scene.interactive && interactiveReady.current) {
        interactiveClient.play(video.currentTime);
      }
    };
    const onPause = () => {
      t.stop();
      interactiveClient.pause();
    };
    const onSeeking = () => {
      if (!video.paused && scene.interactive && interactiveReady.current) {
        interactiveClient.play(video.currentTime);
      }
    };
    const onWaiting = () => t.stop();
    const onEnded = () => t.stop();

    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("ended", onEnded);

    return () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("ended", onEnded);
      t.stop();
      interactiveClient.pause();
    };
  }, [video, scene.interactive, interactiveClient]);

  // If the script becomes ready while already playing, start it.
  useEffect(() => {
    if (interactiveState !== ConnectionState.Ready) return;
    if (!video || video.paused) return;
    interactiveClient.ensurePlaying(video.currentTime);
  }, [interactiveState, video, interactiveClient]);
}
