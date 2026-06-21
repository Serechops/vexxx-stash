/**
 * VRHomePanel — the immersive "Home" wall shown when the headset enters VR
 * with no scene loaded (lobby mode). A single large curved surface that merges:
 *
 *  • left **filter rail** — media-type toggle (All / VR / 2D), Studios /
 *    Performers tab, "All scenes" reset, and a 2-column portrait/logo tile grid;
 *  • right **scene grid** — 4 × 3 paginated cards with hover preview, funscript
 *    heatmap strips, and animated horizontal drag-pagination.
 *
 * Interaction: press+release-on-same-region tap model to avoid jitter; rail
 * drag-scrolls vertically; grid drag-paginates horizontally (disambiguated by
 * which column the press started in). All filter/media actions are emitted and
 * handled by the session manager without a React round-trip.
 */
import * as THREE from "three";
import { VRControlAction } from "./types";
import { VRCanvasPanel, IPanelRegion } from "./VRInfoPanels";
import { IVRSceneEntry } from "./VRScenesPanel";

export interface IVRFilterEntry {
  id: string;
  name: string;
  imageUrl: string | null;
  count: number;
}

// ── Canvas / panel dimensions ─────────────────────────────────────────────────
const CANVAS_W = 2200;
const CANVAS_H = 1300; // taller for the extra scene row
const PANEL_WIDTH_M = 3.4;
const PANEL_RADIUS = 2.65;

// ── Shared layout ─────────────────────────────────────────────────────────────
const PAD = 40;
const TITLE_Y = 58;
const SUB_Y = 92;
const CONTENT_Y0 = 132; // top of all content rows

// ── Filter rail (left 540 px) ─────────────────────────────────────────────────
const RAIL_W = 540;
const RAIL_PAD = 28;
const RAIL_INNER = RAIL_W - RAIL_PAD * 2; // 484

// Media-type toggle row ( [All] [VR] [2D] )
const MEDIA_H = 46;
const MEDIA_BTN_COUNT = 3;
const MEDIA_BTN_GAP = 8;
const MEDIA_BTN_W = Math.floor(
  (RAIL_INNER - MEDIA_BTN_GAP * (MEDIA_BTN_COUNT - 1)) / MEDIA_BTN_COUNT
); // 156

// Studios / Performers tabs
const TAB_Y = CONTENT_Y0 + MEDIA_H + 10; // 188
const TAB_H = 50;

// "All scenes" reset chip
const ALL_Y = TAB_Y + TAB_H + 10; // 248
const ALL_H = 38;

// Scrollable filter tile grid
const RAIL_VIEW_Y0 = ALL_Y + ALL_H + 12; // 298
const RAIL_VIEW_Y1 = CANVAS_H - 68; // 1232

// 2-column tile grid within the rail
const TILE_COLS = 2;
const TILE_GAP_X = 12;
const TILE_GAP_Y = 12;
const TILE_W = Math.floor(
  (RAIL_INNER - TILE_GAP_X * (TILE_COLS - 1)) / TILE_COLS
); // 236

const STUDIO_IMG_H = Math.round((TILE_W * 9) / 16); // 133 — landscape logo
const STUDIO_LABEL_H = 28;
const STUDIO_TILE_H = STUDIO_IMG_H + STUDIO_LABEL_H; // 161
const STUDIO_ROW_H = STUDIO_TILE_H + TILE_GAP_Y; // 173

const PERF_IMG_H = Math.round((TILE_W * 3) / 2); // 354 — tall portrait
const PERF_LABEL_H = 28;
const PERF_TILE_H = PERF_IMG_H + PERF_LABEL_H; // 382
const PERF_ROW_H = PERF_TILE_H + TILE_GAP_Y; // 394

