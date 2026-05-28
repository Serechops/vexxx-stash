import { HandyAPIv3, HandyAPIError } from "./handy-api-v3";
import { IDeviceSettings } from "./utils";

/**
 * Returns true when the URL is only reachable on a private network or localhost.
 * Handy API v3 /hssp/setup rejects such URLs with UNSUPPORTED_URL (400).
 */
function isPrivateUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    // Handy requires HTTPS; any non-HTTPS URL cannot be served to their cloud.
    if (protocol !== "https:") return true;
    if (hostname === "localhost" || hostname === "[::1]") return true;
    // IPv4 loopback (127.x.x.x)
    if (/^127\./.test(hostname)) return true;
    // RFC-1918 private ranges
    if (/^10\./.test(hostname)) return true;
    if (/^192\.168\./.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
    return false;
  } catch {
    // Unparseable URL — treat as private to avoid a confusing 400.
    return true;
  }
}

interface IFunscript {
  actions: Array<IAction>;
  inverted: boolean;
  range: number;
}

interface IAction {
  at: number;
  pos: number;
}

function convertRange(
  value: number,
  fromLow: number,
  fromHigh: number,
  toLow: number,
  toHigh: number
): number {
  return ((value - fromLow) * (toHigh - toLow)) / (fromHigh - fromLow) + toLow;
}

// Reference for Funscript format:
// https://pkg.go.dev/github.com/funjack/launchcontrol/protocol/funscript
function convertFunscriptToCSV(funscript: IFunscript): string {
  const lineTerminator = "\r\n";
  if (funscript?.actions?.length > 0) {
    return funscript.actions.reduce((prev: string, curr: IAction) => {
      let { pos } = curr;
      if (funscript.inverted === true) {
        pos = convertRange(curr.pos, 0, 100, 100, 0);
      }
      if (funscript.range) {
        pos = convertRange(curr.pos, 0, funscript.range, 0, 100);
      }
      return `${prev}${curr.at},${pos}${lineTerminator}`;
    }, `#Created by stash.app ${new Date().toUTCString()}\n`);
  }
  throw new Error("Not a valid funscript");
}

