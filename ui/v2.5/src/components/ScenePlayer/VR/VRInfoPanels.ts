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
import { VRControlAction, IVRHandyState, VRStrokeStatus } from "./types";

export interface IVRPerformer {
  /** Performer id — enables the drill-down filter from the info panel. */
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface IVRSceneInfo {
  title: string;
  performers: IVRPerformer[];
  /** Tags carry ids so a tap can drill down into the filtered Home wall. */
  tags: { id: string; name: string }[];
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

/** Colour + label for the Handy stroke-zone confirmation chip (idle = none). */
const STROKE_STATUS_VISUAL: Partial<
  Record<VRStrokeStatus, { color: string; label: string }>
> = {
  pending: { color: "rgba(255,193,7,0.95)", label: "Saving…" },
  confirmed: { color: "rgba(76,175,80,0.98)", label: "Range set" },
  error: { color: "rgba(244,67,54,0.96)", label: "Failed" },
};

/**
 * Build a concave cylinder-segment geometry for a curved panel. The surface
 * bends toward the viewer at its edges (centre of curvature at local +z = R), so
 * positioning the panel so its centre sits R metres from the eye makes every
 * point equidistant. UVs span 0..1 across the arc and bottom→top, matching
 * PlaneGeometry — so raycast `uv` and `regionAt()` work identically to a flat
 * panel.
 */
function buildCurvedPanelGeometry(
  wM: number,
  hM: number,
  radius: number
): THREE.BufferGeometry {
  const segsX = 48;
  const thetaMax = wM / 2 / radius; // half horizontal arc angle
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let iy = 0; iy <= 1; iy++) {
    const y = (iy - 0.5) * hM;
    for (let ix = 0; ix <= segsX; ix++) {
      const u = ix / segsX;
      const theta = (u - 0.5) * 2 * thetaMax;
      positions.push(
        radius * Math.sin(theta),
        y,
        radius - radius * Math.cos(theta)
      );
      uvs.push(u, iy);
    }
  }
  const cols = segsX + 1;
  for (let ix = 0; ix < segsX; ix++) {
    const a = ix;
    const b = ix + 1;
    const c = cols + ix;
    const d = cols + ix + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return geo;
}

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
  // LRU eviction cap: image cache per panel. Beyond this, the least-recently-
  // used entry is evicted on each new insert. Keeps memory bounded across long
  // VR sessions that cycle through hundreds of scene cards / performer portraits.
  private static readonly MAX_IMAGES_PER_PANEL = 150;
  // Insertion-order array mirrors the image Map keys for LRU eviction.
  private imageOrder: string[] = [];

  constructor(widthM: number, canvasW: number, canvasH: number, radius = 0) {
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
      radius > 0
        ? buildCurvedPanelGeometry(this.wM, this.hM, radius)
        : new THREE.PlaneGeometry(this.wM, this.hM),
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

  /** id of the currently-hovered hit region (button/strip-item), or null. */
  get hoveredRegionId(): string | null {
    return this.hoveredId;
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

  /**
   * Trigger held and dragged across the panel (UV space). Default no-op; panels
   * with drag-scrollable content (e.g. the Scenes carousel) override this.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pointerMove(_uv: THREE.Vector2): void {}

  /**
   * Trigger released over the panel. Default null; panels that defer selection
   * to release (tap, not drag) override this to return the tapped action.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pointerUp(_uv: THREE.Vector2): VRControlAction | null {
    return null;
  }

  /** Redraw only when something visible changed (cheap when idle). */
  update() {
    if (!this.dirty) return;
    // Clear *before* draw so a panel can re-mark itself dirty during draw()
    // (page-slide animation, or a playing hover-preview) to drive the next frame.
    this.dirty = false;
    this.regions = [];
    this.draw();
    this.texture.needsUpdate = true;
  }

  protected markDirty() {
    this.dirty = true;
  }

  /**
   * Force a first rasterize + GPU texture upload now, ahead of the panel ever
   * becoming visible. Panels are hidden via `mesh.visible=false` until opened,
   * so without this three.js defers the first draw() and the first texImage2D
   * to the frame the menu opens — measured as a multi-hundred-ms hitch on a live
   * XR frame. Called during session pre-warm while the loader hides the cost.
   */
  prewarm(renderer: THREE.WebGLRenderer): void {
    this.dirty = true;
    this.update();
    renderer.initTexture(this.texture);
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
    if (img) {
      // Cache hit — promote to MRU in the eviction list.
      const pos = this.imageOrder.indexOf(url);
      if (pos >= 0 && pos < this.imageOrder.length - 1) {
        this.imageOrder.splice(pos, 1);
        this.imageOrder.push(url);
      }
      return img.complete && img.naturalWidth > 0 ? img : null;
    }
    // Cache miss — evict the LRU entry if at capacity.
    if (this.images.size >= VRCanvasPanel.MAX_IMAGES_PER_PANEL) {
      const lru = this.imageOrder.shift();
      if (lru) {
        const old = this.images.get(lru);
        if (old && old.parentNode) old.remove();
        this.images.delete(lru);
        this.failed.delete(lru);
      }
    }
    img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => this.markDirty();
    img.onerror = () => {
      this.failed.add(url);
      this.markDirty();
    };
    img.src = url;
    this.images.set(url, img);
    this.imageOrder.push(url);
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

    // Base gradient — lighter at top gives the illusion of depth/glass thickness
    this.roundRect(0, 0, this.cw, this.ch, 24);
    const base = ctx.createLinearGradient(0, 0, 0, this.ch);
    base.addColorStop(0, "rgba(26,26,36,0.95)");
    base.addColorStop(0.45, "rgba(14,14,20,0.93)");
    base.addColorStop(1, "rgba(7,7,11,0.91)");
    ctx.fillStyle = base;
    ctx.fill();

    // Inner radial glow from top-centre — simulates light refracting through glass
    this.roundRect(0, 0, this.cw, this.ch, 24);
    const glow = ctx.createRadialGradient(
      this.cw / 2,
      0,
      0,
      this.cw / 2,
      0,
      this.cw * 0.55
    );
    glow.addColorStop(0, "rgba(255,255,255,0.055)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fill();

    // Dim outer border
    this.roundRect(0, 0, this.cw, this.ch, 24);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.stroke();

    // Top-edge rim — the signature glass highlight, simulates a lit upper edge
    ctx.beginPath();
    ctx.moveTo(25, 1);
    ctx.lineTo(this.cw - 25, 1);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.stroke();
  }

  protected sectionLabel(text: string, x: number, y: number) {
    const { ctx } = this;
    ctx.font = "700 20px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.60)";
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
      const hov = this.hoveredId === `browseTab:${tab.id}`;
      this.roundRect(x, PAD, tabW, TAB_H, 12);
      if (isActive) {
        const tg = ctx.createLinearGradient(x, PAD, x, PAD + TAB_H);
        tg.addColorStop(0, "rgba(130,190,255,0.92)");
        tg.addColorStop(1, "rgba(70,130,230,0.80)");
        ctx.fillStyle = tg;
      } else {
        ctx.fillStyle = hov
          ? "rgba(255,255,255,0.16)"
          : "rgba(255,255,255,0.07)";
      }
      ctx.fill();
      // Border
      this.roundRect(x, PAD, tabW, TAB_H, 12);
      ctx.lineWidth = 1;
      ctx.strokeStyle = isActive
        ? "rgba(160,210,255,0.30)"
        : "rgba(255,255,255,0.10)";
      ctx.stroke();
      // Glass rim on active tab
      if (isActive) {
        ctx.beginPath();
        ctx.moveTo(x + 13, PAD + 1);
        ctx.lineTo(x + tabW - 13, PAD + 1);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.stroke();
      }
      ctx.font = "600 24px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isActive ? "#091428" : "rgba(255,255,255,0.9)";
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
  protected drawImageContain(
    img: HTMLImageElement,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    radius: number,
    bg = "rgba(0,0,0,0.18)"
  ) {
    const { ctx } = this;
    ctx.save();
    this.roundRect(dx, dy, dw, dh, radius);
    ctx.clip();
    ctx.fillStyle = bg;
    ctx.fillRect(dx, dy, dw, dh);
    const ir = img.naturalWidth / img.naturalHeight;
    const dr = dw / dh;
    let iw: number, ih: number, ix: number, iy: number;
    if (ir > dr) {
      iw = dw;
      ih = dw / ir;
      ix = dx;
      iy = dy + (dh - ih) / 2;
    } else {
      ih = dh;
      iw = dh * ir;
      ix = dx + (dw - iw) / 2;
      iy = dy;
    }
    ctx.drawImage(img, ix, iy, iw, ih);
    ctx.restore();
  }

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
    // Fired for each visible item with its unclipped position and the strip's
    // clip rect, so callers can register a cheap single-item hover repaint
    // (see VRControlPanel's layered compositing).
    onItem?: (
      i: number,
      x: number,
      w: number,
      clip: { x: number; y: number; w: number; h: number }
    ) => void;
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
            opts.onItem?.(i, x, w, { x: rx, y, w: rw, h });
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
      ? "rgba(255,255,255,0.20)"
      : "rgba(255,255,255,0.09)";
    ctx.fill();
    if (hovered) {
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.32)";
      ctx.stroke();
    }
    ctx.font = "700 34px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = enabled
      ? "rgba(255,255,255,0.95)"
      : "rgba(255,255,255,0.30)";
    ctx.fillText(glyph, cx, cy + 1);
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.images.clear();
    this.imageOrder.length = 0;
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
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
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
      Math.min(260, ctx.measureText(t.name).width + 32)
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
    const cg = ctx.createLinearGradient(x, y, x, y + h);
    cg.addColorStop(0, "rgba(255,255,255,0.14)");
    cg.addColorStop(1, "rgba(255,255,255,0.06)");
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.stroke();
    ctx.font = "500 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(
      this.fitText(this.info.tags[i].name, w - 24),
      x + w / 2,
      y + h / 2 + 1
    );
  }

  private drawMarker(i: number, x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    const m = this.info.markers[i];
    const hovered = this.hoveredId === `mk:${i}`;
    this.roundRect(x, y, w, h, 14);
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
    ctx.strokeStyle = hovered
      ? "rgba(96,165,250,0.40)"
      : "rgba(255,255,255,0.12)";
    ctx.stroke();

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

  constructor(private info: IVRSceneInfo) {
    // Right-side peripheral panel; same dimensions as the Scenes panel for
    // symmetry, and the same height in metres as the main control bar.
    super(1.1, 820, 736);
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
      default:
        break;
    }
    // Drill-down: tapping a performer/tag filters the Home wall by it. The label
    // is passed through so the wall header reads correctly without a rail lookup
    // (performers may be outside the rail; tags aren't in the rail at all).
    if (region.id.startsWith("perf:")) {
      const id = region.id.slice("perf:".length);
      const name = this.info.performers.find((p) => p.id === id)?.name;
      return { type: "setHomeFilter", kind: "performer", id, label: name };
    }
    if (region.id.startsWith("tag:")) {
      const id = region.id.slice("tag:".length);
      const name = this.info.tags.find((t) => t.id === id)?.name;
      return { type: "setHomeFilter", kind: "tag", id, label: name };
    }
    return null;
  }

  protected draw() {
    const { ctx } = this;
    this.panelBackground();

    // ── Title ──────────────────────────────────────────────────────────────
    ctx.font = "700 30px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(
      this.fitText(this.info.title || "Untitled scene", this.cw - 48),
      24,
      52
    );

    // ── Performers ─────────────────────────────────────────────────────────
    // Tall portrait cards with full names overlaid. Chapters are intentionally
    // omitted here — they live on the main control bar's chapter strip.
    this.sectionLabel("Performers", 24, 100);
    const perfY = 116;
    const perfH = 420;
    const cardW = Math.round(perfH * 0.72); // ~302 px, portrait aspect
    const perfWidths = this.info.performers.map(() => cardW);
    if (this.info.performers.length === 0) {
      ctx.font = "500 22px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText("No performers", this.cw / 2, perfY + perfH / 2);
    } else {
      this.hStrip({
        prefix: "perf",
        x0: 20,
        x1: this.cw - 20,
        y: perfY,
        h: perfH,
        scrollX: this.perfScroll,
        widths: perfWidths,
        gap: 16,
        drawItem: (i, x, w) => this.drawPerfCard(i, x, perfY, w, perfH),
        regionId: (i) => ({ id: `perf:${this.info.performers[i].id}` }),
      });
    }

    // ── Tags ───────────────────────────────────────────────────────────────
    this.sectionLabel("Tags", 24, 574);
    const tagY = 590;
    const tagH = 52;
    ctx.font = "500 22px sans-serif";
    const tagWidths = this.info.tags.map((t) =>
      Math.min(260, ctx.measureText(t.name).width + 32)
    );
    if (this.info.tags.length === 0) {
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
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
        widths: tagWidths,
        gap: 12,
        drawItem: (i, x, w) => this.drawTagChip(i, x, tagY, w, tagH),
        regionId: (i) => ({ id: `tag:${this.info.tags[i].id}` }),
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
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.stroke();
  }

  private drawTagChip(i: number, x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    this.roundRect(x, y, w, h, h / 2);
    const cg = ctx.createLinearGradient(x, y, x, y + h);
    cg.addColorStop(0, "rgba(255,255,255,0.14)");
    cg.addColorStop(1, "rgba(255,255,255,0.06)");
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.stroke();
    ctx.font = "500 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(
      this.fitText(this.info.tags[i].name, w - 24),
      x + w / 2,
      y + h / 2 + 1
    );
  }
}

/** VRHandyPanel — compact connection-status panel on the left side in VR. */
export class VRHandyPanel extends VRCanvasPanel {
  private handyState: IVRHandyState = {
    status: "missing",
    label: "",
    configured: false,
    active: false,
  };