// ── Scene grid (right side) ───────────────────────────────────────────────────
const GRID_X0 = RAIL_W + 28;
const GRID_RIGHT = CANVAS_W - PAD;
const GRID_W = GRID_RIGHT - GRID_X0; // 1592
const COLS = 4;
const ROWS = 3;
const PER_PAGE = COLS * ROWS;
const GAP_X = 24;
const GAP_Y = 20;
const CARD_W = Math.floor((GRID_W - GAP_X * (COLS - 1)) / COLS); // 380
const THUMB_H = Math.round((CARD_W * 9) / 16); // 214
const CAP_H = 78;
const CARD_H = THUMB_H + CAP_H; // 292
const GRID_Y0 = CONTENT_Y0;
const GRID_Y1 = CANVAS_H - 90; // 1210
const GRID_BLOCK_H = ROWS * CARD_H + (ROWS - 1) * GAP_Y; // 916
const GRID_TOP =
  GRID_Y0 + Math.max(0, (GRID_Y1 - GRID_Y0 - GRID_BLOCK_H) / 2); // ≈213
const PAGER_Y = CANVAS_H - 45; // 1255
const PAGER_H = 44;

// ── Interaction thresholds ────────────────────────────────────────────────────
const DRAG_THRESHOLD = 10;
const ANIM_MS = 300;
const COMMIT_FRACTION = 0.28;

// ── Colours ───────────────────────────────────────────────────────────────────
const ACCENT = "rgba(96,165,250,";
const GOLD = "rgba(250,200,80,";
const ORANGE = "rgba(250,140,30,";

type FilterTab = "studios" | "performers";
type MediaFilter = "all" | "vr" | "flat";

export class VRHomePanel extends VRCanvasPanel {
  private scenes: IVRSceneEntry[] = [];
  private currentSceneId: string | null = null;
  private previewVideo: HTMLVideoElement | null = null;
  private filterLabel: string | null = null;

  // Filter rail
  private studios: IVRFilterEntry[] = [];
  private performers: IVRFilterEntry[] = [];
  private filterTab: FilterTab = "studios";
  private activeFilterId: string | null = null;
  private mediaFilter: MediaFilter = "all";
  private railScroll = 0;
  private railMaxScroll = 0;

  // Grid page-slide (0 = settled, +1 = next page animating, −1 = prev)
  private page = 0;
  private offset = 0;
  private animFrom = 0;
  private animTo = 0;
  private animStart = 0;

  // Press / drag-vs-tap resolution
  private downId: string | null = null;
  private pressActive = false;
  private dragging = false;
  private pressZone: "rail" | "grid" = "grid";
  private pressInRailView = false;
  private pressX = 0;
  private pressY = 0;
  private gridOffsetBase = 0;
  private railScrollBase = 0;

  constructor() {
    super(PANEL_WIDTH_M, CANVAS_W, CANVAS_H, PANEL_RADIUS);
    this.mesh.name = "vr-home-panel";
  }

  get hasContent(): boolean {
    return this.scenes.length > 0;
  }

  get hoveredSceneId(): string | null {
    if (this.hoveredId?.startsWith("scene:")) {
      return this.hoveredId.slice("scene:".length);
    }
    return null;
  }

  setScenes(scenes: IVRSceneEntry[]) {
    this.scenes = scenes;
    this.page = 0;
    this.offset = 0;
    this.animStart = 0;
    this.markDirty();
  }

  setFilterData(studios: IVRFilterEntry[], performers: IVRFilterEntry[]) {
    this.studios = studios;
    this.performers = performers;
    this.markDirty();
  }

  setActiveFilter(id: string | null) {
    if (id !== this.activeFilterId) {
      this.activeFilterId = id;
      this.markDirty();
    }
  }

  setFilterLabel(label: string | null) {
    if (label !== this.filterLabel) {
      this.filterLabel = label;
      this.markDirty();
    }
  }

  setCurrentSceneId(id: string | null) {
    if (id !== this.currentSceneId) {
      this.currentSceneId = id;
      this.markDirty();
    }
  }

  setPreviewVideo(video: HTMLVideoElement | null) {
    this.previewVideo = video;
    this.markDirty();
  }

  setMediaFilter(f: MediaFilter) {
    if (f !== this.mediaFilter) {
      this.mediaFilter = f;
      this.markDirty();
    }
  }

  private get pageCount(): number {
    return Math.max(1, Math.ceil(this.scenes.length / PER_PAGE));
  }

  private get railItems(): IVRFilterEntry[] {
    return this.filterTab === "studios" ? this.studios : this.performers;
  }