async function uploadCsvToHosting(csv: File): Promise<{ url: string }> {
  const url = "https://www.handyfeeling.com/api/hosting/v2/upload";
  const formData = new FormData();
  formData.append("file", csv);
  const response = await fetch(url, { method: "POST", body: formData });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Script upload failed (HTTP ${response.status}): ${text}`);
  }
  return response.json() as Promise<{ url: string }>;
}

// Interactive currently uses the Handy API (v3), but could be expanded to use
// buttplug.io via buttplugio/buttplug-rs-ffi's WASM module.
export class Interactive {
  private _connected: boolean = false;
  private _playing: boolean = false;
  private _isPaused: boolean = false;
  private _lastPlayPosition: number = 0;
  private _lastPlayTimestamp: number = 0;
  private _scriptOffset: number;
  private _api: HandyAPIv3;
  private _useStashHostedFunscript: boolean = false;
  private _looping: boolean = false;
  private _appKey: string = "";
  private _resyncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(handyKey: string, scriptOffset: number) {
    this._api = new HandyAPIv3();
    if (handyKey) this._api.setConnectionKey(handyKey);
    this._scriptOffset = scriptOffset;
  }

  get connected(): boolean {
    return this._connected;
  }
  get playing(): boolean {
    return this._playing;
  }

  async connect(): Promise<void> {
    if (this._appKey) {
      try {
        await this._api.issueToken();
      } catch {
        // proceed with Connection Key-only auth
      }
    }
    const res = await this._api.isConnected();
    if (!res?.connected) {
      throw new Error("Handy not connected");
    }
    this._connected = true;
    this._startResyncTimer();
    // On network recovery: re-sync clock then resume HSSP at estimated position.
    this._api.onReconnect = () => {
      if (!this._playing && !this._isPaused) return;
      const elapsed = this._playing
        ? (Date.now() - this._lastPlayTimestamp) / 1000
        : 0;
      const estimatedPos = this._lastPlayPosition + elapsed;
      this._api
        .syncServerTime({ samples: 5, outliers: 1 })
        .then(() =>
          this._api.hsspPlay(
            Math.round(estimatedPos * 1000 + this._scriptOffset),
            this._api.getEstimatedServerTime(),
            { loop: this._looping }
          )
        )
        .catch(() => {});
      this._isPaused = false;
    };
  }

  private _startResyncTimer(): void {
    if (this._resyncTimer) clearInterval(this._resyncTimer);
    this._resyncTimer = setInterval(() => {
      if (this._connected) {
        this._api
          .syncServerTime({ samples: 5, outliers: 1 })
          .catch(() => {});
      }
    }, 5 * 60 * 1000);
  }

  set handyKey(key: string) {
    this._api.setConnectionKey(key);
  }

  get handyKey(): string {
    return this._api.connectionKey ?? "";
  }

  set useStashHostedFunscript(v: boolean) {
    this._useStashHostedFunscript = v;
  }

  get useStashHostedFunscript(): boolean {
    return this._useStashHostedFunscript;
  }

  set scriptOffset(offset: number) {
    this._scriptOffset = offset;
  }

  async uploadScript(funscriptPath: string, apiKey?: string): Promise<void> {
    if (!this._api.connectionKey || !funscriptPath) return;

    let funscriptUrl: string;

    if (this._useStashHostedFunscript && !isPrivateUrl(funscriptPath)) {
      // Only use the stash-hosted path when Stash is reachable from Handy's
      // cloud servers (public HTTPS).  LAN / localhost URLs are rejected by
      // the Handy API v3 /hssp/setup endpoint (UNSUPPORTED_URL), so we fall
      // through to the hosting-upload path below.
      funscriptUrl = funscriptPath.replace("/funscript", "/interactive_csv");
      if (apiKey) {
        const url = new URL(funscriptUrl);
        url.searchParams.append("apikey", apiKey);
        funscriptUrl = url.toString();
      }
    } else {
      const csv = await fetch(funscriptPath)
        .then((r) => r.json())
        .then((json) => convertFunscriptToCSV(json as IFunscript));
      const csvFile = new File(
        [csv],
        `${Math.round(Math.random() * 100000000)}.csv`
      );
      funscriptUrl = await uploadCsvToHosting(csvFile).then((r) => r.url);
    }

    await this._api.setMode(HandyAPIv3.MODE.HSSP);
    // notify:true enables SSE state-change events from the server.
    await this._api.hsspSetup(funscriptUrl, true);
    await this._api.hsspGetState();
    this._connected = true;
  }

  async sync(): Promise<number> {
    const offset = await this._api.syncServerTime({ samples: 10, outliers: 3 });
    // Also trigger device-side clock synchronisation for better HSSP accuracy.
    this._api.hstpClockSync().catch(() => {});
    return offset;
  }

  // kept for context.tsx compatibility — server time is managed internally in v3
  setServerTimeOffset(_offset: number): void {}

  async configure(config: Partial<IDeviceSettings>): Promise<void> {
    if (config.connectionKey !== undefined) this.handyKey = config.connectionKey;
    if (config.scriptOffset !== undefined)
      this._scriptOffset = config.scriptOffset;
    if (config.useStashHostedFunscript !== undefined)
      this._useStashHostedFunscript = config.useStashHostedFunscript;
    if (config.appKey !== undefined) {
      this._appKey = config.appKey;
      this._api.setAppKey(config.appKey);
    }
  }

  async play(position: number): Promise<void> {
    if (!this._connected) return;
    await this._api.hsspPlay(
      Math.round(position * 1000 + this._scriptOffset),
      this._api.getEstimatedServerTime(),
      { loop: this._looping }
    );
    this._lastPlayPosition = position;
    this._lastPlayTimestamp = Date.now();
    this._playing = true;
    this._isPaused = false;
  }

  async pause(): Promise<void> {
    if (!this._connected) return;
    // Use hsspPause (not hsspStop) to preserve the device's position;
    // play() will call hsspPlay with a new seek position on resume.
    try {
      await this._api.hsspPause();
    } catch (e) {
      // Any HSSP pause failure (e.g. "HSP pause failed", "Illegal state.") is
      // safe to ignore — the device is either already stopped, not in HSSP mode,
      // or in a transitional state between tracks. The next hsspPlay() call will
      // resume with an explicit position, correcting device state.
      if (!(e instanceof HandyAPIError)) throw e;
    }
    this._playing = false;
    this._isPaused = true;
  }

  async ensurePlaying(position: number): Promise<void> {
    if (this._playing) return;
    await this.play(position);
  }

  async setLooping(looping: boolean): Promise<void> {
    this._looping = looping;
    // HSSP v3 has no dedicated loop endpoint; the flag is applied on the next play().
  }

  // ── v3 extended capabilities ────────────────────────────────────────────

  get hasV3Capabilities(): boolean {
    return true;
  }

  async setMode(mode: number): Promise<void> {
    await this._api.setMode(mode);
  }

  async hampStart(): Promise<void> {
    await this._api.hampStart();
  }
  async hampStop(): Promise<void> {
    await this._api.hampStop();
  }
  async setHampVelocity(velocity: number): Promise<void> {
    await this._api.setHampVelocity(velocity);
  }
  async setHampStroke(min: number, max: number): Promise<void> {
    await this._api.setHampStroke(min, max);
  }
  async hdspSetPosition(position: number, velocity: number): Promise<void> {
    // position and velocity are 0–100 percent values
    await this._api.sendXpvp(position, velocity, true, true);
  }
  async hvpStart(): Promise<void> {
    await this._api.hvpStart();
  }
  async hvpStop(): Promise<void> {
    await this._api.hvpStop();
  }
  async setHvpState(
    amplitude: number,
    frequency: number,
    position: number
  ): Promise<void> {
    await this._api.setHvpState(amplitude, frequency, position);
  }
  async emergencyStop(): Promise<void> {
    await this._api.emergencyStop();
  }
}
