/**
 * VRStatusMonitor — wall clock + battery levels for the control bar's compact
 * status cluster.
 *
 * All sources are best-effort and feature-detected:
 *  - Clock: local time, re-read at most once a second.
 *  - Headset: the Battery Status API (`navigator.getBattery`) — Quest Browser
 *    is Chromium, so this reports the headset's own battery.
 *  - Controllers: no web standard exposes controller charge today. We probe a
 *    vendor-shaped `battery.level` on each XRInputSource's gamepad once a
 *    second and surface it only if a runtime ever provides one — on current
 *    Quest firmware this stays null and the cluster simply omits it.
 *
 * `snapshot()` mutates and returns one reused object (the XR render loop is
 * kept allocation-free) and `version` bumps only when a displayed value
 * actually changes, so the control bar's dirty-fingerprint redraws stay rare:
 * once a minute for the clock, on battery events otherwise.
 */

export interface IVRStatusSnapshot {
  /** Local wall clock, formatted per locale (e.g. "14:32"). */
  clock: string;
  /** Headset battery 0–100, or null when the API is unavailable. */
  headsetPct: number | null;
  headsetCharging: boolean;
  /** Controller battery 0–100 by handedness, null when not exposed. */
  leftCtrlPct: number | null;
  rightCtrlPct: number | null;
}

/** Battery Status API manager — still not in lib.dom, so typed here. */
interface IBatteryManagerLike {
  level: number;
  charging: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export class VRStatusMonitor {
  /** Bumped on any visible change — cheap dirty signal for the control bar. */
  version = 0;

  private snap: IVRStatusSnapshot = {
    clock: "",
    headsetPct: null,
    headsetCharging: false,
    leftCtrlPct: null,
    rightCtrlPct: null,
  };
  private battery: IBatteryManagerLike | null = null;
  private session: XRSession | null = null;
  private disposed = false;
  private lastPollAt = -Infinity;

  private readonly onBatteryChange = () => {
    if (!this.battery) return;
    const pct = Math.round(this.battery.level * 100);
    if (
      pct !== this.snap.headsetPct ||
      this.battery.charging !== this.snap.headsetCharging
    ) {
      this.snap.headsetPct = pct;
      this.snap.headsetCharging = this.battery.charging;
      this.version++;
    }
  };

  constructor() {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<IBatteryManagerLike>;
    };
    nav
      .getBattery?.()
      .then((b) => {
        if (this.disposed) return;
        this.battery = b;
        b.addEventListener("levelchange", this.onBatteryChange);
        b.addEventListener("chargingchange", this.onBatteryChange);
        this.onBatteryChange();
      })
      .catch(() => undefined);
  }

  /** The live XR session whose inputSources are probed for controller charge. */
  setSession(session: XRSession | null) {
    this.session = session;
  }

  /**
   * Current values, refreshed at most once a second (`nowMs` is the render
   * loop's timestamp, so the fast path costs one comparison).
   */
  snapshot(nowMs: number): IVRStatusSnapshot {
    if (nowMs - this.lastPollAt >= 1000) {
      this.lastPollAt = nowMs;
      this.pollClock();
      this.pollControllers();
    }
    return this.snap;
  }

  private pollClock() {
    const clock = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (clock !== this.snap.clock) {
      this.snap.clock = clock;
      this.version++;
    }
  }

  private pollControllers() {
    let left: number | null = null;
    let right: number | null = null;
    const sources = this.session?.inputSources;
    if (sources) {
      for (const src of sources) {
        // Non-standard probe (see class doc) — a plain Gamepad has no battery.
        const level = (
          src.gamepad as unknown as { battery?: { level?: number } } | null
        )?.battery?.level;
        if (typeof level !== "number") continue;
        const pct = Math.round(level * 100);
        if (src.handedness === "left") left = pct;
        else if (src.handedness === "right") right = pct;
      }
    }
    if (left !== this.snap.leftCtrlPct || right !== this.snap.rightCtrlPct) {
      this.snap.leftCtrlPct = left;
      this.snap.rightCtrlPct = right;
      this.version++;
    }
  }

  dispose() {
    this.disposed = true;
    this.session = null;
    if (this.battery) {
      this.battery.removeEventListener("levelchange", this.onBatteryChange);
      this.battery.removeEventListener("chargingchange", this.onBatteryChange);
      this.battery = null;
    }
  }
}
