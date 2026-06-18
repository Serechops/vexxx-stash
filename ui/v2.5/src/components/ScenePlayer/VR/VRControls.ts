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

const ACCENT = "rgba(96,165,250,0.95)";

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
    chap: null as string | null,
    cap: null as string | null,
    hov: null as string | null,
    hf: -1,
  };

  constructor() {
    super(PANEL_WIDTH_M, CANVAS_W, CANVAS_H);
    this.mesh.name = "vr-control-panel";
  }

  /** Fraction (0..1) of the scrubber currently hovered, or null. */
  get scrubberHoverFraction(): number | null {
    return this.hoverFraction;
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
    const changed = this.stateChanged(input);
    if (!this.contentDirty && !changed) return;
    this.contentDirty = false;
    this.draw();
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
    const hf =
      this.hoverFraction == null ? -1 : Math.round(this.hoverFraction * 1000);
    const heat = this.heatmap != null;
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
      pr.chap === chapterTitle &&
      pr.cap === caption &&
      pr.hov === this.hoveredId &&
      pr.hf === hf
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
    pr.chap = chapterTitle;
    pr.cap = caption;
    pr.hov = this.hoveredId;
    pr.hf = hf;
    return true;
  }

  // --- hit testing ----------------------------------------------------------

  setHovered(uv: THREE.Vector2 | null) {
    const region = uv ? this.regionAt(uv) : null;
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
      case "recenter":
        return { type: "recenter" };
      case "captions":
        return { type: "toggleCaptions" };
      case "prevMarker":
        return { type: "prevMarker" };
      case "nextMarker":
        return { type: "nextMarker" };
      case "handy":
        return { type: "handyPanelToggle" };
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

    // Time labels (just under the scrubber).
    ctx.font = "500 24px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textAlign = "left";
    ctx.fillText(TextUtils.secondsToTimestamp(cur), PAD, TIME_Y);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(TextUtils.secondsToTimestamp(dur), CANVAS_W - PAD, TIME_Y);

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
      ],
      ROW1_Y,
      state
    );

    // Row 2 — projection / view, captions, Handy toggle, Browse, exit.
    const row2: IRowItem[] = [
      { id: "fov", w: 104, label: fovLabel(projection) },
      { id: "stereo", w: 116, label: stereoLabel(projection) },
      { id: "swap", w: 104, label: "Swap", active: projection.swapEyes },
      { id: "recenter", w: 150, label: "Recenter" },
      { id: "captions", w: 84, label: "CC", active: state.captionsOn },
    ];
    const handyGreen = !!(input.handy?.connected && input.handy?.funscriptLoaded);
    row2.push({
      id: "handy",
      w: 84,
      label: "icon:handy",
      active: handyGreen,
      variant: handyGreen ? "green" : "default",
    });
    row2.push({ id: "browse", w: 100, label: "Browse", active: !!input.browseOpen });
    row2.push({ id: "exit", w: 110, label: "Exit", variant: "danger" });
    this.layoutRow(row2, ROW2_Y, state);

    this.texture.needsUpdate = true;
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
      } else {
        this.drawButton(
          region,
          it.label ?? "",
          it.active ?? false,
          it.variant ?? "default"
        );
      }
      x += it.w + GAP;
    }
  }

  // --- chapters strip -------------------------------------------------------

  private drawStripLabel(text: string, bandY: number, bandH: number) {
    const { ctx } = this;
    ctx.font = "700 18px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.60)";
    ctx.fillText(text.toUpperCase(), STRIP_LABEL_X, bandY + bandH / 2);
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
    this.roundRect(x, y, w, h, 12);
    const mg = ctx.createLinearGradient(x, y, x, y + h);
    if (hovered) {
      mg.addColorStop(0, "rgba(96,165,250,0.22)");
      mg.addColorStop(1, "rgba(96,165,250,0.10)");
    } else {
      mg.addColorStop(0, "rgba(255,255,255,0.10)");
      mg.addColorStop(1, "rgba(255,255,255,0.04)");
    }
    ctx.fillStyle = mg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = hovered ? "rgba(96,165,250,0.40)" : "rgba(255,255,255,0.12)";
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
    });
  }

  private drawPatChip(pat: { id: string; label: string }, x: number, w: number) {
    const { ctx } = this;
    const active = this.patternActive === pat.id;
    const hovered = this.hoveredId === `pat:${pat.id}`;
    const chipY = PAT_Y + 4;
    const chipH = PAT_H - 8;
    this.roundRect(x, chipY, w, chipH, 12);
    if (active) {
      const ag = ctx.createLinearGradient(x, chipY, x, chipY + chipH);
      ag.addColorStop(0, "rgba(130,190,255,0.92)");
      ag.addColorStop(1, "rgba(70,130,230,0.80)");
      ctx.fillStyle = ag;
    } else {
      const dg = ctx.createLinearGradient(x, chipY, x, chipY + chipH);
      dg.addColorStop(0, hovered ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.12)");
      dg.addColorStop(1, hovered ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)");
      ctx.fillStyle = dg;
    }
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = active
      ? "rgba(160,210,255,0.35)"
      : hovered ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.14)";
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
    ctx.fillStyle = active ? "#091428" : "rgba(255,255,255,0.9)";
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

      // Playhead
      ctx.beginPath();
      ctx.arc(progressX, y + h / 2, h * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }

    // hover highlight + position marker
    if (this.hoveredId === "scrubber") {
      this.roundRect(x, y, w, h, r);
      ctx.strokeStyle = "rgba(96,165,250,0.55)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (this.hoverFraction != null) {
        const hx = x + this.hoverFraction * w;
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillRect(hx - 1.5, y - 8, 3, h + 16);
      }
    }

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
    // knob
    ctx.beginPath();
    ctx.arc(x + w * level, y + h / 2, h * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    if (this.hoveredId === "volume") {
      this.roundRect(x - 6, y + 6, w + 12, h - 12, 12);
      ctx.strokeStyle = "rgba(96,165,250,0.45)";
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

    this.roundRect(x, y, w, h, 14);
    if (active) {
      const ag = ctx.createLinearGradient(x, y, x, y + h);
      if (variant === "green") {
        ag.addColorStop(0, "rgba(110,210,115,0.92)");
        ag.addColorStop(1, "rgba(60,155,65,0.80)");
      } else {
        ag.addColorStop(0, "rgba(130,190,255,0.92)");
        ag.addColorStop(1, "rgba(70,130,230,0.80)");
      }
      ctx.fillStyle = ag;
    } else if (hovered) {
      const hg = ctx.createLinearGradient(x, y, x, y + h);
      hg.addColorStop(0, "rgba(255,255,255,0.26)");
      hg.addColorStop(1, "rgba(255,255,255,0.11)");
      ctx.fillStyle = hg;
    } else {
      const dg = ctx.createLinearGradient(x, y, x, y + h);
      dg.addColorStop(0, "rgba(255,255,255,0.12)");
      dg.addColorStop(1, "rgba(255,255,255,0.05)");
      ctx.fillStyle = dg;
    }
    ctx.fill();

    // Border
    this.roundRect(x, y, w, h, 14);
    ctx.lineWidth = 1;
    if (variant === "danger" && !active) {
      ctx.strokeStyle = "rgba(248,113,113,0.55)";
    } else if (active) {
      ctx.strokeStyle = variant === "green"
        ? "rgba(130,220,135,0.35)"
        : "rgba(160,210,255,0.35)";
    } else {
      ctx.strokeStyle = hovered ? "rgba(255,255,255,0.30)" : "rgba(255,255,255,0.12)";
    }
    ctx.stroke();

    // Glass rim — top-edge highlight
    ctx.beginPath();
    ctx.moveTo(x + 15, y + 1);
    ctx.lineTo(x + w - 15, y + 1);
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
          ? "rgba(252,165,165,0.95)"
          : active
          ? "#091428"
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