  // ── Drag / tap / pagination ────────────────────────────────────────────────

  activate(uv: THREE.Vector2): VRControlAction | null {
    const px = uv.x * this.cw;
    const py = (1 - uv.y) * this.ch;
    this.downId = this.regionAt(uv)?.id ?? null;
    this.pressX = px;
    this.pressY = py;
    this.pressZone = px < RAIL_W ? "rail" : "grid";
    this.pressInRailView = py >= RAIL_VIEW_Y0 && py <= RAIL_VIEW_Y1;
    this.gridOffsetBase = this.offset;
    this.railScrollBase = this.railScroll;
    this.pressActive = true;
    this.dragging = false;
    this.animStart = 0;
    return null;
  }

  pointerMove(uv: THREE.Vector2): void {
    if (!this.pressActive) return;
    if (this.pressZone === "grid") {
      const dx = uv.x * this.cw - this.pressX;
      if (Math.abs(dx) > DRAG_THRESHOLD) this.dragging = true;
      if (!this.dragging) return;
      const lo = this.page > 0 ? -1 : 0;
      const hi = this.page < this.pageCount - 1 ? 1 : 0;
      const o = Math.min(hi, Math.max(lo, this.gridOffsetBase - dx / GRID_W));
      if (o !== this.offset) {
        this.offset = o;
        this.markDirty();
      }
    } else {
      const dy = (1 - uv.y) * this.ch - this.pressY;
      if (Math.abs(dy) > DRAG_THRESHOLD) this.dragging = true;
      if (!this.dragging || !this.pressInRailView) return;
      const next = Math.min(
        this.railMaxScroll,
        Math.max(0, this.railScrollBase - dy)
      );
      if (next !== this.railScroll) {
        this.railScroll = next;
        this.markDirty();
      }
    }
  }

