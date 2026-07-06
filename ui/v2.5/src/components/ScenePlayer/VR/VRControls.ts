/**
 * VRControlPanel — the floating DeoVR/HereSphere-style control bar, now the
 * single consolidated UI surface for the immersive player.
 *
 * Rendered as a 2D canvas mapped onto a flat plane (a `CanvasTexture`), which
 * keeps hit-testing trivial (raycaster `.uv` → canvas pixel) and needs no extra
 * in-VR UI dependency. The panel is updated each frame from a pulled
 * [IVRPlaybackState] snapshot and emits [VRControlAction]s through `activate`.
 *
 * Top-to-bottom the panel stacks: the caption/chapter line, the **scrubber**,
 * the time readout, a compact **chapters** strip (directly under the bar), two
 * centred button rows (transport + view/settings, the latter holding the Handy
 * toggle), and the **performers carousel** + **tags** strip grouped at the
 * bottom. The performers/tags/chapters strips reuse the proven scrollable-strip
 * + image machinery in [VRCanvasPanel] (the same recipe the old side "monitor"
 * panels used), so the three former panels collapse into one.
 *
 * Redraw is dirty-checked against a quantised state fingerprint (so the moving
 * playhead only forces ~4 redraws/sec) plus a content-dirty flag raised by
 * scroll/late-image-load, keeping the XR render loop free of per-frame garbage
 * (a cause of GC-stall black flicker).
 */
import * as THREE from "three";
import TextUtils from "src/utils/text";
import { IProjectionSettings, fovLabel, stereoLabel } from "./projection";
import { VRControlAction, IVRMarker, IVRPlaybackState } from "./types";
import { VRCanvasPanel, IPanelRegion } from "./VRInfoPanels";
import type { IVRStatusSnapshot } from "./vrStatus";
import { vrAudio } from "./vrAudio";
import { VRT } from "./vrTheme";

const CANVAS_W = 1280;
const CANVAS_H = 486;
/** Physical width of the panel plane, metres (height derived from aspect). */
const PANEL_WIDTH_M = 2.6;

const PAD = 36;

const TITLE_Y = 34;

const HEAT_Y = 38;
const HEAT_H = 14;

const SCRUB_Y = 56;
const SCRUB_H = 40;
const SCRUB_X = PAD;
const SCRUB_W = CANVAS_W - PAD * 2;
const TIME_Y = SCRUB_Y + SCRUB_H + 24;

const CHAP_Y = 136;
const CHAP_H = 74;

// Pattern strip — directly below chapters.
const PAT_Y = 224;
const PAT_H = 72;

// Button rows shift down to accommodate the pattern strip.
const ROW1_Y = 312;
const ROW2_Y = 400;
const BTN_H = 72;
const GAP = 16;

const STRIP_LABEL_X = 24;
const STRIP_X0 = 116;
const STRIP_X1 = CANVAS_W - 20;

const ACCENT = VRT.accent;

interface IRowItem {
  id: string;
  w: number;
  label?: string;
  active?: boolean;
  variant?: "default" | "danger" | "green";
  kind?: "button" | "volume";
}

export interface IDrawInput {
  state: IVRPlaybackState;
  projection: IProjectionSettings;
  markers: IVRMarker[];
  chapterTitle: string | null;
  caption: string | null;
  /** Whether the compact Handy side panel is open. */
  handyOpen?: boolean;
  /** Whether the Browse side panel (Info | Scenes) is open. */
  browseOpen?: boolean;
  /** Handy connection status for icon tint + pattern strip visibility. */
  handy?: { connected: boolean; funscriptLoaded: boolean };
  /**
   * Mixed-reality passthrough: "PT" opens the adjustment panel (toggle +
   * chroma-key sliders). Shown whenever the session can composite the camera
   * feed (immersive-ar); lit while passthrough is active.
   */
  passthrough?: { available: boolean; on: boolean };
  /** Compact status cluster (wall clock + batteries), centred on the time row. */
  status?: IVRStatusSnapshot;
  /** Monitor version — the fingerprint's cheap change signal for `status`. */
  statusVersion?: number;
}