  // Stroke-zone envelope, each 0..1. Defaults to the device's full range.
  private strokeMin = 0;
  private strokeMax = 1;
  // Which handle the trigger is currently dragging (null = not dragging).
  private dragging: "min" | "max" | null = null;

  // Assigned funscripts (scene_funscripts) + the currently-active index, for the
  // in-VR script selector. -1 = the server default (no explicit selection).
  private funscripts: { label: string }[] = [];
  private activeFunscript = -1;
  private fsScroll = 0;
  private fsWidths: number[] = [];

  // Confirmation feedback for the last stroke-zone change. `pending` while the
  // request is in flight, `confirmed` (a brief green flash) once the server
  // acks, `error` if it failed. Driven from React via setStrokeStatus().
  private strokeStatus: VRStrokeStatus = "idle";
  private strokeStatusTimer: ReturnType<typeof setTimeout> | null = null;

  // Slider track geometry in canvas pixels (computed from cw in draw()).
  private get trackX() {
    return 40;
  }
  private get trackW() {
    return this.cw - 80;
  }
  private static readonly TRACK_Y = 176;
  private static readonly HANDLE_R = 20;
  /** Minimum gap between the two handles, so they never cross. */
  private static readonly MIN_GAP = 0.05;

  constructor() {
    // Taller than the bare status/slider panel to make room for the funscript
    // selector strip at the bottom. The top edge stays anchored below the main
    // bar (see layoutHandyPanel), so status + slider keep their positions and
    // the extra height extends downward.
    super(0.9, 640, 380);
    this.mesh.name = "vr-handy-panel";
  }

