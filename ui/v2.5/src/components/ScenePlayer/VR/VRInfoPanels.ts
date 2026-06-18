/**
 * VRInfoPanels — auxiliary floating panels that sit alongside the main control
 * bar in the immersive player: a **performers** strip (rectangular portraits —
 * deliberately *not* circular avatars) and a **scene info** panel (title, a
 * horizontally-scrollable tag row, and clickable chapter/marker timestamps).
 *
 * Both are drawn to a `CanvasTexture` on a flat plane (same proven recipe as
 * [VRControlPanel]) and live in the session manager's UI group so they pin,
 * drag and auto-hide together with the controls. Drawing is dirty-checked — the
 * canvas is only re-uploaded when something actually changes (hover, scroll, a
 * portrait finishing loading) — which keeps per-frame GPU work minimal.
 */
import * as THREE from "three";
import TextUtils from "src/utils/text";
import { VRControlAction, IVRHandyState } from "./types";

export interface IVRPerformer {
  name: string;
  imageUrl: string | null;
}

export interface IVRSceneInfo {
  title: string;
  performers: IVRPerformer[];
  tags: string[];
  markers: { title: string; seconds: number }[];
}

export interface IPanelRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Marker time (seconds) for chapter chips. */
  data?: number;
}

interface IScrollMeta {
  max: number;
  step: number;
}

const ACCENT = "rgba(96,165,250,0.95)";

/**
 * Shared canvas-panel plumbing: texture/mesh, dirty-checked redraw, hit
 * regions, image loading + caching, fade opacity, and a reusable
 * horizontally-scrollable strip with ‹ › buttons.
 */
export abstract class VRCanvasPanel {
  readonly object: THREE.Group;
  protected mesh: THREE.Mesh;
  protected canvas: HTMLCanvasElement;
  protected ctx: CanvasRenderingContext2D;
  protected texture: THREE.CanvasTexture;
  protected material: THREE.MeshBasicMaterial;

  protected readonly cw: number;
  protected readonly ch: number;
  protected readonly wM: number;
  protected readonly hM: number;

  protected regions: IPanelRegion[] = [];
  protected hoveredId: string | null = null;
  /** Last hover UV in canvas-pixel space (for slider fraction computation). */
  protected hoverUV: { x: number; y: number } | null = null;
  protected scrollMeta = new Map<string, IScrollMeta>();

  private images = new Map<string, HTMLImageElement>();
  private failed = new Set<string>();
  private dirty = true;