  pointerUp(uv: THREE.Vector2): VRControlAction | null {
    const wasTap = !this.dragging && this.pressActive;
    const { downId } = this;
    this.pressActive = false;
    this.dragging = false;
    this.downId = null;
    if (wasTap) {
      const region = this.regionAt(uv);
      if (region && region.id === downId) return this.handleSelect(region);
      return null;
    }
    if (this.pressZone === "grid") this.snap();
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
    if (id === "exitVR") return { type: "exit" };
    if (id.startsWith("scene:")) {
      return { type: "switchScene", sceneId: id.slice("scene:".length) };
    }
    if (id === "pageR") { this.startArrow(1); return null; }
    if (id === "pageL") { this.startArrow(-1); return null; }
    if (id === "tab:studios" || id === "tab:performers") {
      const next: FilterTab =
        id === "tab:studios" ? "studios" : "performers";
      if (next !== this.filterTab) {
        this.filterTab = next;
        this.railScroll = 0;
        this.markDirty();
      }
      return null;
    }
    if (id === "filterAll") return { type: "setHomeFilter", kind: null };
    if (id.startsWith("filter:studio:")) {
      return {
        type: "setHomeFilter",
        kind: "studio",
        id: id.slice("filter:studio:".length),
      };
    }
    if (id.startsWith("filter:performer:")) {
      return {
        type: "setHomeFilter",
        kind: "performer",
        id: id.slice("filter:performer:".length),
      };
    }
    if (id === "media:all") return { type: "setMediaFilter", filter: "all" };
    if (id === "media:vr") return { type: "setMediaFilter", filter: "vr" };
    if (id === "media:flat") return { type: "setMediaFilter", filter: "flat" };
    return null;
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  protected draw() {
    this.tickAnimation();
    this.panelBackground();
    this.drawHeader();
    this.drawExitButton();
    this.drawDivider();
    this.drawRail();

    const { ctx } = this;
    if (this.scenes.length === 0) {
      ctx.font = "500 26px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText(
        this.filterLabel ? "No scenes for this filter" : "No scenes found",
        GRID_X0 + GRID_W / 2,
        (GRID_Y0 + GRID_Y1) / 2
      );
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(GRID_X0, GRID_Y0, GRID_W, GRID_Y1 - GRID_Y0);
    ctx.clip();
    const settled = this.offset === 0 && this.animStart === 0;
    this.drawPageCards(this.page, -this.offset * GRID_W, settled);
    if (this.offset > 0.0005 && this.page < this.pageCount - 1) {
      this.drawPageCards(this.page + 1, (1 - this.offset) * GRID_W, false);
    } else if (this.offset < -0.0005 && this.page > 0) {
      this.drawPageCards(this.page - 1, (-1 - this.offset) * GRID_W, false);
    }
    ctx.restore();

    this.drawPager();
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

  private drawHeader() {
    const { ctx } = this;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = "800 40px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.fillText("VEXXX", this.cw / 2 - 62, TITLE_Y);
    ctx.font = "300 40px sans-serif";
    ctx.fillStyle = `${ACCENT}0.95)`;
    ctx.fillText("Home", this.cw / 2 + 70, TITLE_Y);

    const count = this.scenes.length;
    const base = count === 1 ? "1 scene" : `${count} scenes`;
    const mediaLabel =
      this.mediaFilter === "vr"
        ? "VR library"
        : this.mediaFilter === "flat"
        ? "2D library"
        : "library";
    const sub = this.filterLabel
      ? `${this.filterLabel}  ·  ${base}`
      : `${base} in your ${mediaLabel}`;
    ctx.font = "500 19px sans-serif";
    ctx.fillStyle = this.filterLabel
      ? `${ACCENT}0.85)`
      : "rgba(255,255,255,0.45)";
    ctx.fillText(sub, this.cw / 2, SUB_Y);
  }

  private drawDivider() {
    const { ctx } = this;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(RAIL_W, CONTENT_Y0 - 4);
    ctx.lineTo(RAIL_W, CANVAS_H - 30);
    ctx.stroke();
  }

  // ── Filter rail ─────────────────────────────────────────────────────────────

  private drawRail() {
    this.drawMediaToggle();
    this.drawFilterTabs();
    this.drawAllChip();

    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RAIL_VIEW_Y0, RAIL_W, RAIL_VIEW_Y1 - RAIL_VIEW_Y0);
    ctx.clip();
    this.drawRailGrid();
    ctx.restore();
    this.drawRailScrollbar();
  }

  /** 3-button media-type row: [All] [VR] [2D] */
  private drawMediaToggle() {
    const { ctx } = this;
    const options: Array<{ id: MediaFilter; label: string }> = [
      { id: "all", label: "All" },
      { id: "vr", label: "VR" },
      { id: "flat", label: "2D" },
    ];
    let bx = RAIL_PAD;
    for (const opt of options) {
      const active = this.mediaFilter === opt.id;
      const hovered = this.hoveredId === `media:${opt.id}`;
      this.roundRect(bx, CONTENT_Y0, MEDIA_BTN_W, MEDIA_H, MEDIA_H / 2);
      if (active) {
        const g = ctx.createLinearGradient(
          bx,
          CONTENT_Y0,
          bx,
          CONTENT_Y0 + MEDIA_H
        );
        g.addColorStop(0, "rgba(96,165,250,0.90)");
        g.addColorStop(1, "rgba(60,120,220,0.78)");
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = hovered
          ? "rgba(255,255,255,0.16)"
          : "rgba(255,255,255,0.07)";
      }
      ctx.fill();
      ctx.font = "700 19px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = active ? "#05111f" : "rgba(255,255,255,0.88)";
      ctx.fillText(opt.label, bx + MEDIA_BTN_W / 2, CONTENT_Y0 + MEDIA_H / 2 + 1);
      this.regions.push({
        id: `media:${opt.id}`,
        x: bx,
        y: CONTENT_Y0,
        w: MEDIA_BTN_W,
        h: MEDIA_H,
      });
      bx += MEDIA_BTN_W + MEDIA_BTN_GAP;
    }
  }

  /** Studios / Performers tabs */
  private drawFilterTabs() {
    const { ctx } = this;
    const tabs: Array<{ id: FilterTab; label: string }> = [
      { id: "studios", label: "Studios" },
      { id: "performers", label: "Performers" },
    ];
    const tabW = (RAIL_INNER - 8) / 2;
    let tx = RAIL_PAD;
    for (const t of tabs) {
      const active = t.id === this.filterTab;
      const hovered = this.hoveredId === `tab:${t.id}`;
      this.roundRect(tx, TAB_Y, tabW, TAB_H, 12);
      if (active) {
        const g = ctx.createLinearGradient(tx, TAB_Y, tx, TAB_Y + TAB_H);
        g.addColorStop(0, "rgba(130,190,255,0.92)");
        g.addColorStop(1, "rgba(70,130,230,0.80)");
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = hovered
          ? "rgba(255,255,255,0.16)"
          : "rgba(255,255,255,0.07)";
      }
      ctx.fill();
      ctx.font = "600 21px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = active ? "#091428" : "rgba(255,255,255,0.9)";
      ctx.fillText(t.label, tx + tabW / 2, TAB_Y + TAB_H / 2 + 1);
      this.regions.push({ id: `tab:${t.id}`, x: tx, y: TAB_Y, w: tabW, h: TAB_H });
      tx += tabW + 8;
    }
  }

  /** "All scenes" reset chip */
  private drawAllChip() {
    const { ctx } = this;
    const allActive = this.activeFilterId === null;
    const allHover = this.hoveredId === "filterAll";
    this.roundRect(RAIL_PAD, ALL_Y, RAIL_INNER, ALL_H, ALL_H / 2);
    ctx.fillStyle = allActive
      ? `${ACCENT}0.22)`
      : allHover
      ? "rgba(255,255,255,0.14)"
      : "rgba(255,255,255,0.06)";
    ctx.fill();
    ctx.font = "600 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = allActive ? `${ACCENT}0.95)` : "rgba(255,255,255,0.8)";
    ctx.fillText(
      "All scenes",
      RAIL_PAD + RAIL_INNER / 2,
      ALL_Y + ALL_H / 2 + 1
    );
    this.regions.push({
      id: "filterAll",
      x: RAIL_PAD,
      y: ALL_Y,
      w: RAIL_INNER,
      h: ALL_H,
    });
  }

  /** 2-column portrait/logo tile grid for studios or performers. */
  private drawRailGrid() {
    const { ctx } = this;
    const items = this.railItems;
    const kind = this.filterTab === "studios" ? "studio" : "performer";
    const isStudio = kind === "studio";
    const imgH = isStudio ? STUDIO_IMG_H : PERF_IMG_H;
    const tileH = isStudio ? STUDIO_TILE_H : PERF_TILE_H;
    const rowH = isStudio ? STUDIO_ROW_H : PERF_ROW_H;

    if (items.length === 0) {
      ctx.font = "500 18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillText(
        `No ${this.filterTab}`,
        RAIL_PAD + RAIL_INNER / 2,
        (RAIL_VIEW_Y0 + RAIL_VIEW_Y1) / 2
      );
      this.railMaxScroll = 0;
      return;
    }

    const nRows = Math.ceil(items.length / TILE_COLS);
    const totalH = nRows * rowH - TILE_GAP_Y;
    this.railMaxScroll = Math.max(
      0,
      totalH - (RAIL_VIEW_Y1 - RAIL_VIEW_Y0)
    );
    this.railScroll = Math.min(
      this.railMaxScroll,
      Math.max(0, this.railScroll)
    );

    for (let i = 0; i < items.length; i++) {
      const row = Math.floor(i / TILE_COLS);
      const col = i % TILE_COLS;
      const tileX = RAIL_PAD + col * (TILE_W + TILE_GAP_X);
      const tileY = RAIL_VIEW_Y0 - this.railScroll + row * rowH;

      if (tileY + tileH < RAIL_VIEW_Y0 || tileY > RAIL_VIEW_Y1) continue;

      const it = items[i];
      const id = `filter:${kind}:${it.id}`;
      const active = this.activeFilterId === it.id;
      const hovered = this.hoveredId === id;

      // Tile background
      this.roundRect(tileX, tileY, TILE_W, tileH, 12);
      ctx.fillStyle = active
        ? `${ACCENT}0.22)`
        : hovered
        ? "rgba(255,255,255,0.12)"
        : "rgba(255,255,255,0.06)";
      ctx.fill();
      if (active) {
        this.roundRect(tileX, tileY, TILE_W, tileH, 12);
        ctx.lineWidth = 2;
        ctx.strokeStyle = `${ACCENT}0.85)`;
        ctx.stroke();
      }

      // Image area (cover-cropped, clipped to rounded top corners)
      const img = this.image(it.imageUrl);
      ctx.save();
      this.roundRect(tileX, tileY, TILE_W, imgH, 12);
      ctx.clip();
      if (img) {
        this.drawImageCover(img, tileX, tileY, TILE_W, imgH, 0);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(tileX, tileY, TILE_W, imgH);
        // Initial-letter placeholder
        ctx.font = `700 ${isStudio ? 36 : 52}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fillText(
          it.name.charAt(0).toUpperCase(),
          tileX + TILE_W / 2,
          tileY + imgH / 2
        );
      }
      ctx.restore();

      // Count badge (top-right of image area)
      const countStr = `${it.count}`;
      const bW = 28 + (it.count >= 10 ? 8 : 0) + (it.count >= 100 ? 6 : 0);
      const bH = 20;
      const bX = tileX + TILE_W - bW - 6;
      const bY = tileY + 6;
      this.roundRect(bX, bY, bW, bH, bH / 2);
      ctx.fillStyle = "rgba(0,0,0,0.62)";
      ctx.fill();
      ctx.font = "700 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.fillText(countStr, bX + bW / 2, bY + bH / 2);

      // Name label below image
      ctx.font = "600 17px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = active
        ? `${ACCENT}0.95)`
        : "rgba(255,255,255,0.92)";
      ctx.fillText(
        this.fitText(it.name, TILE_W - 16),
        tileX + TILE_W / 2,
        tileY + imgH + STUDIO_LABEL_H / 2 + 2
      );

      // Register hit region (clipped to viewport)
      const ry = Math.max(tileY, RAIL_VIEW_Y0);
      const rh = Math.min(tileY + tileH, RAIL_VIEW_Y1) - ry;
      if (rh > 8) {
        this.regions.push({ id, x: tileX, y: ry, w: TILE_W, h: rh });
      }
    }
  }

  private drawRailScrollbar() {
    if (this.railMaxScroll <= 1) return;
    const { ctx } = this;
    const viewH = RAIL_VIEW_Y1 - RAIL_VIEW_Y0;
    const trackX = RAIL_W - 12;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(trackX, RAIL_VIEW_Y0, 3, viewH);
    const total = viewH + this.railMaxScroll;
    const thumbH = Math.max(30, viewH * (viewH / total));
    const thumbY =
      RAIL_VIEW_Y0 +
      (viewH - thumbH) * (this.railScroll / this.railMaxScroll);
    ctx.fillStyle = `${ACCENT}0.6)`;
    ctx.fillRect(trackX, thumbY, 3, thumbH);
  }

  // ── Scene grid ─────────────────────────────────────────────────────────────

  private drawPageCards(
    pageIndex: number,
    xShift: number,
    interactive: boolean
  ) {
    const start = pageIndex * PER_PAGE;
    const items = this.scenes.slice(start, start + PER_PAGE);
    for (let i = 0; i < items.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = GRID_X0 + col * (CARD_W + GAP_X) + xShift;
      const y = GRID_TOP + row * (CARD_H + GAP_Y);
      this.drawCard(items[i], x, y, interactive);
    }
  }

  private drawExitButton() {
    const { ctx } = this;
    const w = 132;
    const h = 44;
    const x = this.cw - PAD - w;
    const y = 26;
    const hovered = this.hoveredId === "exitVR";
    this.roundRect(x, y, w, h, h / 2);
    ctx.fillStyle = hovered ? "rgba(220,72,72,0.92)" : "rgba(200,60,60,0.22)";
    ctx.fill();
    this.roundRect(x, y, w, h, h / 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hovered
      ? "rgba(255,160,160,0.6)"
      : "rgba(220,90,90,0.55)";
    ctx.stroke();
    ctx.font = "600 19px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = hovered
      ? "rgba(255,255,255,0.98)"
      : "rgba(255,190,190,0.95)";
    ctx.fillText("✕  Exit VR", x + w / 2, y + h / 2 + 1);
    this.regions.push({ id: "exitVR", x, y, w, h });
  }

  private drawCard(
    scene: IVRSceneEntry,
    x: number,
    y: number,
    interactive: boolean
  ) {
    const { ctx } = this;
    const hovered = interactive && this.hoveredId === `scene:${scene.id}`;
    const isPlaying = this.currentSceneId === scene.id;
    const R = 14;

    ctx.save();
    this.roundRect(x, y, CARD_W, CARD_H, R);
    ctx.clip();

    // Thumbnail: preview video when hovered, else screenshot.
    const videoEl = hovered ? this.previewVideo : null;
    if (videoEl && videoEl.readyState >= 2) {
      const vr = videoEl.videoWidth / videoEl.videoHeight;
      const cr = CARD_W / THUMB_H;
      let sx = 0, sy = 0, sw = videoEl.videoWidth, sh = videoEl.videoHeight;
      if (vr > cr) { sw = sh * cr; sx = (videoEl.videoWidth - sw) / 2; }
      else { sh = sw / cr; sy = (videoEl.videoHeight - sh) / 2; }
      ctx.drawImage(videoEl, sx, sy, sw, sh, x, y, CARD_W, THUMB_H);
    } else {
      const img = this.image(scene.thumbnailUrl);
      if (img) {
        this.drawImageCover(img, x, y, CARD_W, THUMB_H, 0);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(x, y, CARD_W, THUMB_H);
      }
    }

    // Funscript heatmap strip at the bottom of the thumbnail.
    if (scene.hasFunscript && scene.heatmapUrl) {
      const hmImg = this.image(scene.heatmapUrl);
      if (hmImg) {
        const hmH = 22;
        ctx.save();
        ctx.globalAlpha = 0.78;
        ctx.drawImage(
          hmImg,
          0,
          0,
          hmImg.width,
          hmImg.height,
          x,
          y + THUMB_H - hmH,
          CARD_W,
          hmH
        );
        ctx.restore();
      }
    }

    // Caption bar
    ctx.fillStyle = "rgba(12,12,17,0.94)";
    ctx.fillRect(x, y + THUMB_H, CARD_W, CAP_H);
    ctx.restore();

    // Title + studio text
    const textX = x + 16;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "600 21px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(
      this.fitText(scene.title || `Scene ${scene.id}`, CARD_W - 32),
      textX,
      y + THUMB_H + (scene.studioName ? 33 : 49)
    );
    if (scene.studioName) {
      ctx.font = "400 16px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(
        this.fitText(scene.studioName, CARD_W - 32),
        textX,
        y + THUMB_H + 60
      );
    }

    // "Now Playing" badge
    if (isPlaying) {
      const bw = 104, bh = 26;
      this.roundRect(x + 10, y + 10, bw, bh, bh / 2);
      ctx.fillStyle = `${GOLD}0.92)`;
      ctx.fill();
      ctx.font = "700 14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(30,20,0,0.95)";
      ctx.fillText("NOW PLAYING", x + 10 + bw / 2, y + 10 + bh / 2 + 1);
    }

    // Funscript indicator badge (top-right of thumbnail)
    if (scene.hasFunscript) {
      const bw = 42, bh = 22;
      const bx = x + CARD_W - bw - 10;
      const by = y + 10;
      this.roundRect(bx, by, bw, bh, bh / 2);
      ctx.fillStyle = `${ORANGE}0.92)`;
      ctx.fill();
      ctx.font = "700 13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(20,8,0,0.96)";
      ctx.fillText("FS", bx + bw / 2, by + bh / 2 + 1);
    }

    // Hover / playing border
    if (isPlaying || hovered) {
      this.roundRect(x, y, CARD_W, CARD_H, R);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = isPlaying ? `${GOLD}0.85)` : `${ACCENT}0.75)`;
      ctx.stroke();
    }

    if (interactive) {
      this.regions.push({ id: `scene:${scene.id}`, x, y, w: CARD_W, h: CARD_H });
      if (hovered && this.previewVideo) this.markDirty();
    }
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
}
