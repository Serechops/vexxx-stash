/**
 * VRGalleryViewerPanel — the in-headset "XR gallery page" shown when a gallery
 * is opened from the Home wall's Galleries mode. It has two sub-views:
 *
 *  • **grid** — a server-paged justified-row thumbnail grid (Google Photos
 *    style) within a scrollable clip region, with the same press-and-release
 *    tap model + horizontal drag-pagination as the Home scene grid;
 *  • **lightbox** — tapping a thumbnail opens the full-size image on a large
 *    plane with ‹ prev / next › and a back-to-grid control. Prev/next walk the
 *    absolute image index across page boundaries (pulling pages on demand).
 *
 * The panel is self-contained: the manager injects a page requester and feeds
 * pages back via [setPageData]; the lightbox is driven entirely in-panel. A
 * "Back" control emits `closeGallery` so the manager can restore the Home wall.
 */
import * as THREE from "three";
import { VRControlAction, IVRGalleryImageEntry } from "./types";
import { VRCanvasPanel, IPanelRegion } from "./VRInfoPanels";

// Match the Home wall so the viewer occupies the same curved surface.
const CANVAS_W = 2200;
const CANVAS_H = 1300;
const PANEL_WIDTH_M = 3.4;
const PANEL_RADIUS = 2.65;

const PAD = 40;
const HEADER_Y = 58; // title baseline

// ── Thumbnail grid (justified row layout, like Google Photos) ───────────
const GRID_X0 = PAD;
const GRID_RIGHT = CANVAS_W - PAD;
const GRID_W = GRID_RIGHT - GRID_X0; // 2120
const PER_PAGE = 15; // must match IMAGE_PER_PAGE in VRGalleryLibrary
const ROW_TARGET_H = 220; // target row height before justification
const GAP = 12;
const GRID_Y0 = 132;
const GRID_Y1 = CANVAS_H - 90;
const PAGER_Y = CANVAS_H - 42;
const PAGER_H = 44;
const DEF_ASPECT = 16 / 9; // fallback for unloaded images

// ── Lightbox ────────────────────────────────────────────────────────────────
const LB_MARGIN_X = 130; // side gutters double as prev/next hit zones
const LB_Y0 = 120;
const LB_Y1 = CANVAS_H - 70;

// ── Slideshow ──────────────────────────────────────────────────────────────
const SLIDESHOW_INTERVAL_MS = 4000; // ms between auto-advance
const BTN_H = 44; // shared button height for Back + Slideshow pills
// ── Interaction (mirrors VRHomePanel's grid tuning) ──────────────────────────
const GRID_DRAG_THRESHOLD = 24;
const SETTLE_MS = 90;
const ANIM_MS = 300;
const COMMIT_FRACTION = 0.28;

const ACCENT = "rgba(96,165,250,";

export class VRGalleryViewerPanel extends VRCanvasPanel {
  private title = "";
  private totalCount = 0;
  private loaded = false;

  private pageCache = new Map<number, IVRGalleryImageEntry[]>();
  private requestedPages = new Set<number>();
  private pageRequester: ((pageIndex: number) => void) | null = null;

  // Grid page-slide (0 = settled, +1 = next animating, −1 = prev).
  private page = 0;
  private offset = 0;
  private animFrom = 0;
  private animTo = 0;
  private animStart = 0;

  // Lightbox: absolute image index, or null when showing the grid.
  private lightboxIndex: number | null = null;

  // Slideshow auto-advance mode (lightbox only).
  private slideshowOn = false;
  private slideshowTimer: ReturnType<typeof setTimeout> | null = null;
  /** User must explicitly toggle slideshow — don't resume it after lightbox close. */
  private slideshowEdgeTriggered = false;

  // Press / drag-vs-tap resolution (grid only).
  private downId: string | null = null;
  private pressActive = false;
  private dragging = false;
  private pressX = 0;
  private pressTime = 0;
  private gridOffsetBase = 0;

  constructor() {
    super(PANEL_WIDTH_M, CANVAS_W, CANVAS_H, PANEL_RADIUS);
    this.mesh.name = "vr-gallery-viewer-panel";
  }

  get hasContent(): boolean {
    return this.totalCount > 0;
  }

