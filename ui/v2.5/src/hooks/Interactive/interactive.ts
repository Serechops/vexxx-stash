import { HandyAPIv3 } from "./handy-api-v3";
import { IDeviceSettings } from "./utils";

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

async function uploadCsv(csv: File): Promise<{ url: string }> {
  const url = "https://www.handyfeeling.com/api/sync/upload?local=true";
  const fileName = "script_" + new Date().valueOf() + ".csv";
  const formData = new FormData();
  formData.append("syncFile", csv, fileName);
  const response = await fetch(url, { method: "post", body: formData });
  return response.json() as Promise<{ url: string }>;
}

// Interactive currently uses the Handy API (v3), but could be expanded to use
// buttplug.io via buttplugio/buttplug-rs-ffi's WASM module.
export class Interactive {
  private _connected: boolean = false;
  private _playing: boolean = false;
  private _scriptOffset: number;
  private _api: HandyAPIv3;
  private _useStashHostedFunscript: boolean = false;
  private _looping: boolean = false;
  private _appKey: string = "";

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

    if (this._useStashHostedFunscript) {
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
      funscriptUrl = await uploadCsv(csvFile).then((r) => r.url);
    }

    await this._api.setMode(HandyAPIv3.MODE.HSSP);
    await this._api.hsspSetup(funscriptUrl);
    await this._api.hsspGetState();
    this._connected = true;
  }

  async sync(): Promise<number> {
    return this._api.syncServerTime({ samples: 10, outliers: 3 });
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
    this._playing = true;
  }

  async pause(): Promise<void> {
    if (!this._connected) return;
    await this._api.hsspStop();
    this._playing = false;
  }

  async ensurePlaying(position: number): Promise<void> {
    if (this._playing) return;
    await this.play(position);
  }

  async setLooping(looping: boolean): Promise<void> {
    this._looping = looping;
    if (this._connected && this._playing) {
      await this._api.hsspSetLoop(looping);
    }
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