  constructor(widthM: number, canvasW: number, canvasH: number) {
    this.wM = widthM;
    this.cw = canvasW;
    this.ch = canvasH;
    this.hM = (canvasH / canvasW) * widthM;

    this.canvas = document.createElement("canvas");
    this.canvas.width = canvasW;
    this.canvas.height = canvasH;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("VRCanvasPanel: 2D canvas context unavailable");
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.wM, this.hM),
      this.material
    );
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;

    this.object = new THREE.Group();
    this.object.add(this.mesh);
  }

  get hitTarget(): THREE.Object3D {
    return this.mesh;
  }

  get widthMeters(): number {
    return this.wM;
  }

  get heightMeters(): number {
    return this.hM;
  }

  /** Fade + cull: opacity drives the material; below threshold we hide it. */
  setRenderState(opacity: number) {
    this.material.opacity = opacity;
    this.mesh.visible = opacity > 0.02;
  }

  setHovered(uv: THREE.Vector2 | null) {
    const id = uv ? this.regionAt(uv)?.id ?? null : null;
    const px = uv ? { x: uv.x * this.cw, y: (1 - uv.y) * this.ch } : null;
    if (id !== this.hoveredId) {
      this.hoveredId = id;
      this.markDirty();
    }
    this.hoverUV = px;
  }

  activate(uv: THREE.Vector2): VRControlAction | null {
    const region = this.regionAt(uv);
    if (!region) return null;
    return this.handleSelect(region);
  }

  /** Redraw only when something visible changed (cheap when idle). */
  update() {
    if (!this.dirty) return;
    this.regions = [];
    this.draw();
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  protected markDirty() {
    this.dirty = true;
  }

  protected abstract draw(): void;
  protected abstract handleSelect(region: IPanelRegion): VRControlAction | null;

  // --- hit testing ----------------------------------------------------------

  protected regionAt(uv: THREE.Vector2): IPanelRegion | null {
    const x = uv.x * this.cw;
    const y = (1 - uv.y) * this.ch;
    for (const r of this.regions) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }

  protected scrollBy(prefix: string, dir: -1 | 1, current: number): number {
    const meta = this.scrollMeta.get(prefix);
    if (!meta) return current;
    return Math.min(meta.max, Math.max(0, current + dir * meta.step));
  }

  // --- shared drawing helpers ----------------------------------------------

  /** Load + cache an image; triggers a redraw when it arrives. null until then. */
  protected image(url: string | null): HTMLImageElement | null {
    if (!url || this.failed.has(url)) return null;
    let img = this.images.get(url);
    if (!img) {
      img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => this.markDirty();
      img.onerror = () => {
        this.failed.add(url);
        this.markDirty();
      };
      img.src = url;
      this.images.set(url, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  protected roundRect(x: number, y: number, w: number, h: number, r: number) {
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

  protected panelBackground() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.cw, this.ch);
    this.roundRect(0, 0, this.cw, this.ch, 24);
    ctx.fillStyle = "rgba(12,12,14,0.86)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.stroke();
  }

  protected sectionLabel(text: string, x: number, y: number) {
    const { ctx } = this;
    ctx.font = "700 20px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(text.toUpperCase(), x, y);
  }

  /**
   * Draw an [Info] [Scenes] tab header at the top of the panel.
   * Registers a hit region only for the inactive tab (active tab is not clickable).
   * Returns the Y coordinate where panel content should begin (= 84).
   */
  protected drawTabHeader(active: "info" | "scenes"): number {
    const { ctx } = this;
    const TAB_H = 52;
    const PAD = 16;
    const tabW = (this.cw - PAD * 2 - 8) / 2;
    const tabs: Array<{ id: "info" | "scenes"; label: string }> = [
      { id: "info", label: "Info" },
      { id: "scenes", label: "Scenes" },
    ];
    let x = PAD;
    for (const tab of tabs) {
      const isActive = tab.id === active;
      this.roundRect(x, PAD, tabW, TAB_H, 12);
      ctx.fillStyle = isActive
        ? "rgba(96,165,250,0.85)"
        : this.hoveredId === `browseTab:${tab.id}`
          ? "rgba(255,255,255,0.18)"
          : "rgba(255,255,255,0.08)";
      ctx.fill();
      ctx.font = "600 24px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isActive ? "#0b1020" : "rgba(255,255,255,0.9)";
      ctx.fillText(tab.label, x + tabW / 2, PAD + TAB_H / 2 + 1);
      if (!isActive) {
        this.regions.push({
          id: `browseTab:${tab.id}`,
          x,
          y: PAD,
          w: tabW,
          h: TAB_H,
        });
      }
      x += tabW + 8;
    }
    return PAD + TAB_H + PAD; // 84 — content Y start
  }

  /** Draw an image with object-fit: cover, clipped to a rounded rect. */
  protected drawImageCover(
    img: HTMLImageElement,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    radius: number
  ) {
    const { ctx } = this;
    ctx.save();
    this.roundRect(dx, dy, dw, dh, radius);
    ctx.clip();
    const ir = img.naturalWidth / img.naturalHeight;
    const dr = dw / dh;
    let sx = 0;
    let sy = 0;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    if (ir > dr) {
      sw = sh * dr;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = sw / dr;
      sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.restore();
  }

  protected fitText(text: string, maxW: number): string {
    const { ctx } = this;
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) {
      t = t.slice(0, -1);
    }
    return `${t}…`;
  }

  /**
   * Lay out a horizontally-scrollable strip of items between [x0,x1]. Items are
   * clipped to the strip; when they overflow, ‹ › buttons appear at the ends
   * (registered as `${prefix}ScrollL` / `${prefix}ScrollR`). `drawItem` renders
   * one item at its current x; `regionId` optionally makes an item clickable.
   */
  protected hStrip(opts: {
    prefix: string;
    x0: number;
    x1: number;
    y: number;
    h: number;
    scrollX: number;
    widths: number[];
    gap: number;
    drawItem: (i: number, x: number, w: number) => void;
    regionId?: (i: number) => { id: string; data?: number } | null;
  }) {
    const { ctx } = this;
    const { prefix, x0, x1, y, h, widths, gap } = opts;
    const contentW =
      widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, widths.length - 1);
    const scrollable = contentW > x1 - x0 + 1;
    const clipL = scrollable ? x0 + 52 : x0;
    const clipR = scrollable ? x1 - 52 : x1;
    const clipW = clipR - clipL;
    const max = Math.max(0, contentW - clipW);
    const sx = Math.min(max, Math.max(0, opts.scrollX));
    this.scrollMeta.set(prefix, { max, step: clipW * 0.7 });

    // Register button hit-regions first so they win over partly-clipped items.
    if (scrollable) {
      this.regions.push({ id: `${prefix}ScrollL`, x: x0, y, w: 52, h });
      this.regions.push({ id: `${prefix}ScrollR`, x: x1 - 52, y, w: 52, h });
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(clipL, y, clipW, h);
    ctx.clip();
    let x = clipL - sx;
    for (let i = 0; i < widths.length; i++) {
      const w = widths[i];
      if (x + w > clipL && x < clipR) {
        opts.drawItem(i, x, w);
        const reg = opts.regionId?.(i);
        if (reg) {
          const rx = Math.max(x, clipL);
          const rw = Math.min(x + w, clipR) - rx;
          if (rw > 4) {
            this.regions.push({
              id: reg.id,
              data: reg.data,
              x: rx,
              y,
              w: rw,
              h,
            });
          }
        }
      }
      x += w + gap;
    }
    ctx.restore();

    if (scrollable) {
      const cy = y + h / 2;
      this.drawScrollButton(x0 + 26, cy, "‹", sx > 1, `${prefix}ScrollL`);
      this.drawScrollButton(x1 - 26, cy, "›", sx < max - 1, `${prefix}ScrollR`);
    }
  }

  private drawScrollButton(
    cx: number,
    cy: number,
    glyph: string,
    enabled: boolean,
    id: string
  ) {
    const { ctx } = this;
    const hovered = this.hoveredId === id;
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.fillStyle = hovered
      ? "rgba(255,255,255,0.28)"
      : "rgba(255,255,255,0.12)";
    ctx.fill();
    ctx.font = "700 34px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = enabled
      ? "rgba(255,255,255,0.95)"
      : "rgba(255,255,255,0.35)";
    ctx.fillText(glyph, cx, cy + 1);
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.images.clear();
    this.failed.clear();
  }
}

/** Performers strip — rectangular portrait cards with the name overlaid. */
export class VRPerformersPanel extends VRCanvasPanel {
  private scroll = 0;

  constructor(private performers: IVRPerformer[]) {
    super(1.28, 880, 440);
  }

  get hasContent(): boolean {
    return this.performers.length > 0;
  }

  protected handleSelect(region: IPanelRegion): VRControlAction | null {
    if (region.id === "perfScrollL") {
      this.scroll = this.scrollBy("perf", -1, this.scroll);
      this.markDirty();
    } else if (region.id === "perfScrollR") {
      this.scroll = this.scrollBy("perf", 1, this.scroll);
      this.markDirty();
    }
    return null; // portraits are informational only
  }

  protected draw() {
    const { ctx } = this;
    this.panelBackground();
    this.sectionLabel("Performers", 24, 40);

    const rowY = 60;
    const rowH = this.ch - rowY - 20;
    const cardW = Math.round(rowH * 0.72); // portrait aspect
    const widths = this.performers.map(() => cardW);

    this.hStrip({
      prefix: "perf",
      x0: 20,
      x1: this.cw - 20,
      y: rowY,
      h: rowH,
      scrollX: this.scroll,
      widths,
      gap: 16,
      drawItem: (i, x) => this.drawCard(i, x, rowY, cardW, rowH),
    });

    if (this.performers.length === 0) {
      ctx.font = "500 24px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText("No performers", this.cw / 2, rowY + rowH / 2);
    }
  }

  private drawCard(i: number, x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    const p = this.performers[i];
    const img = this.image(p.imageUrl);
    const radius = 14;

    if (img) {
      this.drawImageCover(img, x, y, w, h, radius);
    } else {
      this.roundRect(x, y, w, h, radius);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fill();
      ctx.font = "700 44px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText(initials(p.name), x + w / 2, y + h / 2 - 10);
    }

    // Name plate (gradient → readable over any portrait).
    ctx.save();
    this.roundRect(x, y, w, h, radius);
    ctx.clip();
    const grad = ctx.createLinearGradient(0, y + h - 70, 0, y + h);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y + h - 70, w, 70);
    ctx.font = "600 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(this.fitText(p.name, w - 16), x + w / 2, y + h - 20);
    ctx.restore();

    this.roundRect(x, y, w, h, radius);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.stroke();
  }
}

/** Scene info — title, scrollable tag chips, and clickable chapter timestamps. */
export class VRSceneInfoPanel extends VRCanvasPanel {
  private tagScroll = 0;
  private markerScroll = 0;
  private tagWidths: number[] = [];
  private markerWidths: number[] = [];

  constructor(private info: IVRSceneInfo) {
    super(1.28, 880, 360);
  }

  get hasContent(): boolean {
    return (
      !!this.info.title ||
      this.info.tags.length > 0 ||
      this.info.markers.length > 0
    );
  }

  protected handleSelect(region: IPanelRegion): VRControlAction | null {
    switch (region.id) {
      case "tagScrollL":
        this.tagScroll = this.scrollBy("tag", -1, this.tagScroll);
        this.markDirty();
        return null;
      case "tagScrollR":
        this.tagScroll = this.scrollBy("tag", 1, this.tagScroll);
        this.markDirty();
        return null;
      case "mkScrollL":
        this.markerScroll = this.scrollBy("mk", -1, this.markerScroll);
        this.markDirty();
        return null;
      case "mkScrollR":
        this.markerScroll = this.scrollBy("mk", 1, this.markerScroll);
        this.markDirty();
        return null;
      default:
        if (region.id.startsWith("mk:") && region.data != null) {
          return { type: "seekSeconds", seconds: region.data };
        }
        return null;
    }
  }

  protected draw() {
    const { ctx } = this;
    this.panelBackground();

    // Title
    ctx.font = "700 30px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(
      this.fitText(this.info.title || "Untitled scene", this.cw - 48),
      24,
      48
    );

    // Tags
    this.sectionLabel("Tags", 24, 88);
    const tagH = 52;
    const tagY = 100;
    ctx.font = "500 22px sans-serif";
    this.tagWidths = this.info.tags.map((t) =>
      Math.min(260, ctx.measureText(t).width + 32)
    );
    if (this.info.tags.length === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText("No tags", 24, tagY + 34);
    } else {
      this.hStrip({
        prefix: "tag",
        x0: 20,
        x1: this.cw - 20,
        y: tagY,
        h: tagH,
        scrollX: this.tagScroll,
        widths: this.tagWidths,
        gap: 12,
        drawItem: (i, x, w) => this.drawTag(i, x, tagY, w, tagH),
      });
    }

    // Chapters / markers
    this.sectionLabel("Chapters", 24, 192);
    const mkH = 96;
    const mkY = 204;
    ctx.font = "600 22px sans-serif";
    this.markerWidths = this.info.markers.map((m) =>
      Math.min(300, Math.max(150, ctx.measureText(m.title).width + 40))
    );
    if (this.info.markers.length === 0) {
      ctx.font = "500 22px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText("No chapters", 24, mkY + 50);
    } else {
      this.hStrip({
        prefix: "mk",
        x0: 20,
        x1: this.cw - 20,
        y: mkY,
        h: mkH,
        scrollX: this.markerScroll,
        widths: this.markerWidths,
        gap: 12,
        drawItem: (i, x, w) => this.drawMarker(i, x, mkY, w, mkH),
        regionId: (i) => ({
          id: `mk:${i}`,
          data: this.info.markers[i].seconds,
        }),
      });
    }
  }

  private drawTag(i: number, x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    this.roundRect(x, y, w, h, h / 2);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fill();
    ctx.font = "500 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(
      this.fitText(this.info.tags[i], w - 24),
      x + w / 2,
      y + h / 2 + 1
    );
  }

  private drawMarker(i: number, x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    const m = this.info.markers[i];
    const hovered = this.hoveredId === `mk:${i}`;
    this.roundRect(x, y, w, h, 14);
    ctx.fillStyle = hovered
      ? "rgba(255,255,255,0.2)"
      : "rgba(255,255,255,0.08)";
    ctx.fill();

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 26px monospace";
    ctx.fillStyle = ACCENT;
    ctx.fillText(TextUtils.secondsToTimestamp(m.seconds), x + 16, y + 40);

    ctx.font = "500 20px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(this.fitText(m.title || "Chapter", w - 32), x + 16, y + 72);
  }
}

