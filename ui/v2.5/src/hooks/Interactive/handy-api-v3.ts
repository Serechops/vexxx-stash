/**
 * Handy API v3 Client — TypeScript port
 * Wraps all REST endpoints for The Handy device.
 * @see https://www.handyfeeling.com/api/handy-rest/v3/docs/
 */

const HANDY_BASE_URL = "https://www.handyfeeling.com/api/handy-rest/v3";

// ── Response types we consume ───────────────────────────────────────────────

export interface HandyConnectedResponse {
  connected: boolean;
}

export interface HandyInfoResponse {
  result?: {
    firmwareVersion?: string;
    hardwareVersion?: string;
    sessionId?: string;
    fwStatus?: number;
  };
}

interface HandyServerTimeResponse {
  server_time: number;
}

interface TimeSyncSample {
  rtd: number;
  offset: number;
}

interface QueuedRequest {
  path: string;
  opts: RequestInit;
  resolve: (data: Record<string, unknown>) => void;
  reject: (reason: unknown) => void;
}

// ── Error class ─────────────────────────────────────────────────────────────

export class HandyAPIError extends Error {
  readonly code?: number;
  readonly apiName?: string;
  readonly connected?: boolean;

  constructor(error: {
    message?: string;
    code?: number;
    name?: string;
    connected?: boolean;
  }) {
    super(error.message ?? "Unknown Handy API error");
    this.name = "HandyAPIError";
    this.code = error.code;
    this.apiName = error.name;
    this.connected = error.connected;
  }
}

// ── Client ──────────────────────────────────────────────────────────────────

export class HandyAPIv3 {
  private _appKey: string;
  private _connectionKey: string | null;
  private _bearerToken: string | null;
  private _tokenExpiresAt: number;
  private _tokenTTL: number;
  private _queue: QueuedRequest[];
  private _isOnline: boolean;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null;

  // Server time synchronization state
  private _serverTimeOffset: number;
  private _isTimeSynced: boolean;
  private _lastSyncRtd: number;
  private _lastSyncSampleCount: number;
  private _lastSyncTimestamp: number;
  private _estimatedLatency: number;

  constructor(appKey?: string) {
    this._appKey = appKey ?? "";
    this._connectionKey = null;
    this._bearerToken = null;
    this._tokenExpiresAt = 0;
    this._tokenTTL = 3600;
    this._queue = [];
    this._isOnline = true;
    this._heartbeatTimer = null;
    this._serverTimeOffset = 0;
    this._isTimeSynced = false;
    this._lastSyncRtd = 0;
    this._lastSyncSampleCount = 0;
    this._lastSyncTimestamp = 0;
    this._estimatedLatency = 50;
    this._startHeartbeat();
  }

  private _startHeartbeat(): void {
    this._heartbeatTimer = setInterval(async () => {
      if (this._connectionKey && this._bearerToken) {
        try {
          await this._get("/connected");
          this._setOnline(true);
        } catch {
          this._setOnline(false);
        }
      }
    }, 5000);
  }

  private _setOnline(status: boolean): void {
    if (this._isOnline !== status) {
      this._isOnline = status;
      if (status) {
        void this._flushQueue();
      }
    }
  }

  private async _flushQueue(): Promise<void> {
    if (this._queue.length === 0) return;
    const toFlush = [...this._queue];
    this._queue = [];
    for (const req of toFlush) {
      try {
        const res = await fetch(`${HANDY_BASE_URL}${req.path}`, req.opts);
        const data = (await res.json()) as Record<string, unknown>;
        if (data["error"])
          throw new HandyAPIError(
            data["error"] as { message?: string; code?: number }
          );
        req.resolve(data);
      } catch (e) {
        req.reject(e);
      }
    }
  }

  setConnectionKey(ck: string): void {
    this._connectionKey = ck;
  }

  setAppKey(key: string): void {
    this._appKey = key;
  }

