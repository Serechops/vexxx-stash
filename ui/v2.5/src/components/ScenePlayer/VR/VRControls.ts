/**
 * VRControlPanel — the floating DeoVR/HereSphere-style control bar.
 *
 * Rendered as a 2D canvas mapped onto a flat plane (a `CanvasTexture`), which
 * keeps hit-testing trivial (raycaster `.uv` → canvas pixel) and needs no extra
 * in-VR UI dependency. The panel is updated each frame from a pulled
 * [IVRPlaybackState] snapshot and emits [VRControlAction]s through `onAction`.
 *
 * Controls are laid out in two centred rows (transport + view/settings) so
 * they never overlap. The scrubber exposes the current hover position so the
 * session manager can float a VTT thumbnail preview above it.
 */
import * as THREE from "three";
import TextUtils from "src/utils/text";
import { IProjectionSettings, fovLabel, stereoLabel } from "./projection";
import { VRControlAction, IVRMarker, IVRPlaybackState } from "./types";

const CANVAS_W = 1280;
const CANVAS_H = 420;
/** Physical size of the panel plane, metres. */
const PANEL_WIDTH_M = 2.6;
const PANEL_HEIGHT_M = (CANVAS_H / CANVAS_W) * PANEL_WIDTH_M;

const PAD = 36;
const SCRUB_Y = 96;
const SCRUB_H = 44;
const SCRUB_X = PAD;
const SCRUB_W = CANVAS_W - PAD * 2;

const ROW1_Y = 196;
const ROW2_Y = 296;
const BTN_H = 76;
const GAP = 16;

interface IHitRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface IRowItem {
  id: string;
  w: number;
  label?: string;
  active?: boolean;
  variant?: "default" | "danger";
  kind?: "button" | "volume";
}

export interface IDrawInput {
  state: IVRPlaybackState;
  projection: IProjectionSettings;
  markers: IVRMarker[];
  chapterTitle: string | null;
  /** Active caption cue text, when captions are on. */
  caption: string | null;
}

