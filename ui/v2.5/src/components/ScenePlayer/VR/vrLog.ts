/**
 * vrLog — opt-in wireless telemetry for diagnosing immersive-player playback
 * hiccups from the dev machine while streaming on the headset.
 *
 * Activate with `?vrlog=1` (defaults to https://<page-host>:9444/log), or
 * `?vrlog=<port>` / `?vrlog=<host:port>`, or localStorage key `vrlog`. When not
 * set this is an inert no-op, so it can ship safely.
 *
 * It samples the <video> element every 500ms (currentTime progression, decode
 * drops via getVideoPlaybackQuality, buffer-ahead, readyState) and forwards the
 * media element's stall/playback events, batching to the collector
 * (scripts/vrlog-server.mjs) once a second. setInterval keeps running inside an
 * immersive XR session (only rAF is redirected), so sampling continues in-headset.
 *
 * The point of the telemetry: distinguish the black-box hiccup's cause —
 *   decode-bound  -> `ddrop` spikes (dropped frames climbing)
 *   network-bound -> `bufAhead` collapses toward 0 + `waiting`/`stalled` events
 *   playback freeze-> `stuck` (currentTime not advancing while playing)
 */

type Entry = Record<string, unknown>;

function shortSrc(s: string): string {
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.pathname + (u.search ? `?${u.search.slice(1, 48)}` : "");
  } catch {
    return s.slice(0, 96);
  }
}

class VRLog {
  private endpoint: string | null = null;
  private queue: Entry[] = [];
  private t0 = 0;
  private sampleTimer: number | null = null;
  private flushTimer: number | null = null;
  private video: HTMLVideoElement | null = null;
  private listeners: Array<[string, EventListener]> = [];
  private lastCt = -1;
  private lastDropped = 0;
  private longtaskObs: PerformanceObserver | null = null;
  private _profile: string | null = null;

  get active(): boolean {
    return this.endpoint !== null;
  }

  /**
   * Active diagnostic profile (`"jitter"` | null). When set, telemetry is scoped
   * to one concern: the generic 500ms sampler is silenced and the media-event
   * set is trimmed, so the render-loop profiler in xrSession owns the signal.
   * Set via `?vrprofile=jitter` (or localStorage `vrprofile`).
   */
  get profile(): string | null {
    return this._profile;
  }

  private resolveEndpoint(): string | null {
    try {
      const url = new URLSearchParams(window.location.search).get("vrlog");
      const ls = window.localStorage.getItem("vrlog");
      const raw = (url ?? ls ?? "").trim();
      if (!raw) return null;
      const host = window.location.hostname;
      if (raw === "1" || raw === "true") return `https://${host}:9444/log`;
      if (/^\d+$/.test(raw)) return `https://${host}:${raw}/log`;
      const target = raw.includes(":") ? raw : `${raw}:9444`;
      return `https://${target}/log`;
    } catch {
      return null;
    }
  }

  /** Resolve the active diagnostic profile from `?vrprofile=` / localStorage. */
  private resolveProfile(): string | null {
    try {
      const url = new URLSearchParams(window.location.search).get("vrprofile");
      const ls = window.localStorage.getItem("vrprofile");
      const raw = (url ?? ls ?? "").trim().toLowerCase();
      return raw || null;
    } catch {
      return null;
    }
  }