/**
 * VRInfoPanel — combined scene-info side panel, toggled via the 'i' button in
 * the main control bar.  Shows: scene title, full-size performer portraits with
 * names, a scrollable tag row, and clickable chapter/marker timestamps.
 * Placed to the left of the main control bar, angled toward the viewer.
 */
export class VRInfoPanel extends VRCanvasPanel {
  private perfScroll = 0;
  private tagScroll = 0;
  private markerScroll = 0;

  constructor(private info: IVRSceneInfo) {
    super(1.28, 880, 700);  // was 620; +80px for the tab header
  }

  protected handleSelect(region: IPanelRegion): VRControlAction | null {
    switch (region.id) {
      case "perfScrollL":
        this.perfScroll = this.scrollBy("perf", -1, this.perfScroll);
        this.markDirty();
        return null;
      case "perfScrollR":
        this.perfScroll = this.scrollBy("perf", 1, this.perfScroll);
        this.markDirty();
        return null;
      case "tagScrollL":
        this.tagScroll = this.scrollBy("tag", -1, this.tagScroll);
        this.markDirty();
        return null;
      case "tagScrollR":
        this.tagScroll = this.scrollBy("tag", 1, this.tagScroll);
        this.markDirty();
        return null;
      case "mkScrollL":
        this.markerScroll = this.scrollBy("mk", -1, this.markerScroll);
        this.markDirty();
        return null;
      case "mkScrollR":
        this.markerScroll = this.scrollBy("mk", 1, this.markerScroll);
        this.markDirty();
        return null;
      case "browseTab:scenes":
        return { type: "browseSetTab", tab: "scenes" };
      default:
        if (region.id.startsWith("mk:") && region.data != null) {
          return { type: "seekSeconds", seconds: region.data };
        }
        return null;
    }
  }