  get hasContent(): boolean {
    return true;
  }

  /**
   * Set the scene's assigned funscripts and which one is active. `active` is an
   * index into `list`, or -1 for the server default. Cheap dirty-check so the
   * per-frame push from React doesn't force a redraw when nothing changed.
   */
  setFunscripts(list: { label: string }[], active: number) {
    const same =
      active === this.activeFunscript &&
      list.length === this.funscripts.length &&
      list.every((f, i) => f.label === this.funscripts[i]?.label);
    if (same) return;
    this.funscripts = list;
    this.activeFunscript = active;
    this.fsScroll = 0;
    this.markDirty();
  }

  setHandyState(st: IVRHandyState) {
    if (
      st.status !== this.handyState.status ||
      st.label !== this.handyState.label ||
      st.configured !== this.handyState.configured ||
      st.active !== this.handyState.active
    ) {
      this.handyState = st;
      this.markDirty();
    }
  }

  /**
   * Update the stroke-zone confirmation indicator. Called from the React layer
   * once the device command resolves (or rejects). A `confirmed` flash clears
   * itself after a beat so it reads as an acknowledgement, not a steady state.
   */
  setStrokeStatus(status: VRStrokeStatus) {
    if (this.strokeStatusTimer) {
      clearTimeout(this.strokeStatusTimer);
      this.strokeStatusTimer = null;
    }
    this.strokeStatus = status;
    if (status === "confirmed") {
      this.strokeStatusTimer = setTimeout(() => {
        this.strokeStatus = "idle";
        this.strokeStatusTimer = null;
        this.markDirty();
      }, 1600);
    }
    this.markDirty();
  }

