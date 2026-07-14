import { IDeviceSettings, IInteractiveClient } from "./utils";

/**
 * LocalHandyInteractive — drives The Handy over the stash backend's local
 * Bluetooth bridge (/handy/ws) instead of the handyfeeling.com cloud API.
 *
 * The backend owns the BLE connection and all HSP script feeding; this
 * client only sends small JSON control ops (connect/load/play/pause/sync),
 * so there are no cloud round-trips and no API rate limits.
 */

interface IPendingOp {
  resolve: () => void;
  reject: (e: Error) => void;
}

export interface IHandyStatus {
  connected: boolean;
  deviceName?: string;
  battery?: number;
  scriptPoints: number;
  playing: boolean;
  playState: number;
  bufferPoints: number;
  maxPoints: number;
  currentTime: number;
  syncRtdMs: number;
  mtu: number;
}

type ServerMessage =
  | ({ type: "status" } & IHandyStatus)
  | { type: "ack"; seq: number }
  | { type: "error"; seq: number; message?: string };

// Ops are bounded client-side so a wedged backend surfaces as an error instead
// of a spinner. Only connect is allowed to be slow — it scans for the device.
const OP_TIMEOUT_MS = 15000;
const CONNECT_TIMEOUT_MS = 40000; // backend scans for up to 30s
const DISCONNECT_TIMEOUT_MS = 8000; // teardown is local to the backend; it's quick or it's broken
const SYNC_INTERVAL_MS = 2000;

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/handy/ws`;
}

export class LocalHandyInteractive implements IInteractiveClient {
  private _ws: WebSocket | null = null;
  private _wsOpen: Promise<void> | null = null;
  private _seq = 0;
  private _pending = new Map<number, IPendingOp>();

  private _connected = false;
  private _playing = false;
  private _playInFlight: Promise<void> | null = null;
  private _nextPlayPos: number | null = null;
  private _looping = false;
  private _scriptOffset: number;
  private _lastSyncSent = 0;
  private _status: IHandyStatus | null = null;

  /** Optional UI hook: receives every backend status push. */
  onStatus?: (status: IHandyStatus) => void;

  readonly hasV3Capabilities = true;

  constructor(scriptOffset: number) {
    this._scriptOffset = scriptOffset;
  }

  // The provider context gates all functionality on a truthy handyKey; the
  // local transport needs no key, so report a constant.
  get handyKey(): string {
    return "local";
  }

  get connected(): boolean {
    return this._connected;
  }

  get playing(): boolean {
    return this._playing;
  }

  get status(): IHandyStatus | null {
    return this._status;
  }

  set scriptOffset(offset: number) {
    this._scriptOffset = offset;
  }

  // ── WebSocket plumbing ────────────────────────────────────────────────

  private ensureSocket(): Promise<void> {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this._wsOpen) return this._wsOpen;

    this._wsOpen = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl());
      this._ws = ws;

      ws.onopen = () => resolve();
      ws.onerror = () => {
        reject(new Error("Local Handy bridge connection failed"));
      };
      ws.onclose = () => {
        this._ws = null;
        this._wsOpen = null;
        this._connected = false;
        this._playing = false;
        const err = new Error("Local Handy bridge disconnected");
        this._pending.forEach((p) => p.reject(err));
        this._pending.clear();
      };
      ws.onmessage = (ev: MessageEvent<string>) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data) as ServerMessage;
        } catch {
          return;
        }
        if (msg.type === "status") {
          this._status = msg;
          this._connected = msg.connected;
          // Track the backend's playback *intent* (`playing`), not the device's
          // instantaneous HSP state: that dips to paused/starving whenever the
          // buffer runs dry mid-scene, and treating those blips as "stopped"
          // made ensurePlaying re-issue a full play — a stream rebuild — each
          // time. The backend recovers a starve on its own; it clears `playing`
          // only when playback is genuinely over.
          if (!this._playInFlight) {
            this._playing = msg.connected && msg.playing;
          }
          this.onStatus?.(msg);
          return;
        }
        const pending = this._pending.get(msg.seq);
        if (!pending) return;
        this._pending.delete(msg.seq);
        if (msg.type === "ack") {
          pending.resolve();
        } else {
          pending.reject(new Error(msg.message ?? "Local Handy bridge error"));
        }
      };
    }).finally(() => {
      this._wsOpen = null;
    });
    return this._wsOpen;
  }

  private async send(
    op: Record<string, unknown>,
    timeoutMs: number = OP_TIMEOUT_MS
  ): Promise<void> {
    await this.ensureSocket();
    const seq = ++this._seq;
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this._pending.delete(seq);
        reject(new Error(`Local Handy op ${String(op.op)} timed out`));
      }, timeoutMs);
      this._pending.set(seq, {
        resolve: () => {
          window.clearTimeout(timer);
          resolve();
        },
        reject: (e) => {
          window.clearTimeout(timer);
          reject(e);
        },
      });
      this._ws!.send(JSON.stringify({ ...op, seq }));
    });
  }

  // fire-and-forget variant for high-frequency ops (sync, hdsp)
  private sendNoAck(op: Record<string, unknown>): void {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ ...op, seq: 0 }));
    }
  }

  // ── IInteractiveClient ────────────────────────────────────────────────

  async connect(): Promise<void> {
    await this.send({ op: "connect" }, CONNECT_TIMEOUT_MS);
    this._connected = true;
  }

  /**
   * Attach to the backend's (possibly already-established) BLE session without
   * initiating a scan. The bridge pushes a status snapshot the moment the WS
   * opens, so this resolves to whether a device is currently connected server-
   * side. Used to reflect a link that another browser/tab (e.g. the desktop
   * Settings page) already brought up — the connection is a server-side
   * singleton, but each client's connection *state* is local. Returns the live
   * connected flag; never triggers the 30s scan that connect() does.
   */
  async attach(): Promise<boolean> {
    await this.ensureSocket();
    // The first status frame arrives right after the socket opens; give it a
    // few polling ticks rather than a fixed sleep.
    for (let i = 0; i < 12; i++) {
      if (this._status) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    return this._connected;
  }

  /**
   * Tears down the BLE link on the backend and marks us disconnected.
   *
   * Local state is cleared up front, not in a `finally`: the backend drops the
   * link (and suppresses auto-reconnect) the moment it sees the op, so even if
   * the ack never comes back this client must not keep claiming a device. A
   * rejection here is worth surfacing, but it doesn't mean we're still connected.
   */
  async disconnect(): Promise<void> {
    this._connected = false;
    this._playing = false;
    await this.send({ op: "disconnect" }, DISCONNECT_TIMEOUT_MS);
  }

  async configure(config: Partial<IDeviceSettings>): Promise<void> {
    if (config.scriptOffset !== undefined) {
      this._scriptOffset = config.scriptOffset;
    }
    // connectionKey / appKey / useStashHostedFunscript are cloud-only.
  }

  /**
   * The provider requires a nonzero "server offset" before it will connect
   * (cloud semantics). Local clock sync happens backend↔device, so return a
   * constant placeholder.
   */
  async sync(): Promise<number> {
    return 1;
  }

  async uploadScript(funscriptPath: string, apiKey?: string): Promise<void> {
    if (!funscriptPath) return;
    // Fetch the funscript in the browser exactly like the cloud transport does.
    // Every content mode already serves ready funscript JSON at its own URL —
    // regular scenes (/scene/{id}/funscript), FapTap (/faptap/videos/{id}/
    // funscript), PMVHaven, multi-funscript index — so a single same-origin
    // fetch handles them all without the backend needing to know the source.
    // The backend just parses the JSON into HSP points and feeds BLE.
    let url = funscriptPath;
    if (apiKey) {
      try {
        const u = new URL(funscriptPath, window.location.origin);
        u.searchParams.set("apikey", apiKey);
        url = u.toString();
      } catch {
        // relative path with no base — leave as-is; the browser session cookie
        // authenticates the same-origin request.
      }
    }
    const funscript = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(`funscript fetch failed: ${r.status}`);
      return r.json();
    });
    await this.send({ op: "load", funscript });
  }

  /**
   * Start (or seek) script playback.
   *
   * A play op is not cheap: on a fresh stream the backend feeds the device
   * buffer over BLE, which takes a second or more. The players call play on
   * `playing` and `seeking` — and the 2D player deliberately fires a second one
   * a beat later — so several can be in flight at once, each of which tears the
   * device's stream down and rebuilds it. That pile-up is what kept the device
   * silent for the first minute of a scene: it never finished starting.
   *
   * So: one play at a time. A play requested while one is in flight is folded
   * into a single follow-up with the newest position (the older ones describe a
   * video position that no longer exists).
   */
  async play(position: number): Promise<void> {
    this._playing = true; // intent — keeps ensurePlaying from re-arming
    if (this._playInFlight) {
      this._nextPlayPos = position;
      return this._playInFlight;
    }
    this._playInFlight = this.runPlay(position);
    return this._playInFlight;
  }

  private async runPlay(position: number): Promise<void> {
    try {
      for (;;) {
        this._nextPlayPos = null;
        await this.send({
          op: "play",
          position: Math.round(position * 1000 + this._scriptOffset),
          rate: 1.0,
          loop: this._looping,
        });
        if (this._nextPlayPos === null) return;
        position = this._nextPlayPos;
      }
    } catch (e) {
      this._playing = false;
      throw e;
    } finally {
      this._playInFlight = null;
      this._nextPlayPos = null;
    }
  }

  async pause(): Promise<void> {
    // Drop any follow-up play the in-flight one was going to chain into: the
    // video is stopping, and its position is stale the moment it is queued.
    this._nextPlayPos = null;
    this._playing = false;
    // Sent even while the device link is down: the backend treats a pause as
    // playback *intent*, and it must land so that an auto-reconnect mid-scene
    // doesn't resume a scene the user has since paused.
    await this.send({ op: "pause" });
  }

  async ensurePlaying(position: number): Promise<void> {
    // A play is already on its way; it carries a fresher position than we do.
    if (this._playInFlight) return;
    if (this._playing) {
      // lightweight drift correction, throttled; the backend throttles again
      const now = Date.now();
      if (now - this._lastSyncSent >= SYNC_INTERVAL_MS) {
        this._lastSyncSent = now;
        this.sendNoAck({
          op: "sync",
          position: Math.round(position * 1000 + this._scriptOffset),
        });
      }
      return;
    }
    await this.play(position);
  }

  async setLooping(looping: boolean): Promise<void> {
    this._looping = looping;
    if (!this._connected) return;
    await this.send({ op: "loop", loop: looping });
  }

  // ── Extended capabilities (patterns / manual control) ─────────────────

  async setMode(): Promise<void> {
    // mode transitions are implicit server-side (play→HSP, hdsp→HDSP, …)
  }

  async hampStart(): Promise<void> {
    await this.send({ op: "hampStart" });
  }

  async hampStop(): Promise<void> {
    await this.send({ op: "hampStop" });
  }

  async setHampVelocity(velocity: number): Promise<void> {
    await this.send({ op: "hampVelocity", velocity });
  }

  async setHampStroke(min: number, max: number): Promise<void> {
    await this.send({ op: "stroke", min, max });
  }

  async hdspSetPosition(position: number, velocity: number): Promise<void> {
    // high-frequency pattern stepping: fire-and-forget over the LAN socket
    await this.ensureSocket();
    this.sendNoAck({ op: "hdsp", position: Math.round(position), velocity });
  }

  async hvpStart(): Promise<void> {
    await this.send({ op: "hvpStart" });
  }

  async hvpStop(): Promise<void> {
    await this.send({ op: "hvpStop" });
  }

  async setHvpState(
    amplitude: number,
    frequency: number,
    position: number
  ): Promise<void> {
    await this.send({ op: "hvp", amplitude, frequency, position: Math.round(position) });
  }

  async emergencyStop(): Promise<void> {
    await this.send({ op: "estop" });
    this._playing = false;
  }
}