  protected draw() {
    const { ctx } = this;
    this.panelBackground();
    this.drawTabHeader("info");

    // ── Title ──────────────────────────────────────────────────────────────
    ctx.font = "700 32px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(
      this.fitText(this.info.title || "Untitled scene", this.cw - 48),
      24,
      132
    );

    // ── Performers ─────────────────────────────────────────────────────────
    // Large portrait cards (260 px tall) with full names overlaid.
    this.sectionLabel("Performers", 24, 172);
    const perfH = 260;
    const cardW = Math.round(perfH * 0.72); // ~187 px, portrait aspect
    const perfWidths = this.info.performers.map(() => cardW);
    if (this.info.performers.length === 0) {
      ctx.font = "500 22px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText("No performers", this.cw / 2, 180 + perfH / 2);
    } else {
      this.hStrip({
        prefix: "perf",
        x0: 20,
        x1: this.cw - 20,
        y: 180,
        h: perfH,
        scrollX: this.perfScroll,
        widths: perfWidths,
        gap: 16,
        drawItem: (i, x, w) => this.drawPerfCard(i, x, 180, w, perfH),
      });
    }

    // ── Tags ───────────────────────────────────────────────────────────────
    // perfBottom = 180 + 260 = 440; sectionLabel baseline at 440+34=474
    this.sectionLabel("Tags", 24, 474);
    const tagY = 488;
    const tagH = 50;
    ctx.font = "500 22px sans-serif";
    const tagWidths = this.info.tags.map((t) =>
      Math.min(260, ctx.measureText(t).width + 32)
    );
    if (this.info.tags.length === 0) {
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText("No tags", 24, tagY + 32);
    } else {
      this.hStrip({
        prefix: "tag",
        x0: 20,
        x1: this.cw - 20,
        y: tagY,
        h: tagH,
        scrollX: this.tagScroll,
        widths: tagWidths,
        gap: 12,
        drawItem: (i, x, w) => this.drawTagChip(i, x, tagY, w, tagH),
      });
    }