  /** True while the full-size lightbox is showing (manager routes input/back). */
  get lightboxOpen(): boolean {
    return this.lightboxIndex !== null;
  }

  setPageRequester(cb: (pageIndex: number) => void) {
    this.pageRequester = cb;
  }

  /** Open the viewer on a fresh gallery: reset to the grid, page 0. */
  open(title: string, imageCount: number) {
    this.title = title;
    this.totalCount = imageCount;
    this.loaded = false;
    this.pageCache.clear();
    this.requestedPages.clear();
    this.page = 0;
    this.offset = 0;
    this.animStart = 0;
    this.lightboxIndex = null;
    this.stopSlideshow();
    this.slideshowOn = false;
    this.markDirty();
  }

  /** Receive a fetched image page from the manager's pager. */
  setPageData(
    pageIndex: number,
    images: IVRGalleryImageEntry[],
    totalCount: number
  ) {
    this.pageCache.set(pageIndex, images);
    this.requestedPages.delete(pageIndex);
    this.totalCount = totalCount;
    this.loaded = true;
    this.markDirty();
  }

  private get pageCount(): number {
    return Math.max(1, Math.ceil(this.totalCount / PER_PAGE));
  }

  /** Image entry at an absolute index, or null if its page isn't cached yet. */
  private entryAt(index: number): IVRGalleryImageEntry | null {
    const pg = this.pageCache.get(Math.floor(index / PER_PAGE));
    if (!pg) return null;
    return pg[index % PER_PAGE] ?? null;
  }

  /** Request the pages needed for the current view (grid neighbours or lightbox). */
  private ensurePagesLoaded() {
    if (!this.pageRequester) return;
    const last = this.pageCount - 1;
    const want = new Set<number>();
    if (this.lightboxIndex !== null) {
      const p = Math.floor(this.lightboxIndex / PER_PAGE);
      want.add(p);
      want.add(p - 1);
      want.add(p + 1);
    } else {
      want.add(this.page);
      want.add(this.page - 1);
      want.add(this.page + 1);
    }
    for (const pg of want) {
      if (pg < 0 || pg > last) continue;
      if (this.pageCache.has(pg) || this.requestedPages.has(pg)) continue;
      this.requestedPages.add(pg);
      this.pageRequester(pg);
    }
  }

  // ── Lightbox control (called in-panel and by the manager) ──────────────────

  openLightbox(index: number) {
    if (index < 0 || index >= this.totalCount) return;
    this.lightboxIndex = index;
    this.stopSlideshow();
    this.markDirty();
  }

  closeLightbox() {
    if (this.lightboxIndex === null) return;
    this.stopSlideshow();
    this.slideshowOn = false;
    // Keep the grid page roughly aligned with the image we were viewing.
    this.page = Math.min(
      this.pageCount - 1,
      Math.floor(this.lightboxIndex / PER_PAGE)
    );
    this.offset = 0;
    this.animStart = 0;
    this.lightboxIndex = null;
    this.markDirty();
  }

  lightboxNav(dir: 1 | -1) {
    if (this.lightboxIndex === null) return;
    const next = this.lightboxIndex + dir;
    if (next < 0 || next >= this.totalCount) return;
    this.lightboxIndex = next;
    this.stopSlideshow(); // user navigation stops slideshow
    this.markDirty();
  }

  // ── Slideshow auto-advance ────────────────────────────────────────────────

  private scheduleSlideshow() {
    this.stopSlideshow();
    if (!this.slideshowOn || this.lightboxIndex === null) return;
    // Wrap around when reaching the last image.
    if (this.lightboxIndex >= this.totalCount - 1) {
      this.lightboxIndex = 0;
    } else {
      this.lightboxIndex++;
    }
    this.markDirty();
    this.slideshowTimer = setTimeout(
      () => this.scheduleSlideshow(),
      SLIDESHOW_INTERVAL_MS
    );
  }

  private stopSlideshow() {
    if (this.slideshowTimer !== null) {
      clearTimeout(this.slideshowTimer);
      this.slideshowTimer = null;
    }
  }

  private toggleSlideshow() {
    this.slideshowOn = !this.slideshowOn;
    if (this.slideshowOn) {
      // Kick off the first interval immediately.
      this.slideshowTimer = setTimeout(
        () => this.scheduleSlideshow(),
        SLIDESHOW_INTERVAL_MS
      );
    } else {
      this.stopSlideshow();
    }
    this.markDirty();
  }