  get connectionKey(): string | null {
    return this._connectionKey;
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  private _headers(useConnectionKey = true): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this._bearerToken) {
      h["Authorization"] = `Bearer ${this._bearerToken}`;
    } else if (this._appKey) {
      h["X-Api-Key"] = this._appKey;
    }
    if (useConnectionKey && this._connectionKey) {
      h["X-Connection-Key"] = this._connectionKey;
    }
    return h;
  }

  private async _get(
    path: string,
    useConnectionKey = true
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${HANDY_BASE_URL}${path}`, {
      method: "GET",
      headers: this._headers(useConnectionKey),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    }
    const data = (await res.json()) as Record<string, unknown>;
    if (data["error"])
      throw new HandyAPIError(
        data["error"] as { message?: string; code?: number }
      );
    return data;
  }

  private async _put(
    path: string,
    body?: unknown,
    useConnectionKey = true
  ): Promise<Record<string, unknown>> {
    const opts: RequestInit = {
      method: "PUT",
      headers: this._headers(useConnectionKey),
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    if (!this._isOnline && path !== "/mode2" && path !== "/hsp/setup") {
      return new Promise((resolve, reject) => {
        this._queue.push({ path, opts, resolve, reject });
      });
    }

    try {
      const res = await fetch(`${HANDY_BASE_URL}${path}`, opts);
      if (!res.ok) {
        let errorData: Record<string, unknown>;
        try {
          errorData = (await res.json()) as Record<string, unknown>;
        } catch {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
        }
        if (errorData["error"])
          throw new HandyAPIError(
            errorData["error"] as { message?: string; code?: number }
          );
        throw new Error(`HTTP ${res.status}: ${JSON.stringify(errorData)}`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      if (data["error"])
        throw new HandyAPIError(
          data["error"] as { message?: string; code?: number }
        );
      this._setOnline(true);
      return data;
    } catch (e) {
      if (e instanceof TypeError) {
        this._setOnline(false);
        return new Promise((resolve, reject) => {
          this._queue.push({ path, opts, resolve, reject });
        });
      }
      throw e;
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  async issueToken(ttl = 3600): Promise<Record<string, unknown>> {
    const res = await fetch(`${HANDY_BASE_URL}/auth/token/issue?ttl=${ttl}`, {
      headers: { "X-Api-Key": this._appKey, Accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Auth failed (HTTP ${res.status}): ${text || res.statusText}`);
    }
    const data = (await res.json()) as Record<string, unknown>;
    if (data["error"])
      throw new HandyAPIError(
        data["error"] as { message?: string; code?: number }
      );
    const result = data["result"] as Record<string, unknown> | undefined;
    const token = result?.["token"] as string | undefined;
    if (!token) throw new Error("No token received from auth endpoint");
    this._bearerToken = token;
    this._tokenTTL = ttl;
    this._tokenExpiresAt = Date.now() + ttl * 1000 - 60000;
    return data;
  }

  private async _ensureToken(): Promise<void> {
    if (this._bearerToken && Date.now() >= this._tokenExpiresAt) {
      await this.issueToken(this._tokenTTL);
    }
  }

  // ── Info ─────────────────────────────────────────────────────────────────

  async getInfo(): Promise<HandyInfoResponse> {
    await this._ensureToken();
    return this._get("/info") as unknown as Promise<HandyInfoResponse>;
  }

  async isConnected(): Promise<HandyConnectedResponse> {
    return this._get("/connected") as unknown as Promise<HandyConnectedResponse>;
  }

  async getMode(): Promise<Record<string, unknown>> {
    return this._get("/mode");
  }

  async getCapabilities(): Promise<Record<string, unknown>> {
    return this._get("/capabilities");
  }

  async getSliderState(): Promise<Record<string, unknown>> {
    return this._get("/slider/state");
  }

  async setMode(mode: number): Promise<Record<string, unknown>> {
    await this._ensureToken();
    return this._put("/mode2", { mode });
  }

  // ── HAMP ─────────────────────────────────────────────────────────────────

  async getHampState(): Promise<Record<string, unknown>> {
    return this._get("/hamp/state");
  }

  async hampStart(): Promise<Record<string, unknown>> {
    return this._put("/hamp/start");
  }

  async hampStop(): Promise<Record<string, unknown>> {
    return this._put("/hamp/stop");
  }

  /** velocity: 0–100 (will be normalized to 0–1) */
  async setHampVelocity(velocity: number): Promise<Record<string, unknown>> {
    return this._put("/hamp/velocity", { velocity: velocity / 100 });
  }

  /** min/max: 0.0–1.0 */
  async setHampStroke(
    min: number,
    max: number
  ): Promise<Record<string, unknown>> {
    return this._put("/slider/stroke", { min, max });
  }

  // ── HDSP ─────────────────────────────────────────────────────────────────

  async sendXpvp(
    xp: number,
    vp: number,
    stopOnTarget = false,
    immediateRsp = true
  ): Promise<Record<string, unknown>> {
    return this._put("/hdsp/xpvp", {
      xp,
      vp,
      stop_on_target: stopOnTarget,
      immediate_rsp: immediateRsp,
    });
  }

  async sendXat(
    xa: number,
    t: number,
    stopOnTarget = false,
    immediateRsp = true
  ): Promise<Record<string, unknown>> {
    return this._put("/hdsp/xat", {
      xa,
      t,
      stop_on_target: stopOnTarget,
      immediate_rsp: immediateRsp,
    });
  }

  // ── HSP ──────────────────────────────────────────────────────────────────

  async hspSetup(streamId?: number): Promise<Record<string, unknown>> {
    const stream_id =
      streamId ?? (Math.floor(Math.random() * 4294967294) + 1);
    return this._put("/hsp/setup", { stream_id });
  }

  async hspFlush(): Promise<Record<string, unknown>> {
    return this._put("/hsp/flush");
  }

  async hspAdd(
    points: Array<{ t: number; x: number }>,
    flush = false,
    tailPointStreamIndex?: number
  ): Promise<Record<string, unknown>> {
    if (!Array.isArray(points))
      throw new Error("[HandyAPIv3] hspAdd: points must be an array");
    if (points.length > 100) points = points.slice(0, 100);
    const sanitized = points.map((p) => ({
      t: Math.round(p.t),
      x: Math.round(Math.min(100, Math.max(0, p.x))),
    }));
    const body: Record<string, unknown> = { points: sanitized, flush };
    if (tailPointStreamIndex !== undefined)
      body["tail_point_stream_index"] = tailPointStreamIndex;
    return this._put("/hsp/add", body);
  }

  async hspPlay(
    loop = false,
    playbackRate = 1.0,
    startTime = 0,
    serverTime?: number,
    pauseOnStarving?: boolean
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      loop,
      playback_rate: playbackRate,
      start_time: startTime,
    };
    if (serverTime !== undefined) payload["server_time"] = serverTime;
    if (pauseOnStarving !== undefined)
      payload["pause_on_starving"] = pauseOnStarving;
    return this._put("/hsp/play", payload);
  }

  async hspStop(): Promise<Record<string, unknown>> {
    return this._put("/hsp/stop");
  }

  async hspPause(): Promise<Record<string, unknown>> {
    return this._put("/hsp/pause");
  }

  async hspResume(pickUp = false): Promise<Record<string, unknown>> {
    return this._put("/hsp/resume", { pick_up: pickUp });
  }

  async hspSetLoop(loop: boolean): Promise<Record<string, unknown>> {
    return this._put("/hsp/loop", { loop });
  }

  async hspSetPlaybackRate(rate: number): Promise<Record<string, unknown>> {
    return this._put("/hsp/playbackrate", { playback_rate: rate });
  }

  // ── HVP ──────────────────────────────────────────────────────────────────

  async getHvpState(): Promise<Record<string, unknown>> {
    return this._get("/hvp/state");
  }

  async hvpStart(): Promise<Record<string, unknown>> {
    return this._put("/hvp/start");
  }

  async hvpStop(): Promise<Record<string, unknown>> {
    return this._put("/hvp/stop");
  }

  /** amplitude: 0.0–1.0, frequency: 0–10000 Hz */
  async setHvpState(
    amplitude: number,
    frequency: number,
    position: number
  ): Promise<Record<string, unknown>> {
    return this._put("/hvp/state", { amplitude, frequency, position });
  }

  // ── HSSP ─────────────────────────────────────────────────────────────────

  async hsspSetup(url: string): Promise<Record<string, unknown>> {
    return this._put("/hssp/setup", { url });
  }

  async hsspPlay(
    startTime: number,
    serverTime: number,
    opts: { playbackRate?: number; loop?: boolean } = {}
  ): Promise<Record<string, unknown>> {
    return this._put("/hssp/play", {
      start_time: startTime,
      server_time: serverTime,
      playback_rate: opts.playbackRate ?? 1.0,
      loop: opts.loop ?? false,
    });
  }

  async hsspStop(): Promise<Record<string, unknown>> {
    return this._put("/hssp/stop");
  }

  async hsspGetState(): Promise<Record<string, unknown>> {
    return this._get("/hssp/state");
  }

  async hsspSetLoop(loop: boolean): Promise<Record<string, unknown>> {
    return this._put("/hssp/loop", { loop });
  }

  // ── Slider ────────────────────────────────────────────────────────────────

  async getStroke(): Promise<Record<string, unknown>> {
    return this._get("/slider/stroke");
  }

  async setStroke(settings: {
    min?: number;
    max?: number;
  }): Promise<Record<string, unknown>> {
    return this._put("/slider/stroke", settings);
  }

  // ── HSTP ──────────────────────────────────────────────────────────────────

  async hstpSetOffset(offset: number): Promise<Record<string, unknown>> {
    return this._put("/hstp/offset", { offset });
  }

  // ── Server time sync ──────────────────────────────────────────────────────

  async getServerTimeRaw(): Promise<HandyServerTimeResponse> {
    const res = await fetch(`${HANDY_BASE_URL}/servertime`, {
      headers: { Accept: "application/json" },
    });
    return res.json() as Promise<HandyServerTimeResponse>;
  }

  /**
   * Synchronize local clock with Handy server.
   * Uses sliding-window with outlier removal for high precision.
   * Returns the computed offset (ms to add to Date.now() to get server time).
   */
  async syncServerTime(
    opts: { samples?: number; outliers?: number } = {}
  ): Promise<number> {
    const samplesN = opts.samples ?? 10;
    const outliersN = opts.outliers ?? 3;

    if (
      this._isTimeSynced &&
      this._lastSyncTimestamp > 0 &&
      Date.now() - this._lastSyncTimestamp < 60000
    ) {
      return this._serverTimeOffset;
    }

    const samples: TimeSyncSample[] = [];

    for (let i = 0; i < samplesN; i++) {
      try {
        const tSend = Date.now();
        const res = await this.getServerTimeRaw();
        const tRecv = Date.now();
        if (res?.server_time) {
          const rtd = tRecv - tSend;
          const tsEst = res.server_time + rtd / 2;
          const offset = tsEst - tRecv;
          samples.push({ rtd, offset });
        }
      } catch {
        // continue on individual sample failures
      }
    }

    if (samples.length > outliersN) {
      samples.sort((a, b) => a.rtd - b.rtd);
      samples.splice(-outliersN);
      const offsetAccum = samples.reduce((acc, cur) => acc + cur.offset, 0);
      this._serverTimeOffset = Math.round(offsetAccum / samples.length);
      this._isTimeSynced = true;
      const avgRtd =
        samples.reduce((acc, cur) => acc + cur.rtd, 0) / samples.length;
      this._lastSyncRtd = avgRtd;
      this._lastSyncSampleCount = samples.length;
      this._lastSyncTimestamp = Date.now();
      this._estimatedLatency = avgRtd / 2;
    } else if (samples.length > 0) {
      const offsetAccum = samples.reduce((acc, cur) => acc + cur.offset, 0);
      this._serverTimeOffset = Math.round(offsetAccum / samples.length);
      this._isTimeSynced = true;
      this._lastSyncTimestamp = Date.now();
    } else {
      throw new Error("Failed to synchronize server time after all samples.");
    }

    return this._serverTimeOffset;
  }

  getEstimatedServerTime(): number {
    return Date.now() + this._serverTimeOffset;
  }

  get isTimeSynced(): boolean {
    return this._isTimeSynced;
  }

  get syncStats(): {
    offset: number;
    avgRtd: number;
    sampleCount: number;
    isSynced: boolean;
    latency: number;
  } {
    return {
      offset: this._serverTimeOffset,
      avgRtd: this._lastSyncRtd,
      sampleCount: this._lastSyncSampleCount,
      isSynced: this._isTimeSynced,
      latency: this._estimatedLatency,
    };
  }

  getSSEUrl(events: string[] = []): string {
    const params = new URLSearchParams();
    if (this._connectionKey) params.set("ck", this._connectionKey);
    const authKey = this._bearerToken ?? this._appKey;
    if (authKey) params.set("apikey", authKey);
    if (events.length > 0) params.set("events", events.join(","));
    return `${HANDY_BASE_URL}/sse?${params.toString()}`;
  }

  // ── Emergency stop ────────────────────────────────────────────────────────

  /**
   * Attempts to immediately halt all active protocols.
   * Switches to IDLE mode first, then sends individual stop commands.
   */
  async emergencyStop(): Promise<PromiseSettledResult<Record<string, unknown>>[]> {
    try {
      await this.setMode(HandyAPIv3.MODE.IDLE);
    } catch {
      // best-effort — continue to individual stops
    }
    return Promise.allSettled([
      this._put("/hamp/stop"),
      this._put("/hsp/stop"),
      this._put("/hvp/stop"),
      this._put("/hssp/stop"),
    ]);
  }

  // ── Mode constants ────────────────────────────────────────────────────────

  static readonly MODE = {
    HAMP: 0,
    HSSP: 1,
    HDSP: 2,
    MAINTENANCE: 3,
    HSP: 4,
    OTA: 5,
    BUTTON: 6,
    IDLE: 7,
    HVP: 8,
    HRPP: 9,
  } as const;

  static readonly MODE_NAMES: Record<number, string> = {
    0: "HAMP",
    1: "HSSP",
    2: "HDSP",
    3: "Maintenance",
    4: "HSP",
    5: "OTA",
    6: "Button",
    7: "Idle",
    8: "Vibrate",
    9: "HRPP",
  };
}