    // ── Chapters ───────────────────────────────────────────────────────────
    // tagBottom = 488 + 50 = 538; sectionLabel baseline at 538+34=572
    this.sectionLabel("Chapters", 24, 572);
    const mkY = 584;
    const mkH = 90;
    ctx.font = "600 22px sans-serif";
    const markerWidths = this.info.markers.map((m) =>
      Math.min(300, Math.max(150, ctx.measureText(m.title).width + 40))
    );
    if (this.info.markers.length === 0) {
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText("No chapters", 24, mkY + 50);
    } else {
      this.hStrip({
        prefix: "mk",
        x0: 20,
        x1: this.cw - 20,
        y: mkY,
        h: mkH,
        scrollX: this.markerScroll,
        widths: markerWidths,
        gap: 12,
        drawItem: (i, x, w) => this.drawMarkerCard(i, x, mkY, w, mkH),
        regionId: (i) => ({
          id: `mk:${i}`,
          data: this.info.markers[i].seconds,
        }),
      });
    }
  }

  private drawPerfCard(i: number, x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    const p = this.info.performers[i];
    const img = this.image(p.imageUrl);
    const radius = 16;

    if (img) {
      this.drawImageCover(img, x, y, w, h, radius);
    } else {
      this.roundRect(x, y, w, h, radius);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fill();
      ctx.font = "700 48px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText(initials(p.name), x + w / 2, y + h / 2 - 10);
    }

    // Name plate: gradient scrim at the bottom + full name text.
    ctx.save();
    this.roundRect(x, y, w, h, radius);
    ctx.clip();
    const grad = ctx.createLinearGradient(0, y + h - 72, 0, y + h);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.88)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y + h - 72, w, 72);
    ctx.font = "600 24px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(this.fitText(p.name, w - 16), x + w / 2, y + h - 20);
    ctx.restore();

    this.roundRect(x, y, w, h, radius);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.stroke();
  }

  private drawTagChip(i: number, x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    this.roundRect(x, y, w, h, h / 2);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fill();
    ctx.font = "500 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(
      this.fitText(this.info.tags[i], w - 24),
      x + w / 2,
      y + h / 2 + 1
    );
  }

  private drawMarkerCard(i: number, x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    const m = this.info.markers[i];
    const hovered = this.hoveredId === `mk:${i}`;
    this.roundRect(x, y, w, h, 14);
    ctx.fillStyle = hovered
      ? "rgba(255,255,255,0.2)"
      : "rgba(255,255,255,0.08)";
    ctx.fill();

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 26px monospace";
    ctx.fillStyle = ACCENT;
    ctx.fillText(TextUtils.secondsToTimestamp(m.seconds), x + 16, y + 40);

    ctx.font = "500 20px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(this.fitText(m.title || "Chapter", w - 32), x + 16, y + 72);
  }
}