  // ── Thumbstick nav (routed from the manager, which edge-triggers) ───────────

  nudgePage(dir: 1 | -1) {
    if (this.lightboxIndex !== null) this.lightboxNav(dir);
    else this.startArrow(dir);
  }

  // Vertical stick is unused in the viewer (no rail), kept for manager symmetry.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  nudgeRail(_dir: 1 | -1) {}

  // ── Drag / tap / pagination (grid sub-view) ────────────────────────────────

  activate(uv: THREE.Vector2): VRControlAction | null {
    // Lightbox: direct tap on discrete controls (prev/next/back/close).
    // No press-drag mechanics needed — just resolve the region and fire.
    if (this.lightboxIndex !== null) {
      const region = this.regionAt(uv);
      if (!region) return null;
      return this.handleSelect(region);
    }
    this.downId = this.regionAt(uv)?.id ?? null;
    this.pressX = uv.x * this.cw;
    this.gridOffsetBase = this.offset;
    this.pressActive = true;
    this.dragging = false;
    this.pressTime = performance.now();
    this.animStart = 0;
    return null;
  }

  pointerMove(uv: THREE.Vector2): void {
    if (!this.pressActive || this.lightboxIndex !== null) return;
    if (!this.dragging && performance.now() - this.pressTime < SETTLE_MS) {
      this.pressX = uv.x * this.cw;
      this.gridOffsetBase = this.offset;
      return;
    }
    const dx = uv.x * this.cw - this.pressX;
    if (Math.abs(dx) > GRID_DRAG_THRESHOLD) this.dragging = true;
    if (!this.dragging) return;
    const lo = this.page > 0 ? -1 : 0;
    const hi = this.page < this.pageCount - 1 ? 1 : 0;
    const o = Math.min(hi, Math.max(lo, this.gridOffsetBase - dx / GRID_W));
    if (o !== this.offset) {
      this.offset = o;
      this.markDirty();
    }
  }

  pointerUp(uv: THREE.Vector2): VRControlAction | null {
    const wasTap = !this.dragging && this.pressActive;
    const { downId } = this;
    this.pressActive = false;
    this.dragging = false;
    this.downId = null;
    if (this.lightboxIndex !== null) return null;
    if (wasTap) {
      const region = this.regionAt(uv);
      if (region && region.id === downId) return this.handleSelect(region);
      return null;
    }
    this.snap();
    return null;
  }

  private snap() {
    let to = 0;
    if (this.offset > COMMIT_FRACTION && this.page < this.pageCount - 1) to = 1;
    else if (this.offset < -COMMIT_FRACTION && this.page > 0) to = -1;
    this.animFrom = this.offset;
    this.animTo = to;
    this.animStart = performance.now();
    this.markDirty();
  }

  private startArrow(dir: 1 | -1) {
    if (this.animStart) return;
    if (dir === 1 && this.page >= this.pageCount - 1) return;
    if (dir === -1 && this.page <= 0) return;
    this.animFrom = 0;
    this.animTo = dir;
    this.animStart = performance.now();
    this.markDirty();
  }

  protected handleSelect(region: IPanelRegion): VRControlAction | null {
    const { id } = region;
    if (id === "back") {
      // From the lightbox, Back returns to the grid; from the grid, it closes
      // the gallery and restores the Home wall.
      if (this.lightboxIndex !== null) {
        this.closeLightbox();
        return null;
      }
      return { type: "closeGallery" };
    }
    if (id === "lbClose") {
      this.closeLightbox();
      return { type: "galleryImageClose" };
    }
    if (id === "lbPrev") {
      this.lightboxNav(-1);
      return { type: "galleryImageNav", dir: -1 };
    }
    if (id === "lbNext") {
      this.lightboxNav(1);
      return { type: "galleryImageNav", dir: 1 };
    }
    if (id === "lbSlideshow") {
      this.toggleSlideshow();
      return { type: "galleryImageSlideshowToggle" };
    }
    if (id === "pageL") {
      this.startArrow(-1);
      return null;
    }
    if (id === "pageR") {
      this.startArrow(1);
      return null;
    }
    if (id.startsWith("img:")) {
      const index = parseInt(id.slice("img:".length), 10);
      if (!Number.isNaN(index)) {
        this.openLightbox(index);
        return { type: "galleryImageOpen", index };
      }
    }
    return null;
  }