const RATE_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export class VRControlPanel extends VRCanvasPanel {
  private hoverFraction: number | null = null;
  private heatmap: HTMLImageElement | null = null;

  private chapScroll = 0;

  // White/dark-tinted cache of the Handy modal icon (/handy.png).
  private handyTint: HTMLCanvasElement | null = null;
  private handyTintActive = false;
  private patternActive: string | null = null;

  private last: IDrawInput | null = null;
  // Raised by scroll changes / late image loads (base markDirty override). The
  // state fingerprint below covers everything that changes from playback.
  private contentDirty = true;
  private prev = {
    paused: false,
    muted: false,
    captions: false,
    waiting: false,
    swap: false,
    t: -1,
    dur: -1,
    buf: -1,
    vol: -1,
    rate: -1,
    mlen: -1,
    heat: false,
    handyOpen: false,
    browseOpen: false,
    handyConnected: false,
    handyFsl: false,
    patternActive: null as string | null,
    fov: "",
    stereo: "",
    ptShow: false,
    ptOn: false,
    chap: null as string | null,
    cap: null as string | null,
    hov: null as string | null,
    hf: -1,
    stv: -1,
  };

  // --- layered hover compositing --------------------------------------------
  // The panel is expensive to rasterize (radial-gradient background, two strips,
  // ~16 gradient buttons), and a hover state change used to force a full redraw
  // of all of it on the XR render thread — a measured ~25ms stall that judders
  // the video feed every time the ray crosses a button. Instead we cache the
  // panel in its non-hovered state to `baseCanvas` (rebuilt only when real
  // content changes — playhead/markers/play-state), and on a hover change we
  // blit that base and patch only the single hovered element, restoring the
  // background under it from `bgCanvas`. A hover redraw is then one drawImage +
  // one button instead of the whole panel.
  private baseCanvas: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private bgCanvas: HTMLCanvasElement;
  private bgCtx: CanvasRenderingContext2D;
  private bgBuilt = false;
  private baseDirty = true;
  private buildingBase = false;
  // Fast-patch targets registered during a base build: hovered element id →
  // its rect + a closure that redraws it in hovered state. `additive` closures
  // composite themselves (no background restore); others get the background
  // restored under their rect first so the brighter hover fill doesn't stack
  // on the base's non-hover fill.
  private hoverTargets = new Map<
    string,
    { rect: IPanelRegion; redraw: () => void; additive: boolean }
  >();

  constructor() {
    super(PANEL_WIDTH_M, CANVAS_W, CANVAS_H);
    this.mesh.name = "vr-control-panel";
    this.baseCanvas = document.createElement("canvas");
    this.baseCanvas.width = CANVAS_W;
    this.baseCanvas.height = CANVAS_H;
    this.baseCtx = this.baseCanvas.getContext("2d")!;
    this.bgCanvas = document.createElement("canvas");
    this.bgCanvas.width = CANVAS_W;
    this.bgCanvas.height = CANVAS_H;
    this.bgCtx = this.bgCanvas.getContext("2d")!;
  }

  /** Fraction (0..1) of the scrubber currently hovered, or null. */
  get scrubberHoverFraction(): number | null {
    return this.hoverFraction;
  }

  /** Chapter-strip card index currently hovered (parsed from "chap:N"), or null. */
  get hoveredChapterIndex(): number | null {
    const id = this.hoveredId;
    if (!id || !id.startsWith("chap:")) return null;
    const i = Number(id.slice(5));
    return Number.isFinite(i) ? i : null;
  }

  /**
   * Panel-local anchor above a chapter card, from the last content draw's
   * layout. Null once the card has scrolled out of the last-drawn strip.
   */
  chapterCardAnchorLocal(index: number): THREE.Vector3 | null {
    const region = this.regions.find((r) => r.id === `chap:${index}`);
    if (!region) return null;
    const localX = ((region.x + region.w / 2) / this.cw - 0.5) * this.wM;
    const localY = (0.5 - region.y / this.ch) * this.hM;
    return new THREE.Vector3(localX, localY, 0.03);
  }

  /**
   * Best-available preview image for a chapter card: the marker's own preview
   * (animated webp) first, falling back to its static screenshot. Both load
   * through the shared image cache; null while loading or on failure — the
   * caller then hides the floating preview, same as today's no-image hover.
   */
  getChapterPreviewImage(index: number): HTMLImageElement | null {
    const m = this.last?.markers[index];
    if (!m) return null;
    return (
      this.image(m.previewUrl ?? null) ?? this.image(m.screenshotUrl ?? null)
    );
  }

  /** Full marker record for a chapter card, so the caller can drive its video preview. */
  getChapterMarker(index: number): IVRMarker | null {
    return this.last?.markers[index] ?? null;
  }

  /**
   * Panel-local position of the top of the scrubber at the given fraction —
   * the anchor for a floating thumbnail preview.
   */
  scrubberAnchorLocal(fraction: number): THREE.Vector3 {
    const f = Math.min(1, Math.max(0, fraction));
    const cx = SCRUB_X + f * SCRUB_W;
    const cy = SCRUB_Y;
    const localX = (cx / CANVAS_W - 0.5) * this.wM;
    const localY = (0.5 - cy / CANVAS_H) * this.hM;
    return new THREE.Vector3(localX, localY, 0.03);
  }

  /** Load the funscript heatmap (CSS `url("data:…")`) for the scrubber bg. */
  setHeatmap(cssUrl: string | null) {
    if (!cssUrl) {
      this.heatmap = null;
      this.markDirty();
      return;
    }
    // generateFunscriptWaveform returns `url("data:image/svg+xml,…")`.
    const match = cssUrl.match(/^url\(["']?(.*?)["']?\)$/);
    const src = match ? match[1] : cssUrl;
    const img = new Image();
    img.onload = () => {
      this.heatmap = img;
      this.markDirty();
    };
    img.src = src;
  }

  /** Late image loads / scroll changes force a redraw on the next sync(). */
  protected markDirty() {
    super.markDirty();
    this.contentDirty = true;
  }

  /**
   * Per-frame entry: store the snapshot and redraw only when the quantised
   * fingerprint or the content-dirty flag changed. Replaces the base no-arg
   * update() (which is left unused) so playback time can drive the redraw.
   */
  sync(input: IDrawInput) {
    this.last = input;
    // Stage 2 of a split update: the canvas was rasterized on the previous
    // frame — its GPU upload is this frame's panel work, nothing else runs.
    if (this.flushPendingUpload()) return;
    // Content (non-hover) change forces a base-layer rebuild; a hover-only
    // change just re-composites the cached base with the new hovered element.
    const contentChanged = this.stateChanged(input);
    const hf =
      this.hoverFraction == null ? -1 : Math.round(this.hoverFraction * 1000);
    const hoverChanged =
      this.prev.hov !== this.hoveredId || this.prev.hf !== hf;
    if (!this.contentDirty && !contentChanged && !hoverChanged) return;
    // Claim the frame's panel work slot for this raster so the side panels
    // stagger behind it. stateChanged() already folded this change into its
    // fingerprint, so on the (rare) claim failure carry it via contentDirty —
    // the next frame redraws unconditionally.
    if (!VRCanvasPanel.claimWorkSlot()) {
      this.contentDirty = true;
      return;
    }
    if (this.contentDirty || contentChanged) this.baseDirty = true;
    this.contentDirty = false;
    this.prev.hov = this.hoveredId;
    this.prev.hf = hf;
    this.composite();
  }

  /**
   * Whether anything affecting the rendered panel changed since the last draw,
   * updating the stored fingerprint as a side effect. Allocation-free. Time is
   * quantised to 4 Hz so the moving playhead/progress only forces ~4 redraws a
   * second instead of one per frame.
   */
  private stateChanged(input: IDrawInput): boolean {
    const { state: s, projection: p, markers, chapterTitle, caption } = input;
    const t = Math.round(s.currentTime * 4);
    const dur = Math.round(s.duration * 10);
    const buf = Math.round(s.bufferedAhead * 2);
    const vol = Math.round(s.volume * 100);
    const fov = fovLabel(p);
    const stereo = stereoLabel(p);
    const handyOpen = !!input.handyOpen;
    const browseOpen = !!input.browseOpen;
    const handyConnected = !!input.handy?.connected;
    const handyFsl = !!input.handy?.funscriptLoaded;
    const ptShow = !!input.passthrough?.available;
    const ptOn = !!input.passthrough?.on;
    const heat = this.heatmap != null;
    const stv = input.statusVersion ?? -1;
    const pr = this.prev;
    if (
      pr.paused === s.paused &&
      pr.muted === s.muted &&
      pr.captions === s.captionsOn &&
      pr.waiting === s.waiting &&
      pr.swap === p.swapEyes &&
      pr.t === t &&
      pr.dur === dur &&
      pr.buf === buf &&
      pr.vol === vol &&
      pr.rate === s.playbackRate &&
      pr.mlen === markers.length &&
      pr.heat === heat &&
      pr.handyOpen === handyOpen &&
      pr.browseOpen === browseOpen &&
      pr.handyConnected === handyConnected &&
      pr.handyFsl === handyFsl &&
      pr.patternActive === this.patternActive &&
      pr.fov === fov &&
      pr.stereo === stereo &&
      pr.ptShow === ptShow &&
      pr.ptOn === ptOn &&
      pr.chap === chapterTitle &&
      pr.cap === caption &&
      pr.stv === stv
    ) {
      return false;
    }
    pr.paused = s.paused;
    pr.muted = s.muted;
    pr.captions = s.captionsOn;
    pr.waiting = s.waiting;
    pr.swap = p.swapEyes;
    pr.t = t;
    pr.dur = dur;
    pr.buf = buf;
    pr.vol = vol;
    pr.rate = s.playbackRate;
    pr.mlen = markers.length;
    pr.heat = heat;
    pr.handyOpen = handyOpen;
    pr.browseOpen = browseOpen;
    pr.handyConnected = handyConnected;
    pr.handyFsl = handyFsl;
    pr.patternActive = this.patternActive;
    pr.fov = fov;
    pr.stereo = stereo;
    pr.ptShow = ptShow;
    pr.ptOn = ptOn;
    pr.chap = chapterTitle;
    pr.cap = caption;
    pr.stv = stv;
    return true;
  }

  /**
   * Wall clock + battery levels, centred on the time row. Only what's known is
   * drawn: the clock is always available; headset % needs getBattery(); the
   * controller pair appears only if the runtime ever exposes gamepad charge
   * (none do today — see VRStatusMonitor). Layout is measured left-to-right so
   * the cluster stays centred whatever subset is present.
   */
  private drawStatusCluster(st?: IVRStatusSnapshot) {
    if (!st) return;
    const { ctx } = this;
    const hasHmd = st.headsetPct != null;
    if (!st.clock && !hasHmd) return;

    ctx.font = "500 22px monospace";
    ctx.textBaseline = "alphabetic";

    const SEP = "   ";
    const clockText = st.clock;
    const hmdText = hasHmd ? `${st.headsetPct}%` : "";
    const ctrlText = [
      st.leftCtrlPct != null ? `L${st.leftCtrlPct}%` : "",
      st.rightCtrlPct != null ? `R${st.rightCtrlPct}%` : "",
    ]
      .filter(Boolean)
      .join(" ");

    // Battery glyph geometry (canvas px, placed relative to the text baseline).
    const BAT_W = 30;
    const BAT_H = 15;
    const BAT_NUB = 3;
    const BAT_GAP = 7; // icon → percentage text

    let total = ctx.measureText(clockText).width;
    if (hasHmd) {
      total +=
        ctx.measureText(SEP).width +
        BAT_W +
        BAT_NUB +
        BAT_GAP +
        ctx.measureText(hmdText).width;
    }
    if (ctrlText) total += ctx.measureText(SEP + ctrlText).width;

    let x = (CANVAS_W - total) / 2;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(clockText, x, TIME_Y);
    x += ctx.measureText(clockText).width;

    if (hasHmd) {
      x += ctx.measureText(SEP).width;
      const pct = st.headsetPct ?? 0;
      const top = TIME_Y - BAT_H + 1; // optically centred on the digits
      // Shell + terminal nub.
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, top, BAT_W - 2, BAT_H);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fillRect(x + BAT_W, top + BAT_H / 2 - 3, BAT_NUB, 6);
      // Charge fill — red when low, soft white otherwise.
      ctx.fillStyle =
        pct <= 20 ? "rgba(248,113,113,0.9)" : "rgba(255,255,255,0.7)";
      const fillW = Math.max(1, ((BAT_W - 6) * pct) / 100);
      ctx.fillRect(x + 3, top + 2, fillW, BAT_H - 4);
      if (st.headsetCharging) {
        // Tiny lightning bolt over the fill (monochrome — no emoji fonts).
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        const cx = x + BAT_W / 2;
        ctx.moveTo(cx + 3, top + 2);
        ctx.lineTo(cx - 2, top + BAT_H / 2 + 1);
        ctx.lineTo(cx + 2, top + BAT_H / 2 - 1);
        ctx.lineTo(cx - 3, top + BAT_H - 2);
        ctx.stroke();
      }
      x += BAT_W + BAT_NUB + BAT_GAP;
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(hmdText, x, TIME_Y);
      x += ctx.measureText(hmdText).width;
    }

    if (ctrlText) {
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText(SEP + ctrlText, x, TIME_Y);
    }
  }

  // --- hit testing ----------------------------------------------------------

  setHovered(uv: THREE.Vector2 | null) {
    const region = uv ? this.regionAt(uv) : null;
    // Audible tick on crossing onto a new actionable element (mirrors the
    // edge-triggered haptic tick the session manager drives off hoveredId).
    if (region?.id && region.id !== this.hoveredId) vrAudio.hover();
    this.hoveredId = region?.id ?? null;
    this.hoverUV = uv ? { x: uv.x * this.cw, y: (1 - uv.y) * this.ch } : null;
    let fraction: number | null = null;
    if (region && region.id === "scrubber" && uv) {
      const x = uv.x * this.cw;
      fraction = Math.min(1, Math.max(0, (x - region.x) / region.w));
    }
    // The change is picked up by the next sync()'s fingerprint check (hov / hf),
    // which triggers a redraw only when hover actually moves.
    this.hoverFraction = fraction;
  }

  /** Resolve a selection at the given uv into an action. */
  activate(uv: THREE.Vector2): VRControlAction | null {
    const region = this.regionAt(uv);
    if (!region) return null;
    const x = uv.x * this.cw;
    if (region.id === "scrubber") {
      const fraction = Math.min(1, Math.max(0, (x - region.x) / region.w));
      return { type: "seekFraction", fraction };
    }
    if (region.id === "volume") {
      const value = Math.min(1, Math.max(0, (x - region.x) / region.w));
      return { type: "setVolume", value };
    }
    return this.handleSelect(region);
  }

  protected handleSelect(region: IPanelRegion): VRControlAction | null {
    switch (region.id) {
      case "playpause":
        return { type: "playpause" };
      case "back10":
        return { type: "seekRelative", seconds: -10 };
      case "fwd10":
        return { type: "seekRelative", seconds: 10 };
      case "mute":
        return { type: "toggleMute" };
      case "rate": {
        const cur = this.last?.state.playbackRate ?? 1;
        const idx = RATE_STEPS.reduce(
          (b, r, i) =>
            Math.abs(r - cur) < Math.abs(RATE_STEPS[b] - cur) ? i : b,
          0
        );
        return {
          type: "setRate",
          value: RATE_STEPS[(idx + 1) % RATE_STEPS.length],
        };
      }
      case "fov":
        return { type: "cycleFov" };
      case "stereo":
        return { type: "cycleStereo" };
      case "swap":
        return { type: "toggleSwapEyes" };
      case "passthrough":
        return { type: "ptPanelToggle" };
      case "recenter":
        return { type: "recenter" };
      case "captions":
        return { type: "toggleCaptions" };
      case "prevMarker":
        return { type: "prevMarker" };
      case "nextMarker":
        return { type: "nextMarker" };
      case "loop":
        return { type: "loopChapter" };
      case "loopScene":
        return { type: "toggleLoopScene" };
      case "handy":
        return { type: "handyPanelToggle" };
      case "home":
        return { type: "goHome" };
      case "browse":
        return { type: "browsePanelToggle" };
      case "exit":
        return { type: "exit" };
      case "chapScrollL":
        this.chapScroll = this.scrollBy("chap", -1, this.chapScroll);
        this.markDirty();
        return null;
      case "chapScrollR":
        this.chapScroll = this.scrollBy("chap", 1, this.chapScroll);
        this.markDirty();
        return null;
      default:
        if (region.id.startsWith("chap:") && region.data != null) {
          return { type: "seekSeconds", seconds: region.data };
        }
        if (region.id.startsWith("pat:")) {
          const pid = region.id.slice(4);
          if (pid === this.patternActive) {
            this.patternActive = null;
            this.markDirty();
            return { type: "handyPatternStop" };
          }
          this.patternActive = pid;
          this.markDirty();
          return { type: "handyPatternStart", patternId: pid };
        }
        return null;
    }
  }

  // --- layered compositing --------------------------------------------------

  /** Rasterize the static background (the radial-glow panel) into bgCanvas once;
   * used to restore the area under a hovered element before repainting it. */
  private ensureBgCanvas() {
    if (this.bgBuilt) return;
    const prev = this.ctx;
    this.ctx = this.bgCtx;
    this.bgCtx.clearRect(0, 0, this.cw, this.ch);
    this.panelBackground();
    this.ctx = prev;
    this.bgBuilt = true;
  }

  /** Render the whole panel in its non-hovered state into baseCanvas and capture
   * the fast-patch hover targets. Runs only when content changed, not on hover. */
  private buildBase() {
    this.ensureBgCanvas();
    this.hoverTargets.clear();
    const prevCtx = this.ctx;
    const prevHover = this.hoveredId;
    this.ctx = this.baseCtx;
    this.hoveredId = null;
    this.buildingBase = true;
    this.baseCtx.clearRect(0, 0, this.cw, this.ch);
    this.draw();
    this.buildingBase = false;
    this.hoveredId = prevHover;
    this.ctx = prevCtx;
    this.baseDirty = false;
  }

  /** Register a fast hover-patch target while building the base layer. */
  private registerHover(
    id: string,
    rect: { x: number; y: number; w: number; h: number },
    redraw: () => void,
    additive = false
  ) {
    if (!this.buildingBase) return;
    this.hoverTargets.set(id, {
      rect: { id, x: rect.x, y: rect.y, w: rect.w, h: rect.h },
      redraw,
      additive,
    });
  }

  /** Repaint a single hovered strip item (chapter card / pattern chip): clip to
   * its slot, restore the background under it, then redraw it in hover state.
   * Self-compositing, so it's registered as an additive hover target. */
  private patchStripItem(
    clip: { x: number; y: number; w: number; h: number },
    drawItem: () => void
  ) {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
    ctx.clip();
    ctx.drawImage(this.bgCanvas, 0, 0);
    drawItem();
    ctx.restore();
  }

  /** Blit the cached base and patch in the single hovered element. Falls back to
   * a full redraw for hover targets we don't fast-patch (strip chips, arrows). */
  private composite() {
    if (this.baseDirty) this.buildBase();
    const { ctx } = this;
    const id = this.hoveredId;
    const target = id ? this.hoverTargets.get(id) : null;

    if (id && !target) {
      // Unregistered hover target (e.g. a scrollable strip chip): keep the old
      // behaviour — a full render with hover on — and mark the base stale so the
      // next frame rebuilds a clean non-hover snapshot.
      ctx.clearRect(0, 0, this.cw, this.ch);
      this.draw();
      this.baseDirty = true;
      this.requestUpload();
      return;
    }

    ctx.clearRect(0, 0, this.cw, this.ch);
    ctx.drawImage(this.baseCanvas, 0, 0);
    if (target) {
      ctx.save();
      if (!target.additive) {
        // Restore the background under the element (inflated slightly so the
        // 1px border/rim isn't clipped) before repainting it in hover state.
        const r = target.rect;
        ctx.beginPath();
        ctx.rect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
        ctx.clip();
        ctx.drawImage(this.bgCanvas, 0, 0);
      }
      // The hit-regions are owned by the base build; discard any pushed by a
      // patch redraw (e.g. drawButton) so they don't accumulate across hovers.
      const rlen = this.regions.length;
      target.redraw();
      this.regions.length = rlen;
      ctx.restore();
    }
    this.requestUpload();
  }

  /** The scrubber's hover overlay (outline + position marker), drawn on top of
   * the cached base. Extracted from drawScrubber so the base stays hover-free. */
  private drawScrubberHover(x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    const r = h / 2;
    this.roundRect(x, y, w, h, r);
    ctx.strokeStyle = VRT.accentSoft;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (this.hoverFraction != null) {
      const hx = x + this.hoverFraction * w;
      ctx.fillStyle = VRT.accentHalo;
      ctx.fillRect(hx - 4, y - 10, 8, h + 20);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(hx - 1.5, y - 8, 3, h + 16);
    }
  }

  // --- drawing --------------------------------------------------------------

  protected draw() {
    const input = this.last;
    if (!input) return;
    const { state, projection, markers, chapterTitle, caption } = input;
    const { ctx } = this;
    this.regions = [];

    this.panelBackground();

    const dur = state.duration && isFinite(state.duration) ? state.duration : 0;
    const cur = Math.min(state.currentTime, dur || state.currentTime);

    // Caption cue (centred) takes priority, else chapter / status line (top).
    ctx.textBaseline = "alphabetic";
    if (caption) {
      ctx.font = "600 26px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(caption, CANVAS_W / 2, TITLE_Y, CANVAS_W - PAD * 2);
    } else {
      ctx.font = "600 22px sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      const topText = state.waiting ? "Buffering…" : chapterTitle ?? "";
      if (topText) ctx.fillText(topText, PAD, TITLE_Y);
    }

    // Funscript heatmap strip just above the scrubber, so the heatmap and the
    // chapter-segment colouring inside the scrubber are both fully visible.
    if (this.heatmap) {
      ctx.save();
      this.roundRect(SCRUB_X, HEAT_Y, SCRUB_W, HEAT_H, HEAT_H / 2);
      ctx.clip();
      ctx.drawImage(this.heatmap, SCRUB_X, HEAT_Y, SCRUB_W, HEAT_H);
      ctx.restore();
    }

    this.drawScrubber(
      SCRUB_X,
      SCRUB_Y,
      SCRUB_W,
      SCRUB_H,
      cur,
      dur,
      state,
      markers
    );
    this.registerHover(
      "scrubber",
      { x: SCRUB_X, y: SCRUB_Y - 8, w: SCRUB_W, h: SCRUB_H + 16 },
      () => this.drawScrubberHover(SCRUB_X, SCRUB_Y, SCRUB_W, SCRUB_H),
      true
    );

    // Time labels (just under the scrubber).
    ctx.font = "500 24px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textAlign = "left";
    ctx.fillText(TextUtils.secondsToTimestamp(cur), PAD, TIME_Y);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(TextUtils.secondsToTimestamp(dur), CANVAS_W - PAD, TIME_Y);

    // Compact status cluster (wall clock · battery) centred between the time
    // labels — the one line of "outside world" the headset otherwise hides.
    this.drawStatusCluster(input.status);

    // Chapters / timestamp row — directly beneath the progress bar.
    this.drawChapters(markers);

    this.drawPatterns(input);

    // Row 1 — transport, chapter nav, mute + volume, rate.
    this.layoutRow(
      [
        { id: "back10", w: 96, label: "-10s" },
        {
          id: "playpause",
          w: 108,
          label: state.paused ? "icon:play" : "icon:pause",
        },
        { id: "fwd10", w: 96, label: "+10s" },
        { id: "prevMarker", w: 72, label: "icon:chapPrev" },
        { id: "nextMarker", w: 72, label: "icon:chapNext" },
        { id: "mute", w: 80, label: state.muted ? "icon:muted" : "icon:vol" },
        { id: "volume", w: 170, kind: "volume" },
        { id: "rate", w: 92, label: `${state.playbackRate}x` },
        {
          id: "loop",
          w: 90,
          label: "Loop",
          active: state.loopActive,
          variant: state.loopActive ? "green" : "default",
        },
        {
          id: "loopScene",
          w: 76,
          label: "🔁",
          active: state.loopSceneActive,
          variant: state.loopSceneActive ? "green" : "default",
        },
      ],
      ROW1_Y,
      state
    );

    // Row 2 — projection / view, captions, Handy toggle, Browse, exit.
    const row2: IRowItem[] = [
      { id: "fov", w: 104, label: fovLabel(projection) },
      { id: "stereo", w: 116, label: stereoLabel(projection) },
      { id: "swap", w: 104, label: "Swap", active: projection.swapEyes },
    ];
    // Passthrough adjustment panel — any source, AR sessions only. Lit green
    // while chroma-key passthrough is active.
    if (input.passthrough?.available) {
      row2.push({
        id: "passthrough",
        w: 84,
        label: "PT",
        active: input.passthrough.on,
        variant: input.passthrough.on ? "green" : "default",
      });
    }
    row2.push(
      { id: "recenter", w: 150, label: "Recenter" },
      { id: "captions", w: 84, label: "CC", active: state.captionsOn }
    );
    const handyGreen = !!(input.handy?.connected && input.handy?.funscriptLoaded);
    row2.push({
      id: "handy",
      w: 84,
      label: "icon:handy",
      active: handyGreen,
      variant: handyGreen ? "green" : "default",
    });
    row2.push({ id: "home", w: 100, label: "Home" });
    row2.push({ id: "browse", w: 100, label: "Browse", active: !!input.browseOpen });
    row2.push({ id: "exit", w: 110, label: "Exit", variant: "danger" });
    this.layoutRow(row2, ROW2_Y, state);
  }

  /** Lay out a row of controls, centred horizontally, with even gaps. */
  private layoutRow(items: IRowItem[], y: number, state: IVRPlaybackState) {
    const total =
      items.reduce((s, it) => s + it.w, 0) + GAP * (items.length - 1);
    let x = Math.round((CANVAS_W - total) / 2);
    for (const it of items) {
      const region: IPanelRegion = { id: it.id, x, y, w: it.w, h: BTN_H };
      if (it.kind === "volume") {
        this.drawVolume(region, state);
        this.regions.push(region);
        this.registerHover(it.id, region, () => this.drawVolume(region, state));
      } else {
        const label = it.label ?? "";
        const active = it.active ?? false;
        const variant = it.variant ?? "default";
        this.drawButton(region, label, active, variant);
        this.registerHover(it.id, region, () =>
          this.drawButton(region, label, active, variant)
        );
      }
      x += it.w + GAP;
    }
  }

  // --- chapters strip -------------------------------------------------------

  private drawStripLabel(text: string, bandY: number, bandH: number) {
    const { ctx } = this;
    // Tracked-out caps (Chromium-only canvas letterSpacing; harmless elsewhere).
    const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    ctx.font = "700 17px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = VRT.textDim;
    if ("letterSpacing" in c) c.letterSpacing = "2px";
    ctx.fillText(text.toUpperCase(), STRIP_LABEL_X, bandY + bandH / 2);
    if ("letterSpacing" in c) c.letterSpacing = "0px";
  }

  private emptyStrip(text: string, bandY: number, bandH: number) {
    const { ctx } = this;
    ctx.font = "500 20px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText(text, STRIP_X0, bandY + bandH / 2);
  }

  private drawChapters(markers: IVRMarker[]) {
    const { ctx } = this;
    this.drawStripLabel("Chapters", CHAP_Y, CHAP_H);
    if (markers.length === 0) {
      this.emptyStrip("No chapters", CHAP_Y, CHAP_H);
      return;
    }
    ctx.font = "500 18px sans-serif";
    const widths = markers.map((m) =>
      Math.min(300, Math.max(150, ctx.measureText(m.title || "Chapter").width + 40))
    );
    this.hStrip({
      prefix: "chap",
      x0: STRIP_X0,
      x1: STRIP_X1,
      y: CHAP_Y,
      h: CHAP_H,
      scrollX: this.chapScroll,
      widths,
      gap: 12,
      drawItem: (i, x, w) => this.drawChapCard(markers, i, x, CHAP_Y, w, CHAP_H),
      regionId: (i) => ({ id: `chap:${i}`, data: markers[i].seconds }),
      onItem: (i, ox, ow, clip) =>
        this.registerHover(
          `chap:${i}`,
          clip,
          () => this.patchStripItem(clip, () =>
            this.drawChapCard(markers, i, ox, CHAP_Y, ow, CHAP_H)
          ),
          true
        ),
    });
  }

  private drawChapCard(
    markers: IVRMarker[],
    i: number,
    x: number,
    y: number,
    w: number,
    h: number
  ) {
    const { ctx } = this;
    const m = markers[i];
    const hovered = this.hoveredId === `chap:${i}`;
    this.roundRect(x, y, w, h, VRT.radiusCard);
    const mg = ctx.createLinearGradient(x, y, x, y + h);
    if (hovered) {
      mg.addColorStop(0, VRT.accentWashTop);
      mg.addColorStop(1, VRT.accentWashBot);
    } else {
      mg.addColorStop(0, VRT.raisedTop);
      mg.addColorStop(1, VRT.raisedBot);
    }
    ctx.fillStyle = mg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = hovered ? VRT.accentBorder : VRT.raisedBorder;
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 24px monospace";
    ctx.fillStyle = ACCENT;
    ctx.fillText(TextUtils.secondsToTimestamp(m.seconds), x + 14, y + 34);

    ctx.font = "500 18px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(this.fitText(m.title || "Chapter", w - 28), x + 14, y + 62);
  }

  // --- pattern strip --------------------------------------------------------

  private drawPatterns(input: IDrawInput) {
    const { ctx } = this;
    const connected = !!input.handy?.connected;
    this.drawStripLabel("Patterns", PAT_Y, PAT_H);
    if (!connected) {
      this.emptyStrip("Connect Handy to use patterns", PAT_Y, PAT_H);
      return;
    }
    const pats = [
      { id: "slow_wave", label: "Slow Wave" },
      { id: "steady", label: "Steady" },
      { id: "fast_pulse", label: "Fast Pulse" },
      { id: "tease", label: "Tease" },
      { id: "upper_zone", label: "Upper Zone" },
      { id: "ripple", label: "Ripple" },
    ];
    ctx.font = "500 20px sans-serif";
    const widths = pats.map((p) =>
      Math.min(250, Math.max(110, ctx.measureText(p.label).width + 36))
    );
    this.hStrip({
      prefix: "pat",
      x0: STRIP_X0,
      x1: STRIP_X1,
      y: PAT_Y,
      h: PAT_H,
      scrollX: 0,
      widths,
      gap: 10,
      drawItem: (i, x, w) => this.drawPatChip(pats[i], x, w),
      regionId: (i) => ({ id: `pat:${pats[i].id}` }),
      onItem: (i, ox, ow, clip) =>
        this.registerHover(
          `pat:${pats[i].id}`,
          clip,
          () => this.patchStripItem(clip, () => this.drawPatChip(pats[i], ox, ow)),
          true
        ),
    });
  }

  private drawPatChip(pat: { id: string; label: string }, x: number, w: number) {
    const { ctx } = this;
    const active = this.patternActive === pat.id;
    const hovered = this.hoveredId === `pat:${pat.id}`;
    const chipY = PAT_Y + 4;
    const chipH = PAT_H - 8;
    this.roundRect(x, chipY, w, chipH, VRT.radiusCard);
    if (active) {
      const ag = ctx.createLinearGradient(x, chipY, x, chipY + chipH);
      ag.addColorStop(0, VRT.accentGradTop);
      ag.addColorStop(1, VRT.accentGradBot);
      ctx.fillStyle = ag;
    } else if (hovered) {
      const hg = ctx.createLinearGradient(x, chipY, x, chipY + chipH);
      hg.addColorStop(0, VRT.accentWashTop);
      hg.addColorStop(1, VRT.accentWashBot);
      ctx.fillStyle = hg;
    } else {
      const dg = ctx.createLinearGradient(x, chipY, x, chipY + chipH);
      dg.addColorStop(0, VRT.raisedTop);
      dg.addColorStop(1, VRT.raisedBot);
      ctx.fillStyle = dg;
    }
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = active
      ? VRT.accentBorder
      : hovered
      ? VRT.accentBorder
      : VRT.raisedBorder;
    ctx.stroke();
    // Glass rim
    ctx.beginPath();
    ctx.moveTo(x + 13, chipY + 1);
    ctx.lineTo(x + w - 13, chipY + 1);
    ctx.lineWidth = 1;
    ctx.strokeStyle = active ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.20)";
    ctx.stroke();
    ctx.font = "500 20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = active ? VRT.onAccent : "rgba(255,255,255,0.9)";
    ctx.fillText(pat.label, x + w / 2, PAT_Y + PAT_H / 2 + 1);
  }

  // --- scrubber + transport widgets -----------------------------------------

  private drawScrubber(
    x: number,
    y: number,
    w: number,
    h: number,
    cur: number,
    dur: number,
    state: IVRPlaybackState,
    markers: IVRMarker[]
  ) {
    const { ctx } = this;
    const r = h / 2;

    // Track
    this.roundRect(x, y, w, h, r);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fill();
    this.roundRect(x, y, w, h, r);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.stroke();

    if (dur > 0) {
      const progressX = x + Math.min(1, cur / dur) * w;

      if (markers.length > 0) {
        // Chapter segments: each marker colours a band of the timeline (so you
        // can see *where* each marker sits). The whole bar is drawn dim; the
        // played portion is redrawn vivid, so progress reads out without a
        // separate fill on top.
        ctx.save();
        this.roundRect(x, y, w, h, r);
        ctx.clip();
        this.drawMarkerSegments(x, y, w, h, dur, markers, 0.35, 58, 50);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, Math.max(0, progressX - x), h);
        ctx.clip();
        this.drawMarkerSegments(x, y, w, h, dur, markers, 0.95, 72, 58);
        ctx.restore();
        ctx.restore();
      } else {
        // No chapters → classic buffered + progress fill.
        const bw = Math.min(1, (cur + state.bufferedAhead) / dur) * w;
        this.roundRect(x, y, bw, h, r);
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fill();
        this.roundRect(x, y, progressX - x, h, r);
        ctx.fillStyle = "rgba(96,165,250,0.95)";
        ctx.fill();
      }

      // Playhead — white core with a soft accent halo so it reads as the one
      // live element on the bar.
      ctx.beginPath();
      ctx.arc(progressX, y + h / 2, h * 0.62 + 5, 0, Math.PI * 2);
      ctx.fillStyle = VRT.accentHalo;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(progressX, y + h / 2, h * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }

    // The hover outline + position marker is composited on top of the cached
    // base separately (drawScrubberHover) so the base layer stays hover-free.
    this.regions.push({ id: "scrubber", x, y: y - 8, w, h: h + 16 });
  }

  /**
   * Fill each marker's span on the track with a distinct hue (golden-angle
   * stepped for good separation). A segment runs from its marker to its
   * `endSeconds`, or to the next marker, or to the end of the video.
   */
  private drawMarkerSegments(
    x: number,
    y: number,
    w: number,
    h: number,
    dur: number,
    markers: IVRMarker[],
    alpha: number,
    sat: number,
    light: number
  ) {
    const { ctx } = this;
    for (let i = 0; i < markers.length; i++) {
      const next = i + 1 < markers.length ? markers[i + 1].seconds : dur;
      const start = Math.max(0, Math.min(dur, markers[i].seconds));
      const end = Math.max(start, Math.min(dur, markers[i].endSeconds ?? next));
      const sx = x + (start / dur) * w;
      const ex = x + (end / dur) * w;
      const hue = Math.round((i * 137.508) % 360);
      ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
      ctx.fillRect(sx, y, Math.max(1, ex - sx), h);
    }
  }

  private drawVolume(region: IPanelRegion, state: IVRPlaybackState) {
    const { ctx } = this;
    const { x, y, w, h } = region;
    const track = h * 0.18;
    const ty = y + h / 2 - track / 2;
    this.roundRect(x, ty, w, track, track / 2);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fill();
    const level = state.muted ? 0 : state.volume;
    this.roundRect(x, ty, w * level, track, track / 2);
    ctx.fillStyle = "rgba(96,165,250,0.85)";
    ctx.fill();
    // knob (accent halo when hovered, matching the playhead treatment)
    if (this.hoveredId === "volume") {
      ctx.beginPath();
      ctx.arc(x + w * level, y + h / 2, h * 0.16 + 4, 0, Math.PI * 2);
      ctx.fillStyle = VRT.accentHalo;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x + w * level, y + h / 2, h * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    if (this.hoveredId === "volume") {
      this.roundRect(x - 6, y + 6, w + 12, h - 12, 12);
      ctx.strokeStyle = VRT.accentSoft;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private drawButton(
    region: IPanelRegion,
    label: string,
    active: boolean,
    variant: "default" | "danger" | "green" = "default"
  ) {
    const { ctx } = this;
    const { x, y, w, h } = region;
    const hovered = this.hoveredId === region.id;
    const r = VRT.radiusButton;

    // Soft halo behind lit/hovered buttons — a wide low-alpha stroke on the
    // button path itself (extends 2px out, inside the hover-patch clip).
    if (active || hovered) {
      this.roundRect(x, y, w, h, r);
      ctx.lineWidth = 4;
      ctx.strokeStyle =
        variant === "green" && active
          ? "rgba(110,214,128,0.18)"
          : variant === "danger"
          ? "rgba(248,113,113,0.16)"
          : VRT.accentHalo;
      ctx.stroke();
    }

    this.roundRect(x, y, w, h, r);
    if (active) {
      const ag = ctx.createLinearGradient(x, y, x, y + h);
      if (variant === "green") {
        ag.addColorStop(0, VRT.greenGradTop);
        ag.addColorStop(1, VRT.greenGradBot);
      } else {
        ag.addColorStop(0, VRT.accentGradTop);
        ag.addColorStop(1, VRT.accentGradBot);
      }
      ctx.fillStyle = ag;
    } else if (hovered) {
      // Accent-tinted wash (red-tinted for the danger button) so hover reads
      // as "this will respond", not just a brighter grey.
      const hg = ctx.createLinearGradient(x, y, x, y + h);
      if (variant === "danger") {
        hg.addColorStop(0, "rgba(248,113,113,0.24)");
        hg.addColorStop(1, "rgba(248,113,113,0.10)");
      } else {
        hg.addColorStop(0, VRT.accentWashTop);
        hg.addColorStop(1, VRT.accentWashBot);
      }
      ctx.fillStyle = hg;
    } else {
      const dg = ctx.createLinearGradient(x, y, x, y + h);
      dg.addColorStop(0, VRT.raisedTop);
      dg.addColorStop(1, VRT.raisedBot);
      ctx.fillStyle = dg;
    }
    ctx.fill();

    // Border
    this.roundRect(x, y, w, h, r);
    ctx.lineWidth = 1;
    if (variant === "danger" && !active) {
      ctx.strokeStyle = VRT.dangerBorder;
    } else if (active) {
      ctx.strokeStyle = variant === "green" ? VRT.greenBorder : VRT.accentBorder;
    } else {
      ctx.strokeStyle = hovered ? VRT.accentBorder : VRT.raisedBorder;
    }
    ctx.stroke();

    // Glass rim — top-edge highlight
    ctx.beginPath();
    ctx.moveTo(x + r + 1, y + 1);
    ctx.lineTo(x + w - r - 1, y + 1);
    ctx.lineWidth = 1;
    ctx.strokeStyle = active ? "rgba(255,255,255,0.50)" : "rgba(255,255,255,0.22)";
    ctx.stroke();

    const cx = x + w / 2;
    const cy = y + h / 2;
    if (label.startsWith("icon:")) {
      const name = label.slice(5);
      if (name === "handy") this.drawHandyIcon(cx, cy, active);
      else this.drawIcon(name, cx, cy, active);
    } else {
      ctx.font = "600 26px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle =
        variant === "danger"
          ? VRT.dangerText
          : active
          ? VRT.onAccent
          : "rgba(255,255,255,0.92)";
      ctx.fillText(label, cx, cy + 1);
    }

    this.regions.push(region);
  }

  /** The Handy modal icon (/handy.png), tinted to match button state. */
  private getHandyIcon(active: boolean): HTMLCanvasElement | null {
    const img = this.image("/handy.png");
    if (!img) return null;
    if (!this.handyTint || this.handyTintActive !== active) {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const cx = c.getContext("2d");
      if (!cx) return null;
      cx.drawImage(img, 0, 0);
      // Replace the icon's opaque pixels with the tint, preserving its alpha.
      cx.globalCompositeOperation = "source-in";
      cx.fillStyle = active ? "#0b1020" : "rgba(255,255,255,0.92)";
      cx.fillRect(0, 0, c.width, c.height);
      this.handyTint = c;
      this.handyTintActive = active;
    }
    return this.handyTint;
  }

  private drawHandyIcon(cx: number, cy: number, active: boolean) {
    const { ctx } = this;
    const icon = this.getHandyIcon(active);
    if (icon && icon.width > 0) {
      const max = 34;
      const scale = Math.min(max / icon.width, max / icon.height);
      const w = icon.width * scale;
      const h = icon.height * scale;
      ctx.drawImage(icon, cx - w / 2, cy - h / 2, w, h);
    } else {
      // Fallback glyph until the image loads.
      ctx.font = "600 22px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = active ? "#0b1020" : "rgba(255,255,255,0.92)";
      ctx.fillText("H", cx, cy + 1);
    }
  }

  private drawIcon(name: string, cx: number, cy: number, active: boolean) {
    const { ctx } = this;
    ctx.fillStyle = active ? "#0b1020" : "rgba(255,255,255,0.92)";
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 4;
    const s = 16;
    switch (name) {
      case "play":
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.7, cy - s);
        ctx.lineTo(cx - s * 0.7, cy + s);
        ctx.lineTo(cx + s, cy);
        ctx.closePath();
        ctx.fill();
        break;
      case "pause":
        ctx.fillRect(cx - s * 0.8, cy - s, s * 0.55, s * 2);
        ctx.fillRect(cx + s * 0.25, cy - s, s * 0.55, s * 2);
        break;
      case "prev":
      case "chapPrev":
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.6, cy - s);
        ctx.lineTo(cx - s * 0.4, cy);
        ctx.lineTo(cx + s * 0.6, cy + s);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(cx - s * 0.7, cy - s, 4, s * 2);
        break;
      case "next":
      case "chapNext":
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.6, cy - s);
        ctx.lineTo(cx + s * 0.4, cy);
        ctx.lineTo(cx - s * 0.6, cy + s);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(cx + s * 0.5, cy - s, 4, s * 2);
        break;
      case "vol":
        ctx.beginPath();
        ctx.moveTo(cx - s, cy - s * 0.4);
        ctx.lineTo(cx - s * 0.3, cy - s * 0.4);
        ctx.lineTo(cx + s * 0.3, cy - s);
        ctx.lineTo(cx + s * 0.3, cy + s);
        ctx.lineTo(cx - s * 0.3, cy + s * 0.4);
        ctx.lineTo(cx - s, cy + s * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + s * 0.5, cy, s * 0.6, -Math.PI / 3, Math.PI / 3);
        ctx.stroke();
        break;
      case "muted":
        ctx.beginPath();
        ctx.moveTo(cx - s, cy - s * 0.4);
        ctx.lineTo(cx - s * 0.3, cy - s * 0.4);
        ctx.lineTo(cx + s * 0.3, cy - s);
        ctx.lineTo(cx + s * 0.3, cy + s);
        ctx.lineTo(cx - s * 0.3, cy + s * 0.4);
        ctx.lineTo(cx - s, cy + s * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.45, cy - s * 0.5);
        ctx.lineTo(cx + s * 1.1, cy + s * 0.5);
        ctx.moveTo(cx + s * 1.1, cy - s * 0.5);
        ctx.lineTo(cx + s * 0.45, cy + s * 0.5);
        ctx.stroke();
        break;
    }
  }
}
