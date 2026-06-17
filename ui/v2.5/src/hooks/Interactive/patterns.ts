/**
 * Shared HDSP pattern runner — used by both the 2D HandyControlModal and
 * the VR immersive player (VRHandyPanel).  Extracted so the setTimeout-based
 * stepping loop is available even when the modal is not mounted.
 *
 * Each pattern is a sequence of (position, velocity, holdMs) steps.  The
 * runner ticks through them with random jitter for natural variation.
 */

import { HandyAPIv3 } from "./handy-api-v3";
import type { IInteractiveClient } from "./utils";

export interface PatternStep {
  pos: number;    // target position 0–100
  vel: number;    // velocity 0–100
  holdMs: number; // ms to wait before sending the next step
}

// ±12% time jitter
const jt = (ms: number): number => ms * (0.88 + Math.random() * 0.24);
// position jitter ±spread, clamped 0–100
const jp = (pos: number, spread: number): number =>
  Math.max(0, Math.min(100, pos + (Math.random() * 2 - 1) * spread));

export interface PatternDef {
  id: string;
  label: string;
  desc: string;
  getSteps: () => PatternStep[];
}

export const HDSP_PATTERNS: PatternDef[] = [
  {
    id: "slow_wave",
    label: "Slow Wave",
    desc: "Deep, slow",
    getSteps: () => {
      const v = 28 + Math.random() * 8;
      return [
        { pos: jp(2, 3),  vel: v, holdMs: jt(970) },
        { pos: jp(98, 3), vel: v, holdMs: jt(920) },
      ];
    },
  },
  {
    id: "steady",
    label: "Steady",
    desc: "Medium pace",
    getSteps: () => {
      const v = 54 + Math.random() * 12;
      return [
        { pos: jp(3, 4),  vel: v, holdMs: jt(560) },
        { pos: jp(97, 3), vel: v, holdMs: jt(535) },
      ];
    },
  },
  {
    id: "fast_pulse",
    label: "Fast Pulse",
    desc: "Mixed strokes",
    getSteps: () => [
      { pos: jp(4, 4),   vel: 60 + Math.random() * 8, holdMs: jt(530) },
      { pos: jp(97, 3),  vel: 62 + Math.random() * 8, holdMs: jt(490) },
      { pos: jp(5, 4),   vel: 58 + Math.random() * 8, holdMs: jt(510) },
      { pos: jp(55, 6),  vel: 55 + Math.random() * 8, holdMs: jt(340) },
      { pos: jp(98, 3),  vel: 76 + Math.random() * 8, holdMs: jt(265) },
      { pos: jp(53, 6),  vel: 50 + Math.random() * 8, holdMs: jt(345) },
      { pos: jp(100, 2), vel: 80 + Math.random() * 8, holdMs: jt(260) },
    ],
  },
  {
    id: "tease",
    label: "Tease",
    desc: "Slow build",
    getSteps: () => [
      { pos: jp(8, 5),  vel: 28 + Math.random() * 6, holdMs: jt(830) },
      { pos: jp(55, 7), vel: 30 + Math.random() * 6, holdMs: jt(790) },
      { pos: jp(10, 5), vel: 34 + Math.random() * 6, holdMs: jt(760) },
      { pos: jp(70, 6), vel: 32 + Math.random() * 6, holdMs: jt(770) },
      { pos: jp(12, 5), vel: 37 + Math.random() * 6, holdMs: jt(730) },
      { pos: jp(48, 7), vel: 28 + Math.random() * 6, holdMs: jt(790) },
    ],
  },
  {
    id: "upper_zone",
    label: "Upper Zone",
    desc: "Tip focused",
    getSteps: () => [
      { pos: jp(50, 5), vel: 60 + Math.random() * 10, holdMs: jt(365) },
      { pos: jp(98, 3), vel: 70 + Math.random() * 10, holdMs: jt(315) },
    ],
  },
  {
    id: "ripple",
    label: "Ripple",
    desc: "Oscillating",
    getSteps: () => [
      { pos: jp(40, 6), vel: 80 + Math.random() * 8, holdMs: jt(255) },
      { pos: jp(65, 6), vel: 80 + Math.random() * 8, holdMs: jt(255) },
      { pos: jp(35, 6), vel: 80 + Math.random() * 8, holdMs: jt(255) },
      { pos: jp(70, 6), vel: 80 + Math.random() * 8, holdMs: jt(255) },
      { pos: jp(42, 6), vel: 80 + Math.random() * 8, holdMs: jt(255) },
      { pos: jp(62, 6), vel: 80 + Math.random() * 8, holdMs: jt(255) },
    ],
  },
];

/**
 * A lightweight pattern runner that ticks HDSP position commands through
 * a setInterval/setTimeout-based stepping loop.  Each tick sends one step
 * (pos, vel) to the Handy via hdspSetPosition, then schedules the next.
 *
 * Caller:
 *   runner = new PatternRunner(client);
 *   runner.start("steady");
 *   runner.stop();
 *
 * The runner auto-stops on dispose.
 */