  dispose() {
    if (this.strokeStatusTimer) {
      clearTimeout(this.strokeStatusTimer);
      this.strokeStatusTimer = null;
    }
    super.dispose();
  }

  protected handleSelect(region: IPanelRegion): VRControlAction | null {
    switch (region.id) {
      case "handyConnect":
        return { type: "handyConnect" };
      case "handyActivate":
        return { type: "handyActivate" };
      case "handySync":
        return { type: "handySync" };
      case "fsScrollL":
        this.fsScroll = this.scrollBy("fs", -1, this.fsScroll);
        this.markDirty();
        return null;
      case "fsScrollR":
        this.fsScroll = this.scrollBy("fs", 1, this.fsScroll);
        this.markDirty();
        return null;
      default:
        if (region.id.startsWith("fs:")) {
          const idx = Number(region.id.slice(3));
          if (Number.isInteger(idx)) return { type: "switchFunscript", index: idx };
        }
        return null;
    }
  }

  // ── Stroke-zone slider drag ───────────────────────────────────────────────
  // Press grabs the nearest handle (or moves it to a tapped point); drag updates
  // the visual live; release dispatches setHandyStroke once so the device isn't
  // flooded with /slider/stroke writes mid-drag.

  activate(uv: THREE.Vector2): VRControlAction | null {
    const region = this.regionAt(uv);
    if (region?.id === "strokeSlider") {
      // A new adjustment supersedes any prior confirmation/error indicator.
      if (this.strokeStatus !== "idle") this.setStrokeStatus("idle");
      const v = this.valueFromUV(uv);
      // Grab whichever handle is nearer the press point, then move it there.
      this.dragging =
        Math.abs(v - this.strokeMin) <= Math.abs(v - this.strokeMax)
          ? "min"
          : "max";
      this.updateDrag(v);
      return null;
    }
    this.dragging = null;
    return region ? this.handleSelect(region) : null;
  }

