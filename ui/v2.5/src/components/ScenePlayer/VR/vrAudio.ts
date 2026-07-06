/**
 * vrAudio — synthesized UI sound cues for the immersive player, in the spirit
 * of the native Quest system shell: very soft, short, rounded blips for hover,
 * a slightly fuller tap for presses, and a small two-note motif for panels
 * opening/closing.
 *
 * Everything is generated with WebAudio oscillators + gain envelopes — no
 * audio assets to load, nothing on the network, and each cue costs a couple of
 * short-lived nodes (created on demand, self-stopping), so it's safe to fire
 * from the XR event handlers. The module is a singleton; panels and the
 * session manager call the cue methods directly.
 *
 * The AudioContext is created lazily on the first cue after `init()` — by
 * then we're inside an XR session (which required a user gesture), so
 * autoplay policy allows it. If the context ever reports `suspended`, each
 * cue attempts a resume and skips that play rather than queueing.
 */

/** Minimum gap between hover ticks, so sweeping a strip doesn't machine-gun. */
const HOVER_MIN_INTERVAL_MS = 45;

class VRAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private started = false;
  private lastHoverAt = 0;

  /** Arm the module (idempotent). Call when the XR session starts. */
  init() {
    this.started = true;
  }

  /** User preference (gear panel "UI sounds"). Off = all cues silent. */
  setEnabled(on: boolean) {
    this.enabled = on;
  }

  /** Tear down the context when the XR session ends. */
  dispose() {
    this.started = false;
    if (this.ctx) {
      this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.master = null;
    }
  }

  /** Soft tick when the ray crosses onto an actionable element. */
  hover() {
    const now = performance.now();
    if (now - this.lastHoverAt < HOVER_MIN_INTERVAL_MS) return;
    this.lastHoverAt = now;
    const ctx = this.ensure();
    if (!ctx) return;
    // A whisper-quiet sine tick with a touch of random pitch so a sweep across
    // a button row reads organic rather than mechanical.
    const f = 2080 * (0.97 + Math.random() * 0.06);
    this.blip(ctx, "sine", f, f * 0.92, 0.035, 0.04);
  }

  /** Rounded tap on press/select. */
  press() {
    const ctx = this.ensure();
    if (!ctx) return;
    // Fundamental with a quiet upper partial — reads as a padded "tock".
    this.blip(ctx, "sine", 840, 600, 0.085, 0.09);
    this.blip(ctx, "sine", 1680, 1240, 0.025, 0.07);
  }

  /** Two-note rising motif when the control panels come up. */
  open() {
    const ctx = this.ensure();
    if (!ctx) return;
    this.blip(ctx, "sine", 659, 659, 0.055, 0.11);
    this.blip(ctx, "sine", 880, 880, 0.05, 0.14, 0.07);
  }

  /** Falling motif when the panels are dismissed. */
  close() {
    const ctx = this.ensure();
    if (!ctx) return;
    this.blip(ctx, "sine", 784, 784, 0.05, 0.1);
    this.blip(ctx, "sine", 523, 523, 0.045, 0.13, 0.07);
  }

  /** Lazily create (or resume) the shared context; null while unavailable. */
  private ensure(): AudioContext | null {
    if (!this.started || !this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
      } catch {
        return null; // no WebAudio — cues are a feel enhancement, never load-bearing
      }
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => undefined);
      return null; // skip this cue rather than queueing stale blips
    }
    return this.ctx.state === "running" ? this.ctx : null;
  }

  /**
   * One enveloped oscillator: fast attack, exponential decay over `durS`,
   * pitch gliding f0 → f1. `delayS` staggers the two-note motifs. Nodes stop
   * and free themselves.
   */
  private blip(
    ctx: AudioContext,
    type: OscillatorType,
    f0: number,
    f1: number,
    peakGain: number,
    durS: number,
    delayS = 0
  ) {
    if (!this.master) return;
    const t0 = ctx.currentTime + delayS;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t0 + durS);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peakGain, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durS);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + durS + 0.02);
  }
}

/** Shared singleton — the immersive player has exactly one audio voice. */
export const vrAudio = new VRAudio();
