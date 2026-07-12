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

interface IHandyStatus {
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

const OP_TIMEOUT_MS = 40000; // connect can scan for up to 30s
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
          this._playing = msg.connected && msg.playState === 1;
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

  private async send(op: Record<string, unknown>): Promise<void> {
    await this.ensureSocket();
    const seq = ++this._seq;
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this._pending.delete(seq);
        reject(new Error(`Local Handy op ${String(op.op)} timed out`));
      }, OP_TIMEOUT_MS);
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
    await this.send({ op: "connect" });
    this._connected = true;
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

  async uploadScript(funscriptPath: string): Promise<void> {
    if (!funscriptPath) return;
    // funscriptPath is the same URL the cloud path uses:
    //   .../scene/{id}/funscript[?funscript={index}]
    let sceneId = 0;
    let funscriptIndex: number | undefined;
    try {
      const url = new URL(funscriptPath, window.location.origin);
      const m = url.pathname.match(/\/scene\/(\d+)\/funscript/);
      if (m) sceneId = parseInt(m[1], 10);
      const idx = url.searchParams.get("funscript");
      if (idx !== null) funscriptIndex = parseInt(idx, 10);
    } catch {
      // fall through to error below
    }
    if (!sceneId) {
      throw new Error(`cannot determine scene from funscript path: ${funscriptPath}`);
    }
    await this.send({ op: "load", sceneId, funscriptIndex });
  }

  async play(position: number): Promise<void> {
    await this.send({
      op: "play",
      position: Math.round(position * 1000 + this._scriptOffset),
      rate: 1.0,
      loop: this._looping,
    });
    this._playing = true;
  }

  async pause(): Promise<void> {
    if (!this._connected) return;
    await this.send({ op: "pause" });
    this._playing = false;
  }

  async ensurePlaying(position: number): Promise<void> {
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