  // ── Update / draw ───────────────────────────────────────────────────────────

  update() {
    this.ensurePagesLoaded();
    super.update();
  }

  protected draw() {
    this.tickAnimation();
    this.panelBackground();
    this.drawBackButton();
    if (this.lightboxIndex !== null) {
      this.drawLightbox();
    } else {
      this.drawHeader();
      this.drawGrid();
    }
  }

  private tickAnimation() {
    if (!this.animStart) return;
    const t = Math.min(1, (performance.now() - this.animStart) / ANIM_MS);
    const e = 1 - Math.pow(1 - t, 3);
    this.offset = this.animFrom + (this.animTo - this.animFrom) * e;
    if (t >= 1) {
      if (this.animTo === 1)
        this.page = Math.min(this.pageCount - 1, this.page + 1);
      else if (this.animTo === -1) this.page = Math.max(0, this.page - 1);
      this.offset = 0;
      this.animStart = 0;
    } else {
      this.markDirty();
    }
  }

  private drawBackButton() {
    const { ctx } = this;
    const h = BTN_H;
    const y = 26;
    const btnGap = 8;

    // ── Back button ──────────────────────────────────────────────────────
    const bw = 210;
    const bx = PAD;
    const backHover = this.hoveredId === "back";
    this.roundRect(bx, y, bw, h, h / 2);
    ctx.fillStyle = backHover ? `${ACCENT}0.92)` : `${ACCENT}0.18)`;
    ctx.fill();
    this.roundRect(bx, y, bw, h, h / 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = backHover ? `${ACCENT}0.7)` : `${ACCENT}0.5)`;
    ctx.stroke();
    ctx.font = "600 19px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = backHover ? "#06121f" : `${ACCENT}0.95)`;
    const backLabel =
      this.lightboxIndex !== null ? "‹  Back to grid" : "‹  All galleries";
    ctx.fillText(backLabel, bx + bw / 2, y + h / 2 + 1);
    this.regions.push({ id: "back", x: bx, y, w: bw, h });

    // ── Slideshow toggle (lightbox only) ──────────────────────────────────
    if (this.lightboxIndex !== null) {
      const sw = 190;
      const sx = bx + bw + btnGap;
      const ssHover = this.hoveredId === "lbSlideshow";
      const ssLabel = this.slideshowOn ? "⏹  Stop slideshow" : "▶  Slideshow";

      this.roundRect(sx, y, sw, h, h / 2);
      ctx.fillStyle = ssHover
        ? this.slideshowOn
          ? "rgba(239,68,68,0.85)"
          : `${ACCENT}0.92)`
        : this.slideshowOn
        ? "rgba(239,68,68,0.50)"
        : `${ACCENT}0.18)`;
      ctx.fill();
      this.roundRect(sx, y, sw, h, h / 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ssHover
        ? this.slideshowOn
          ? "rgba(239,68,68,0.7)"
          : `${ACCENT}0.7)`
        : this.slideshowOn
        ? "rgba(239,68,68,0.35)"
        : `${ACCENT}0.5)`;
      ctx.stroke();
      ctx.font = "600 19px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = ssHover && this.slideshowOn
        ? "rgba(255,255,255,0.98)"
        : ssHover
        ? "#06121f"
        : this.slideshowOn
        ? "rgba(255,255,255,0.98)"
        : `${ACCENT}0.95)`;
      ctx.fillText(ssLabel, sx + sw / 2, y + h / 2 + 1);
      this.regions.push({ id: "lbSlideshow", x: sx, y, w: sw, h });
    }
  }

  private drawHeader() {
    const { ctx } = this;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 34px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.fillText(this.fitText(this.title || "Gallery", CANVAS_W - 600), this.cw / 2, HEADER_Y);

    const n = this.totalCount;
    const sub = n === 1 ? "1 image" : `${n} images`;
    ctx.font = "500 19px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(sub, this.cw / 2, HEADER_Y + 42);
  }

  private drawGrid() {
    const { ctx } = this;
    if (this.loaded && this.totalCount === 0) {
      ctx.font = "500 26px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText("This gallery has no images", this.cw / 2, (GRID_Y0 + GRID_Y1) / 2);
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(GRID_X0, GRID_Y0, GRID_W, GRID_Y1 - GRID_Y0);
    ctx.clip();
    const settled = this.offset === 0 && this.animStart === 0;
    this.drawPageThumbs(this.page, -this.offset * GRID_W, settled);
    if (this.offset > 0.0005 && this.page < this.pageCount - 1) {
      this.drawPageThumbs(this.page + 1, (1 - this.offset) * GRID_W, false);
    } else if (this.offset < -0.0005 && this.page > 0) {
      this.drawPageThumbs(this.page - 1, (-1 - this.offset) * GRID_W, false);
    }
    ctx.restore();

    this.drawPager();
  }

  private drawPageThumbs(
    pageIndex: number,
    xShift: number,
    interactive: boolean
  ) {
    const items = this.pageCache.get(pageIndex);
    const slots = Math.min(
      PER_PAGE,
      Math.max(0, this.totalCount - pageIndex * PER_PAGE)
    );
    const n = items ? items.length : this.loaded ? slots : PER_PAGE;

    // Gather entries with estimated aspect ratios for row-packing.
    const entries: Array<{
      entry: IVRGalleryImageEntry | undefined;
      absIndex: number;
      aspect: number;
    }> = [];
    for (let i = 0; i < n; i++) {
      const entry = items?.[i];
      let aspect = DEF_ASPECT;
      if (entry) {
        const img = this.image(entry.thumbnailUrl);
        if (img && img.naturalWidth > 0) {
          aspect = Math.max(img.naturalWidth / img.naturalHeight, 0.25);
        }
      }
      entries.push({
        entry,
        absIndex: pageIndex * PER_PAGE + i,
        aspect,
      });
    }

    // Greedy row-packing: add images to a row until adding another would
    // overflow GRID_W; then scale the whole row to justify it.
    let y = GRID_Y0;
    for (let i = 0; i < entries.length; ) {
      let totalAspect = entries[i].aspect;
      let rowEnd = i + 1;
      while (rowEnd < entries.length) {
        const testAspect = totalAspect + entries[rowEnd].aspect;
        const testW = testAspect * ROW_TARGET_H + GAP * (rowEnd - i);
        if (rowEnd - i === 1 || testW <= GRID_W) {
          totalAspect = testAspect;
          rowEnd++;
        } else {
          break;
        }
      }

      const availW = GRID_W - GAP * (rowEnd - i - 1);
      const rowH = Math.max(60, Math.min(400, availW / totalAspect));

      let ix = GRID_X0 + xShift;
      for (let j = i; j < rowEnd; j++) {
        const item = entries[j];
        const iw = item.aspect * rowH;
        if (item.entry) {
          this.drawThumb(item.entry, item.absIndex, ix, y, iw, rowH, interactive);
        } else {
          this.drawSkeleton(ix, y, iw, rowH);
        }
        ix += iw + GAP;
      }

      y += rowH + GAP;
      i = rowEnd;
    }
  }

  private drawThumb(
    image: IVRGalleryImageEntry,
    absIndex: number,
    x: number,
    y: number,
    w: number,
    h: number,
    interactive: boolean
  ) {
    const { ctx } = this;
    const hovered = interactive && this.hoveredId === `img:${absIndex}`;
    const R = 8;
    const img = this.image(image.thumbnailUrl);
    if (img) {
      this.drawImageContain(img, x, y, w, h, R, "rgba(0,0,0,0.30)");
    } else {
      this.roundRect(x, y, w, h, R);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fill();
    }
    if (hovered) {
      this.roundRect(x, y, w, h, R);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `${ACCENT}0.80)`;
      ctx.stroke();
    }
    if (interactive) {
      this.regions.push({ id: `img:${absIndex}`, x, y, w, h });
    }
  }

  private drawSkeleton(x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    this.roundRect(x, y, w, h, 8);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();
  }

  private drawPager() {
    const { ctx } = this;
    const pages = this.pageCount;
    if (pages <= 1) return;
    const cy = PAGER_Y;
    const label = `Page ${this.page + 1} / ${pages}`;
    ctx.font = "600 20px sans-serif";
    const labelW = ctx.measureText(label).width;
    const arrowW = 48;
    const gap = 24;
    const total = arrowW + gap + labelW + gap + arrowW;
    let x = GRID_X0 + (GRID_W - total) / 2;

    const drawArrow = (id: "pageL" | "pageR", enabled: boolean) => {
      const hovered = this.hoveredId === id;
      this.roundRect(x, cy - PAGER_H / 2, arrowW, PAGER_H, PAGER_H / 2);
      ctx.fillStyle = !enabled
        ? "rgba(255,255,255,0.04)"
        : hovered
        ? "rgba(255,255,255,0.18)"
        : "rgba(255,255,255,0.09)";
      ctx.fill();
      ctx.fillStyle = enabled
        ? "rgba(255,255,255,0.9)"
        : "rgba(255,255,255,0.25)";
      ctx.font = "600 24px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(id === "pageL" ? "‹" : "›", x + arrowW / 2, cy + 1);
      if (enabled) {
        this.regions.push({ id, x, y: cy - PAGER_H / 2, w: arrowW, h: PAGER_H });
      }
    };

    drawArrow("pageL", this.page > 0);
    x += arrowW + gap;
    ctx.font = "600 20px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + labelW / 2, cy + 1);
    x += labelW + gap;
    drawArrow("pageR", this.page < pages - 1);
  }

  // ── Lightbox sub-view ────────────────────────────────────────────────────────

  private drawLightbox() {
    const { ctx } = this;
    const index = this.lightboxIndex!;
    const entry = this.entryAt(index);

    const imgX = LB_MARGIN_X;
    const imgY = LB_Y0;
    const imgW = CANVAS_W - LB_MARGIN_X * 2;
    const imgH = LB_Y1 - LB_Y0;

    // Prefer the full-size image; fall back to the thumbnail while it loads.
    const full = entry ? this.image(entry.imageUrl) : null;
    const thumb = entry ? this.image(entry.thumbnailUrl) : null;
    const draw = full ?? thumb;
    if (draw) {
      this.drawImageContain(draw, imgX, imgY, imgW, imgH, 16, "rgba(0,0,0,0.55)");
    } else {
      this.roundRect(imgX, imgY, imgW, imgH, 16);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fill();
      ctx.font = "500 24px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText("Loading…", this.cw / 2, this.ch / 2);
    }

    // Prev / next gutters (whole side strips are tappable) + chevrons.
    const hasPrev = index > 0;
    const hasNext = index < this.totalCount - 1;
    this.drawNavGutter("lbPrev", 0, hasPrev);
    this.drawNavGutter("lbNext", CANVAS_W - LB_MARGIN_X, hasNext);

    // Close-to-grid button (top-right; "Back" top-left already returns to grid).
    const cw2 = 150;
    const ch2 = 44;
    const cx = CANVAS_W - PAD - cw2;
    const cyy = 26;
    const closeHover = this.hoveredId === "lbClose";
    this.roundRect(cx, cyy, cw2, ch2, ch2 / 2);
    ctx.fillStyle = closeHover ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)";
    ctx.fill();
    ctx.font = "600 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText("⊞  Grid", cx + cw2 / 2, cyy + ch2 / 2 + 1);
    this.regions.push({ id: "lbClose", x: cx, y: cyy, w: cw2, h: ch2 });

    // Counter
    ctx.font = "600 20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(`${index + 1} / ${this.totalCount}`, this.cw / 2, CANVAS_H - 38);
  }

  private drawNavGutter(id: "lbPrev" | "lbNext", x: number, enabled: boolean) {
    const { ctx } = this;
    const w = LB_MARGIN_X;
    const y = LB_Y0;
    const h = LB_Y1 - LB_Y0;
    if (enabled) {
      const hovered = this.hoveredId === id;
      ctx.save();
      ctx.globalAlpha = hovered ? 0.9 : 0.55;
      ctx.font = "300 64px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(id === "lbPrev" ? "‹" : "›", x + w / 2, y + h / 2);
      ctx.restore();
      this.regions.push({ id, x, y, w, h });
    }
  }
}