  /** Begin telemetry if a `vrlog` target is configured; otherwise a no-op. */
  start(video: HTMLVideoElement | null): void {
    if (this.endpoint) {
      if (video) this.attach(video);
      return;
    }
    const ep = this.resolveEndpoint();
    if (!ep) return;
    this.endpoint = ep;
    this._profile = this.resolveProfile();
    this.t0 = performance.now();
    this.note("session", {
      ua: navigator.userAgent,
      page: window.location.href,
      ep,
      profile: this._profile,
    });
    if (video) this.attach(video);
    this.sampleTimer = window.setInterval(() => this.sample(), 500);
    this.flushTimer = window.setInterval(() => this.flush(), 1000);
    // Long-task observer — catches main-thread blocks >50ms with what limited
    // attribution the browser exposes. Confirms whether the between-frame XR
    // stalls are JS on the main thread (caught here) vs the compositor skipping
    // frames for non-JS reasons (decode/GPU/thermal — NOT caught here).
    try {
      if ("PerformanceObserver" in window) {
        // In jitter mode, drop the threshold to 16ms (~one frame) so the
        // sub-50ms task floods (Apollo normalization / React reconciliation)
        // that the default 50ms gate hides become visible.
        const ltMin = this._profile === "jitter" ? 16 : 50;
        this.longtaskObs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.duration < ltMin) continue;
            const a = (e as PerformanceEntry & {
              attribution?: Array<{
                name?: string;
                containerType?: string;
                containerName?: string;
                containerSrc?: string;
              }>;
            }).attribution?.[0];
            this.note("longtask", {
              dur: Math.round(e.duration),
              name: e.name,
              ct: a?.containerType,
              cn: a?.containerName,
              csrc: a?.containerSrc,
            });
          }
        });
        this.longtaskObs.observe({ entryTypes: ["longtask"] });
      }
    } catch {
      /* longtask unsupported — ignore */
    }
  }

  /** Point telemetry at the active <video> element and wire its events. */
  attach(video: HTMLVideoElement): void {
    if (!this.endpoint || this.video === video) return;
    this.detachVideo();
    this.video = video;
    this.lastCt = -1;
    this.lastDropped = 0;
    // Jitter profile: keep only the events that signal a decode-side cause of
    // playback judder (refill stalls / rate changes / errors). The transport +
    // scene-switch events (play/pause/seek/loadedmetadata/emptied…) are dropped
    // so the log stays scoped to steady-state playback.
    const evs =
      this._profile === "jitter"
        ? ["waiting", "stalled", "playing", "ratechange", "error"]
        : [
            "waiting",
            "stalled",
            "playing",
            "play",
            "pause",
            "suspend",
            "ratechange",
            "error",
            "loadedmetadata",
            "loadeddata",
            "seeking",
            "seeked",
            "ended",
            "emptied",
          ];
    for (const name of evs) {
      const l: EventListener = () =>
        this.note(name, {
          ...this.vstats(),
          src: shortSrc(video.currentSrc),
        });
      video.addEventListener(name, l);
      this.listeners.push([name, l]);
    }
  }

  /** Record an arbitrary tagged event (also callable from the session manager). */
  note(ev: string, data?: Entry): void {
    if (!this.endpoint) return;
    this.queue.push({
      t: Math.round(performance.now() - this.t0),
      ev,
      ...(data || {}),
    });
    if (this.queue.length > 256) this.flush();
  }

  private vstats(): Entry {
    const v = this.video;
    if (!v) return {};
    let dropped = 0;
    let total = 0;
    const q = (
      v as HTMLVideoElement & {
        getVideoPlaybackQuality?: () => {
          droppedVideoFrames: number;
          totalVideoFrames: number;
        };
      }
    ).getVideoPlaybackQuality?.();
    if (q) {
      dropped = q.droppedVideoFrames;
      total = q.totalVideoFrames;
    }
    const buf = v.buffered;
    const bufEnd = buf.length ? buf.end(buf.length - 1) : 0;
    return {
      ct: +v.currentTime.toFixed(2),
      rs: v.readyState,
      ns: v.networkState,
      paused: v.paused,
      rate: v.playbackRate,
      bufAhead: +(bufEnd - v.currentTime).toFixed(2),
      dropped,
      total,
      vw: v.videoWidth,
      vh: v.videoHeight,
    };
  }

  private sample(): void {
    // In a scoped profile the render-loop profiler owns sampling; skip the
    // generic 500ms pulse so it doesn't flood the focused log.
    if (this._profile) return;
    const v = this.video;
    if (!v) {
      this.note("sample", {});
      return;
    }
    const s = this.vstats();
    const ct = s.ct as number;
    const dropped = s.dropped as number;
    const stuck = !v.paused && this.lastCt >= 0 && Math.abs(ct - this.lastCt) < 0.001;
    const ddrop = this.lastDropped >= 0 ? dropped - this.lastDropped : 0;
    this.lastCt = ct;
    this.lastDropped = dropped;
    this.note("sample", { ...s, stuck, ddrop, src: shortSrc(v.currentSrc) });
  }

  /** Force the current queue to the collector now — used around the scene-switch
   * leak probe so the last snapshot survives a hard OOM crash. */
  flushNow(): void {
    this.flush();
  }

  private flush(): void {
    if (!this.endpoint || this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    try {
      fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
        keepalive: true,
      }).catch(() => {
        /* collector down — drop this batch */
      });
    } catch {
      /* ignore */
    }
  }

  private detachVideo(): void {
    if (this.video) {
      for (const [n, l] of this.listeners) this.video.removeEventListener(n, l);
    }
    this.listeners = [];
    this.video = null;
  }

  stop(): void {
    this.flush();
    if (this.sampleTimer) window.clearInterval(this.sampleTimer);
    if (this.flushTimer) window.clearInterval(this.flushTimer);
    this.sampleTimer = null;
    this.flushTimer = null;
    if (this.longtaskObs) {
      this.longtaskObs.disconnect();
      this.longtaskObs = null;
    }
    this.detachVideo();
    this.endpoint = null;
    this._profile = null;
  }
}

/** Singleton — import and call `vrLog.start(video)` from the player. */
export const vrLog = new VRLog();