  pointerMove(uv: THREE.Vector2): void {
    if (!this.dragging) return;
    this.updateDrag(this.valueFromUV(uv));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pointerUp(_uv: THREE.Vector2): VRControlAction | null {
    if (!this.dragging) return null;
    this.dragging = null;
    // Show "saving" immediately on release; React flips this to confirmed/error
    // when /slider/stroke resolves.
    this.setStrokeStatus("pending");
    return {
      type: "setHandyStroke",
      min: Math.round(this.strokeMin * 100) / 100,
      max: Math.round(this.strokeMax * 100) / 100,
    };
  }

  /** Canvas-x of a UV point → 0..1 fraction along the slider track. */
  private valueFromUV(uv: THREE.Vector2): number {
    const x = uv.x * this.cw;
    const frac = (x - this.trackX) / this.trackW;
    return Math.min(1, Math.max(0, frac));
  }

  private updateDrag(v: number) {
    const gap = VRHandyPanel.MIN_GAP;
    if (this.dragging === "min") {
      this.strokeMin = Math.min(v, this.strokeMax - gap);
    } else if (this.dragging === "max") {
      this.strokeMax = Math.max(v, this.strokeMin + gap);
    }
    this.markDirty();
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
    // Muted dot while idle (connected but not armed) so a green "ready" dot
    // doesn't imply the device is actually driving.
    const statusColor = !hs.active
      ? "rgba(255,255,255,0.30)"
      : statusColors[hs.status] ?? "rgba(255,255,255,0.25)";

    // Status row — glass card
    this.roundRect(20, 20, this.cw - 40, 52, 14);
    const srg = ctx.createLinearGradient(20, 20, 20, 72);
    srg.addColorStop(0, "rgba(255,255,255,0.10)");
    srg.addColorStop(1, "rgba(255,255,255,0.04)");
    ctx.fillStyle = srg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.stroke();

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
    } else if (!hs.active) {
      // Idle until the user manually arms the device — nothing drives it yet.
      this.drawActionBtn(
        this.cw - 156,
        20,
        136,
        52,
        "Activate",
        "handyActivate",
        "green"
      );
    } else if (hs.status === "ready") {
      // Armed + connected: Stop (disarm) plus Sync.
      this.drawActionBtn(this.cw - 116, 20, 96, 52, "Stop", "handyActivate", "red");
      this.drawActionBtn(this.cw - 224, 20, 96, 52, "Sync", "handySync");
    } else if (
      hs.status === "disconnected" ||
      hs.status === "error" ||
      hs.status === "missing"
    ) {
      // Armed but not yet connected — offer Connect (and a Stop to back out).
      this.drawActionBtn(this.cw - 116, 20, 96, 52, "Stop", "handyActivate", "red");
      this.drawActionBtn(this.cw - 224, 20, 96, 52, "Connect", "handyConnect");
    } else {
      this.drawActionBtn(this.cw - 116, 20, 96, 52, "Stop", "handyActivate", "red");
      ctx.font = "500 18px sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText("Connecting…", this.cw - 232, 46);
    }

    // Stroke-zone range slider — only meaningful once a device is paired.
    if (hs.configured) this.drawStrokeSlider();

    // Funscript selector strip along the bottom.
    this.drawFunscriptStrip();
  }

