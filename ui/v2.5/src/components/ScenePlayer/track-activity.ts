import videojs, { VideoJsPlayer } from "video.js";

const intervalSeconds = 1; // check every second
const sendInterval = 10; // send every 10 seconds

class TrackActivityPlugin extends videojs.getPlugin("plugin") {
  totalPlayDuration = 0;
  currentPlayDuration = 0;
  minimumPlayPercent = 0;
  /**
   * When true, increment the play count immediately when playback begins
   * (covers manual play, autoplay, and queue/playlist auto-advance).
   * Supersedes the minimumPlayPercent threshold.
   */
  countOnStart = false;
  /**
   * Start time of the virtual segment (seconds into the video file).
   * Set to 0 for non-virtual scenes.
   */
  segmentStart = 0;
  /**
   * End time of the virtual segment (seconds into the video file).
   * Set to 0 to use the full video duration.
   */
  segmentEnd = 0;
  incrementPlayCount: () => Promise<void> = () => {
    return Promise.resolve();
  };
  saveActivity: (resumeTime: number, playDuration: number) => Promise<void> =
    () => {
      return Promise.resolve();
    };

  private enabled = false;
  private playCountIncremented = false;
  private intervalID: number | undefined;

  private lastResumeTime = 0;
  private lastDuration = 0;

  constructor(player: VideoJsPlayer) {
    super(player);

    player.on("playing", () => {
      this.start();
      if (this.countOnStart && this.enabled && !this.playCountIncremented) {
        this.incrementPlayCount();
        this.playCountIncremented = true;
      }
    });

    player.on("waiting", () => {
      this.stop();
    });

    player.on("stalled", () => {
      this.stop();
    });

    player.on("pause", () => {
      this.stop();
    });

    player.on("dispose", () => {
      this.stop();
    });

    player.on("ended", () => {
      this.stop();
    });
  }

  private start() {
    if (this.enabled && !this.intervalID) {
      this.intervalID = window.setInterval(() => {
        this.intervalHandler();
      }, intervalSeconds * 1000);
      this.lastResumeTime = this.player.currentTime();
      this.lastDuration = this.player.duration();
    }
  }

  private stop() {
    if (this.intervalID) {
      window.clearInterval(this.intervalID);
      this.intervalID = undefined;
      this.sendActivity();
    }
  }

  reset() {
    this.stop();
    this.totalPlayDuration = 0;
    this.currentPlayDuration = 0;
    this.playCountIncremented = false;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
    } else if (!this.player.paused()) {
      this.start();
    }
  }

  private intervalHandler() {
    if (!this.enabled || !this.player) return;

    this.lastResumeTime = this.player.currentTime();
    this.lastDuration = this.player.duration();

    this.totalPlayDuration += intervalSeconds;
    this.currentPlayDuration += intervalSeconds;
    if (this.totalPlayDuration % sendInterval === 0) {
      this.sendActivity();
    }
  }

  /** Effective duration for percentage calculations.
   * For virtual segments this is (segmentEnd - segmentStart),
   * otherwise the full video duration.
   */
  private get effectiveDuration(): number {
    const videoDuration = this.player?.duration() ?? this.lastDuration;
    if (this.segmentEnd > 0) {
      return this.segmentEnd - this.segmentStart;
    }
    return videoDuration;
  }

  private sendActivity() {
    // Always flush pending activity even when disabled (e.g. user turns off
    // tracking mid-session — we still persist the chunk already accumulated).
    if (this.totalPlayDuration <= 0) return;

    let resumeTime = this.player?.currentTime() ?? this.lastResumeTime;
    const effectiveDuration = this.effectiveDuration;

    // For virtual segments, express completion relative to segment bounds.
    const segmentPosition = resumeTime - this.segmentStart;
    const percentCompleted =
      effectiveDuration > 0 ? (100 / effectiveDuration) * segmentPosition : 0;
    const percentPlayed =
      effectiveDuration > 0
        ? (100 / effectiveDuration) * this.totalPlayDuration
        : 0;

    if (this.enabled && !this.playCountIncremented && percentPlayed >= this.minimumPlayPercent) {
      this.incrementPlayCount();
      this.playCountIncremented = true;
    }

    // If the segment (or video) is ≥98% complete, reset resume_time so
    // next play starts from the beginning of the segment.
    if (percentCompleted >= 98) {
      resumeTime = this.segmentStart > 0 ? this.segmentStart : 0;
    }

    this.saveActivity(resumeTime, this.currentPlayDuration);
    this.currentPlayDuration = 0;
  }
}

// Register the plugin with video.js.
videojs.registerPlugin("trackActivity", TrackActivityPlugin);

/* eslint-disable @typescript-eslint/naming-convention */
declare module "video.js" {
  interface VideoJsPlayer {
    trackActivity: () => TrackActivityPlugin;
  }
  interface VideoJsPlayerPluginOptions {
    trackActivity?: {};
  }
}

export default TrackActivityPlugin;