export class PatternRunner {
  private client: IInteractiveClient;
  private timerId: number | null = null;
  private running = false;
  private stepIndex = 0;
  private currentSteps: PatternStep[] = [];
  private currentPatternId: string | null = null;

  constructor(client: IInteractiveClient) {
    this.client = client;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get activePatternId(): string | null {
    return this.currentPatternId;
  }

  start(patternId: string): void {
    this.stop();
    const pattern = HDSP_PATTERNS.find((p) => p.id === patternId);
    if (!pattern) return;

    // Switch device to HDSP mode
    this.client.setMode?.(HandyAPIv3.MODE.HDSP).catch(() => {});
    this.currentPatternId = patternId;
    this.running = true;
    this.stepIndex = 0;
    this.currentSteps = pattern.getSteps();
    this.tick();
  }

  stop(): void {
    this.running = false;
    this.currentPatternId = null;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private tick = (): void => {
    if (!this.running) return;
    const step = this.currentSteps[this.stepIndex++];
    if (this.stepIndex >= this.currentSteps.length) {
      this.stepIndex = 0;
      const pattern = HDSP_PATTERNS.find((p) => p.id === this.currentPatternId);
      if (pattern) {
        this.currentSteps = pattern.getSteps();
      }
    }
    this.client.hdspSetPosition?.(step.pos, step.vel).catch(() => {});
    this.timerId = window.setTimeout(this.tick, step.holdMs);
  };
}

/**
 * PCHIP-style monotone piecewise cubic Hermite interpolation for funscript
 * data.  Smoothes abrupt transitions between funscript action points so
 * the Handy moves fluidly instead of jerking between positions.
 *
 * This is a lightweight approximation of the MATLAB pchip algorithm,
 * adapted from Fritsch–Carlson (1980).  Given a sparse set of (time, pos)
 * samples it produces `numSteps` intermediate points on a smooth monotone
 * curve that avoids overshoot.
 *
 * Use before calling hdspSetPosition when following a funscript timeline.
 */

interface Sample {
  at: number;  // ms
  pos: number; // 0–100
}

/** Linear interpolation helper. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Compute PCHIP slopes: monotone preserving (Fritsch–Carlson).
 * Ensures slopes don't cause overshoot between adjacent data points.
 */
function pchipSlopes(x: number[], y: number[]): number[] {
  const n = x.length;
  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(x[i + 1] - x[i]);
    delta.push((y[i + 1] - y[i]) / h[i]);
  }
  const m: number[] = new Array(n);
  if (n === 2) {
    m[0] = delta[0];
    m[1] = delta[0];
    return m;
  }
  // Interior points: weighted harmonic mean of adjacent deltas
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) {
      m[i] = 0; // slope change sign → flat
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }
  // Endpoints: one-sided (non-shape-preserving but reasonable)
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  return m;
}

/**
 * Evaluate the cubic Hermite spline at parameter t (0..1 between x[k] and x[k+1]).
 */
function evalHermite(
  t: number,
  x0: number, y0: number, m0: number,
  x1: number, y1: number, m1: number,
): number {
  const h = x1 - x0;
  const tt = t * t;
  const ttt = tt * t;
  // Hermite basis functions
  const h00 = 2 * ttt - 3 * tt + 1;  //   (1 - 3t² + 2t³)
  const h10 = ttt - 2 * tt + t;       //   (t - 2t² + t³)
  const h01 = -2 * ttt + 3 * tt;      //   (3t² - 2t³)
  const h11 = ttt - tt;               //   (t³ - t²)
  return h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1;
}

/**
 * Smooth an array of funscript actions (position samples) into a more
 * fluid trajectory using PCHIP interpolation.  Produces `numSteps` evenly-
 * spaced output points.
 *
 * @param actions  Raw funscript actions [{at: ms, pos: 0..100}, ...]
 * @param numSteps Number of interpolated output points to produce
 * @returns        Smoothed [{at, pos}, ...] array
 */
export function smoothFunscript(
  actions: Sample[],
  numSteps: number,
): Sample[] {
  if (actions.length < 2) return actions;
  if (numSteps < 2) numSteps = actions.length;

  // Sort by time
  const sorted = [...actions].sort((a, b) => a.at - b.at);
  const x = sorted.map((s) => s.at);
  const y = sorted.map((s) => s.pos);
  const m = pchipSlopes(x, y);

  const out: Sample[] = [];
  const totalSpan = x[x.length - 1] - x[0];
  if (totalSpan <= 0) return actions;

  for (let i = 0; i < numSteps; i++) {
    const t = (i / (numSteps - 1)) * totalSpan + x[0];
    // Find the segment
    let seg = 0;
    for (let j = 0; j < x.length - 1; j++) {
      if (t >= x[j] && t <= x[j + 1]) { seg = j; break; }
    }
    const segT = (t - x[seg]) / (x[seg + 1] - x[seg]);
    const pos = evalHermite(
      segT,
      x[seg],  y[seg],  m[seg],
      x[seg + 1], y[seg + 1], m[seg + 1],
    );
    out.push({ at: Math.round(t), pos: Math.max(0, Math.min(100, Math.round(pos))) });
  }

  return out;
}