  /**
   * Bottom-anchored selector for the scene's assigned funscripts. The active
   * script is highlighted; tapping another emits `switchFunscript`, which the
   * React layer applies at runtime (re-upload + heatmap regen). Hidden entirely
   * when the scene has no assigned scripts.
   */
  private drawFunscriptStrip() {
    const { ctx } = this;
    const labelY = 268;
    this.sectionLabel("Scripts", 20, labelY);

    if (this.funscripts.length === 0) {
      ctx.font = "500 22px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText("No alternate scripts", 20, labelY + 44);
      return;
    }

    const stripY = labelY + 16;
    const stripH = 60;
    ctx.font = "600 22px sans-serif";
    this.fsWidths = this.funscripts.map((f) =>
      Math.min(300, Math.max(120, ctx.measureText(f.label).width + 40))
    );
    this.hStrip({
      prefix: "fs",
      x0: 20,
      x1: this.cw - 20,
      y: stripY,
      h: stripH,
      scrollX: this.fsScroll,
      widths: this.fsWidths,
      gap: 12,
      drawItem: (i, x, w) => this.drawFsChip(i, x, stripY, w, stripH),
      regionId: (i) => ({ id: `fs:${i}` }),
    });
  }

  private drawFsChip(i: number, x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    const active = i === this.activeFunscript;
    const hovered = this.hoveredId === `fs:${i}`;
    this.roundRect(x, y, w, h, 14);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    if (active) {
      g.addColorStop(0, "rgba(96,165,250,0.42)");
      g.addColorStop(1, "rgba(96,165,250,0.22)");
    } else if (hovered) {
      g.addColorStop(0, "rgba(96,165,250,0.22)");
      g.addColorStop(1, "rgba(96,165,250,0.10)");
    } else {
      g.addColorStop(0, "rgba(255,255,255,0.12)");
      g.addColorStop(1, "rgba(255,255,255,0.05)");
    }
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = active ? 2 : 1;
    ctx.strokeStyle = active
      ? "rgba(96,165,250,0.85)"
      : hovered
      ? "rgba(96,165,250,0.40)"
      : "rgba(255,255,255,0.14)";
    ctx.stroke();
    ctx.font = "600 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = active ? "rgba(255,255,255,0.98)" : "rgba(255,255,255,0.85)";
    ctx.fillText(
      this.fitText(this.funscripts[i].label, w - 28),
      x + w / 2,
      y + h / 2 + 1
    );
  }