/** VRHandyPanel — compact connection-status panel on the left side in VR. */
export class VRHandyPanel extends VRCanvasPanel {
  private handyState: IVRHandyState = {
    status: "missing",
    label: "",
    configured: false,
  };

  constructor() {
    super(0.9, 640, 280);
    this.mesh.name = "vr-handy-panel";
  }

  get hasContent(): boolean {
    return true;
  }

  setHandyState(st: IVRHandyState) {
    if (
      st.status !== this.handyState.status ||
      st.label !== this.handyState.label ||
      st.configured !== this.handyState.configured
    ) {
      this.handyState = st;
      this.markDirty();
    }
  }

  protected handleSelect(region: IPanelRegion): VRControlAction | null {
    switch (region.id) {
      case "handyConnect":
        return { type: "handyConnect" };
      case "handySync":
        return { type: "handySync" };
      default:
        return null;
    }
  }

  protected draw() {
    const { ctx } = this;
    this.panelBackground();
    const hs = this.handyState;

    const statusColors: Record<string, string> = {
      ready: "rgba(76,175,80,0.85)",
      connecting: "rgba(255,193,7,0.85)",
      syncing: "rgba(255,193,7,0.85)",
      uploading: "rgba(33,150,243,0.85)",
      error: "rgba(244,67,54,0.85)",
      missing: "rgba(255,255,255,0.25)",
      disconnected: "rgba(255,255,255,0.25)",
    };
    const statusColor = statusColors[hs.status] ?? "rgba(255,255,255,0.25)";

    // Status row background
    this.roundRect(20, 20, this.cw - 40, 52, 14);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();

    // Status dot
    ctx.beginPath();
    ctx.arc(44, 46, 9, 0, Math.PI * 2);
    ctx.fillStyle = statusColor;
    ctx.fill();

    // Label
    ctx.font = "600 26px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(this.fitText(hs.label || "Handy", 260), 64, 46);

    if (!hs.configured) {
      // Note: settings instruction (no VR keyboard)
      ctx.font = "400 20px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fillText("Set your connection key in", this.cw / 2, 130);
      ctx.fillText("Settings to pair.", this.cw / 2, 158);
    } else if (hs.status === "ready") {
      this.drawActionBtn(this.cw - 140, 20, 120, 52, "Sync", "handySync");
    } else if (
      hs.status === "disconnected" ||
      hs.status === "error" ||
      hs.status === "missing"
    ) {
      this.drawActionBtn(this.cw - 156, 20, 136, 52, "Connect", "handyConnect");
    } else {
      ctx.font = "500 18px sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText("Connecting…", this.cw - 28, 46);
    }
  }

  private drawActionBtn(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    id: string
  ) {
    const { ctx } = this;
    const hovered = this.hoveredId === id;
    this.roundRect(x, y, w, h, 12);
    ctx.fillStyle = hovered
      ? "rgba(255,255,255,0.25)"
      : "rgba(255,255,255,0.12)";
    ctx.fill();
    ctx.font = "600 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    this.regions.push({ id, x, y, w, h });
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