const RATE_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export class VRControlPanel {
  readonly object: THREE.Group;
  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;

  private regions: IHitRegion[] = [];
  private hoveredId: string | null = null;
  private hoverFraction: number | null = null;
  private heatmap: HTMLImageElement | null = null;

  private last: IDrawInput | null = null;
  // Dirty-check: the canvas is only redrawn + re-uploaded when its visible
  // content changes, not every frame. The comparison is allocation-free (it
  // compares against the stored primitives in `prev`) so the render loop —
  // which runs on the main thread feeding the XR compositor — produces no
  // per-frame garbage that would trigger GC stalls (seen as black flicker).
  private dirty = true;
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
    fov: "",
    stereo: "",
    chap: null as string | null,
    cap: null as string | null,
    hov: null as string | null,
    hf: -1,
  };

  onAction?: (a: VRControlAction) => void;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("VRControlPanel: 2D canvas context unavailable");
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    const geometry = new THREE.PlaneGeometry(PANEL_WIDTH_M, PANEL_HEIGHT_M);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.mesh.name = "vr-control-panel";

    this.object = new THREE.Group();
    this.object.add(this.mesh);
  }

  /** The raycast target (the panel plane). */
  get hitTarget(): THREE.Object3D {
    return this.mesh;
  }

  /** Physical width of the panel, metres (for preview clamping). */
  get widthMeters(): number {
    return PANEL_WIDTH_M;
  }

  /** Physical height of the panel, metres (for stacking the info panels). */
  get heightMeters(): number {
    return PANEL_HEIGHT_M;
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
    const localX = (cx / CANVAS_W - 0.5) * PANEL_WIDTH_M;
    const localY = (0.5 - cy / CANVAS_H) * PANEL_HEIGHT_M;
    return new THREE.Vector3(localX, localY, 0.03);
  }

  /** Fade + cull: opacity drives the material; below threshold we hide it. */
  setRenderState(opacity: number) {
    this.material.opacity = opacity;
    this.mesh.visible = opacity > 0.02;
  }

  /** Load the funscript heatmap (CSS `url("data:…")`) for the scrubber bg. */
  setHeatmap(cssUrl: string | null) {
    if (!cssUrl) {
      this.heatmap = null;
      this.dirty = true;
      return;
    }
    // generateFunscriptWaveform returns `url("data:image/svg+xml,…")`.
    const match = cssUrl.match(/^url\(["']?(.*?)["']?\)$/);
    const src = match ? match[1] : cssUrl;
    const img = new Image();
    img.onload = () => {
      this.heatmap = img;
      this.dirty = true;
    };
    img.src = src;
  }

  update(input: IDrawInput) {
    this.last = input;
    const changed = this.stateChanged(input);
    if (!this.dirty && !changed) return;
    this.dirty = false;
    this.draw(input);
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
    pr.fov = fov;
    pr.stereo = stereo;
    pr.chap = chapterTitle;
    pr.cap = caption;
    pr.hov = this.hoveredId;
    pr.hf = hf;
    return true;
  }

  // --- hit testing ----------------------------------------------------------

  private uvToCanvas(uv: THREE.Vector2): { x: number; y: number } {
    return { x: uv.x * CANVAS_W, y: (1 - uv.y) * CANVAS_H };
  }

  private regionAt(uv: THREE.Vector2): IHitRegion | null {
    const { x, y } = this.uvToCanvas(uv);
    for (const r of this.regions) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }

  setHovered(uv: THREE.Vector2 | null) {
    const region = uv ? this.regionAt(uv) : null;
    const id = region?.id ?? null;
    let fraction: number | null = null;
    if (region && region.id === "scrubber" && uv) {
      const { x } = this.uvToCanvas(uv);
      fraction = Math.min(1, Math.max(0, (x - region.x) / region.w));
    }
    // Cheap state update; the change is picked up by the next update()'s
    // signature check, which triggers a redraw only when hover actually moves.
    this.hoveredId = id;
    this.hoverFraction = fraction;
  }

  /** Resolve a selection at the given uv into an action. */
  activate(uv: THREE.Vector2): VRControlAction | null {
    const region = this.regionAt(uv);
    if (!region) return null;
    const { x } = this.uvToCanvas(uv);

    switch (region.id) {
      case "scrubber": {
        const fraction = Math.min(1, Math.max(0, (x - region.x) / region.w));
        return { type: "seekFraction", fraction };
      }
      case "volume": {
        const value = Math.min(1, Math.max(0, (x - region.x) / region.w));
        return { type: "setVolume", value };
      }
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
      case "exit":
        return { type: "exit" };
      default:
        return null;
    }
  }

  // --- drawing --------------------------------------------------------------

  private draw(input: IDrawInput) {
    const { state, projection, markers, chapterTitle, caption } = input;
    const { ctx } = this;
    this.regions = [];

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Panel background
    this.roundRect(0, 0, CANVAS_W, CANVAS_H, 28);
    ctx.fillStyle = "rgba(12,12,14,0.86)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.stroke();

    const dur = state.duration && isFinite(state.duration) ? state.duration : 0;
    const cur = Math.min(state.currentTime, dur || state.currentTime);

    // Top line: caption cue (centred) takes priority, else chapter / status.
    ctx.textBaseline = "alphabetic";
    if (caption) {
      ctx.font = "600 26px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(caption, CANVAS_W / 2, SCRUB_Y - 20, CANVAS_W - PAD * 2);
    } else {
      ctx.font = "600 22px sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      const topText = state.waiting ? "Buffering…" : chapterTitle ?? "";
      if (topText) ctx.fillText(topText, PAD, SCRUB_Y - 20);
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

    // Time labels
    ctx.font = "500 24px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textAlign = "left";
    ctx.fillText(
      TextUtils.secondsToTimestamp(cur),
      PAD,
      SCRUB_Y + SCRUB_H + 30
    );
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(
      TextUtils.secondsToTimestamp(dur),
      CANVAS_W - PAD,
      SCRUB_Y + SCRUB_H + 30
    );

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

    // Row 2 — projection / view, captions, exit.
    this.layoutRow(
      [
        { id: "fov", w: 104, label: fovLabel(projection) },
        { id: "stereo", w: 116, label: stereoLabel(projection) },
        { id: "swap", w: 104, label: "Swap", active: projection.swapEyes },
        { id: "recenter", w: 150, label: "Recenter" },
        { id: "captions", w: 84, label: "CC", active: state.captionsOn },
        { id: "exit", w: 110, label: "Exit", variant: "danger" },
      ],
      ROW2_Y,
      state
    );

    this.texture.needsUpdate = true;
  }

  /** Lay out a row of controls, centred horizontally, with even gaps. */
  private layoutRow(items: IRowItem[], y: number, state: IVRPlaybackState) {
    const total =
      items.reduce((s, it) => s + it.w, 0) + GAP * (items.length - 1);
    let x = Math.round((CANVAS_W - total) / 2);
    for (const it of items) {
      const region: IHitRegion = { id: it.id, x, y, w: it.w, h: BTN_H };
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

    // Funscript heatmap (clipped to the rounded track)
    if (this.heatmap) {
      ctx.save();
      this.roundRect(x, y, w, h, r);
      ctx.clip();
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.heatmap, x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    if (dur > 0) {
      const progressX = x + Math.min(1, cur / dur) * w;

      if (markers.length > 0) {
        // Chapter segments: each marker colours a band of the timeline (so you
        // can see *where* each marker sits), replacing the old vertical ticks.
        // The whole bar is drawn dim; the played portion is redrawn vivid, so
        // progress reads out without a separate fill on top.
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
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 2;
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

  private drawVolume(region: IHitRegion, state: IVRPlaybackState) {
    const { ctx } = this;
    const { x, y, w, h } = region;
    const track = h * 0.18;
    const ty = y + h / 2 - track / 2;
    this.roundRect(x, ty, w, track, track / 2);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fill();
    const level = state.muted ? 0 : state.volume;
    this.roundRect(x, ty, w * level, track, track / 2);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fill();
    // knob
    ctx.beginPath();
    ctx.arc(x + w * level, y + h / 2, h * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    if (this.hoveredId === "volume") {
      this.roundRect(x - 6, y + 6, w + 12, h - 12, 12);
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  private drawButton(
    region: IHitRegion,
    label: string,
    active: boolean,
    variant: "default" | "danger" = "default"
  ) {
    const { ctx } = this;
    const { x, y, w, h } = region;
    const hovered = this.hoveredId === region.id;

    this.roundRect(x, y, w, h, 14);
    if (active) {
      ctx.fillStyle = "rgba(96,165,250,0.92)";
    } else if (hovered) {
      ctx.fillStyle = "rgba(255,255,255,0.22)";
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
    }
    ctx.fill();
    if (variant === "danger" && !active) {
      ctx.strokeStyle = "rgba(248,113,113,0.6)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const cx = x + w / 2;
    const cy = y + h / 2;
    if (label.startsWith("icon:")) {
      this.drawIcon(label.slice(5), cx, cy, active);
    } else {
      ctx.font = "600 26px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle =
        variant === "danger"
          ? "rgba(252,165,165,0.95)"
          : active
          ? "#0b1020"
          : "rgba(255,255,255,0.92)";
      ctx.fillText(label, cx, cy + 1);
    }

    this.regions.push(region);
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

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const { ctx } = this;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  dispose() {
    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}