  /** Draw the dual-handle stroke-zone slider (min..max envelope, 0..100%). */
  private drawStrokeSlider() {
    const { ctx } = this;
    const tx = this.trackX;
    const tw = this.trackW;
    const ty = VRHandyPanel.TRACK_Y;
    const r = VRHandyPanel.HANDLE_R;
    const minX = tx + this.strokeMin * tw;
    const maxX = tx + this.strokeMax * tw;

    // Header: label + numeric readout. The readout tints to match the
    // confirmation state so feedback is legible even from across the room.
    const sv = STROKE_STATUS_VISUAL[this.strokeStatus];
    ctx.font = "600 22px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("Stroke Zone", tx, ty - 46);
    const readout = `${Math.round(this.strokeMin * 100)}% – ${Math.round(
      this.strokeMax * 100
    )}%`;
    ctx.font = "600 22px sans-serif";
    ctx.textAlign = "right";
    ctx.fillStyle = sv ? sv.color : ACCENT;
    ctx.fillText(readout, tx + tw, ty - 46);

    // Status chip (Saving… / Range set / Failed) sits just left of the readout.
    if (sv) {
      const readoutW = ctx.measureText(readout).width;
      this.drawStrokeStatusChip(tx + tw - readoutW - 16, ty - 46, sv);
    }

    // Track (inactive)
    ctx.lineCap = "round";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + tw, ty);
    ctx.stroke();

    // Active span between the two handles
    ctx.strokeStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(minX, ty);
    ctx.lineTo(maxX, ty);
    ctx.stroke();
    ctx.lineCap = "butt";

    // Handles
    this.drawHandle(minX, ty, r, this.dragging === "min");
    this.drawHandle(maxX, ty, r, this.dragging === "max");

    // One wide hit region spanning the whole track (with vertical padding so
    // the thin track is easy to grab); drag tracking takes over from there.
    this.regions.push({
      id: "strokeSlider",
      x: tx - r,
      y: ty - r - 14,
      w: tw + r * 2,
      h: r * 2 + 28,
    });
  }

  /** Pill chip — coloured dot + word — right-aligned so it ends at `rightX`. */
  private drawStrokeStatusChip(
    rightX: number,
    cy: number,
    sv: { color: string; label: string }
  ) {
    const { ctx } = this;
    ctx.font = "600 18px sans-serif";
    const wordW = ctx.measureText(sv.label).width;
    const padX = 12;
    const dotR = 6;
    const gap = 8;
    const chipW = padX + dotR * 2 + gap + wordW + padX;
    const chipH = 30;
    const x = rightX - chipW;
    const y = cy - chipH / 2;

    this.roundRect(x, y, chipW, chipH, chipH / 2);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = sv.color;
    ctx.stroke();

    const dotX = x + padX + dotR;
    ctx.beginPath();
    ctx.arc(dotX, cy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = sv.color;
    ctx.fill();

    ctx.font = "600 18px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(sv.label, dotX + dotR + gap, cy + 1);
  }

  private drawHandle(cx: number, cy: number, r: number, active: boolean) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(cx, cy - r * 0.4, 2, cx, cy, r);
    g.addColorStop(0, "rgba(255,255,255,0.98)");
    g.addColorStop(
      1,
      active ? "rgba(191,219,254,0.95)" : "rgba(226,232,240,0.9)"
    );
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = active ? ACCENT : "rgba(96,165,250,0.5)";
    ctx.stroke();
  }

  private drawActionBtn(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    id: string,
    accent?: "green" | "red"
  ) {
    const { ctx } = this;
    const hovered = this.hoveredId === id;
    this.roundRect(x, y, w, h, 12);
    const bg = ctx.createLinearGradient(x, y, x, y + h);
    if (accent === "green") {
      bg.addColorStop(0, hovered ? "rgba(76,175,80,0.55)" : "rgba(76,175,80,0.34)");
      bg.addColorStop(1, hovered ? "rgba(76,175,80,0.34)" : "rgba(76,175,80,0.18)");
    } else if (accent === "red") {
      bg.addColorStop(0, hovered ? "rgba(244,67,54,0.55)" : "rgba(244,67,54,0.34)");
      bg.addColorStop(1, hovered ? "rgba(244,67,54,0.34)" : "rgba(244,67,54,0.18)");
    } else if (hovered) {
      bg.addColorStop(0, "rgba(255,255,255,0.24)");
      bg.addColorStop(1, "rgba(255,255,255,0.12)");
    } else {
      bg.addColorStop(0, "rgba(255,255,255,0.14)");
      bg.addColorStop(1, "rgba(255,255,255,0.06)");
    }
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = hovered
      ? "rgba(255,255,255,0.32)"
      : "rgba(255,255,255,0.16)";
    ctx.stroke();
    // Glass rim
    ctx.beginPath();
    ctx.moveTo(x + 13, y + 1);
    ctx.lineTo(x + w - 13, y + 1);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.stroke();
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
