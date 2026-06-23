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
import {
  VRControlAction,
  IVRHomeSettings,
  IVRFilterEntry,
  IVRGalleryEntry,
  VRMediaFilter,
  VRSortMode,
} from "./types";
import { VRCanvasPanel, IPanelRegion } from "./VRInfoPanels";
import { IVRSceneEntry } from "./VRScenesPanel";

export type { IVRFilterEntry };

// ── Canvas / panel dimensions ─────────────────────────────────────────────────
const CANVAS_W = 2200;
const CANVAS_H = 1300; // taller for the extra scene row
const PANEL_WIDTH_M = 3.4;
const PANEL_RADIUS = 2.65;

// ── Shared layout ─────────────────────────────────────────────────────────────
const PAD = 40;
const TITLE_Y = 58;
const LOGO_CY = 50; // vertical centre of the enlarged header logo
const SUB_Y = 110; // pushed down to clear the larger logo
const CONTENT_Y0 = 132; // top of all content rows

// ── Filter rail (left 540 px) ─────────────────────────────────────────────────
const RAIL_W = 540;
const RAIL_PAD = 28;
const RAIL_INNER = RAIL_W - RAIL_PAD * 2; // 484

// Media-type toggle row ( [All] [VR] [2D] [FS] )
const MEDIA_H = 46;
const MEDIA_BTN_COUNT = 4;
const MEDIA_BTN_GAP = 8;
const MEDIA_BTN_W = Math.floor(
  (RAIL_INNER - MEDIA_BTN_GAP * (MEDIA_BTN_COUNT - 1)) / MEDIA_BTN_COUNT
); // 115

// Studios / Performers tabs
const TAB_Y = CONTENT_Y0 + MEDIA_H + 10; // 188
const TAB_H = 50;

// "All scenes" reset chip
const ALL_Y = TAB_Y + TAB_H + 10; // 248
const ALL_H = 38;

// Sort chips (Recent / Rating / A–Z) sit between the All chip and the scrollable grid
const SORT_Y = ALL_Y + ALL_H + 8; // 294
const SORT_H = 34;

// Scrollable filter tile grid (starts below sort chips)
const RAIL_VIEW_Y0 = SORT_Y + SORT_H + 8; // 336
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
const GRID_TOP = GRID_Y0 + Math.max(0, (GRID_Y1 - GRID_Y0 - GRID_BLOCK_H) / 2); // ≈213
const PAGER_Y = CANVAS_H - 45; // 1255
const PAGER_H = 44;

// Gallery justified-row layout — galleries are packed greedily by cover-aspect
// ratio so each row fills GRID_W. The card height varies per row (cover area +
// fixed caption bar). Separate from the scene fixed grid constants above.
const GAL_TARGET_H = 210;   // target cover height before justification
const GAL_GAP = 16;          // horizontal + vertical gap between cards
const GAL_CAP_H = 78;       // caption bar height (matches CAP_H for consistency)
const GAL_DEF_ASPECT = 16 / 9;

// ── Interaction thresholds ────────────────────────────────────────────────────
// Default gaze-dwell delay before auto-launch. User-overridable via the settings
// gear (the live value lives in `this.dwellMs`); this is only the fallback.
const DWELL_MS_DEFAULT = 2500;
const DWELL_TIME_OPTIONS = [1500, 2500, 4000]; // selectable in the settings panel
// Drag dead-zones (canvas px). The grid threshold is deliberately larger than
// the rail's: a mis-fired horizontal drag *paginates* the grid, which is what
// made selecting a card feel "too sensitive" — the trigger-pull kick would
// shift the page out from under the tap. The rail only scrolls, so it can stay
// twitchier.
const GRID_DRAG_THRESHOLD = 24;
const RAIL_DRAG_THRESHOLD = 12;
// Settle window after a press: a trigger pull torques the controller, spiking
// the ray sideways for the first few frames. During this window we re-baseline
// the press point each frame instead of treating the spike as a drag, so a tap
// stays a tap. Deliberate drags begin once the hand has settled (~90 ms).
const SETTLE_MS = 90;
const ANIM_MS = 300;
const COMMIT_FRACTION = 0.28;

// ── Content-mode toggle (Scenes | Galleries) — header, left of the logo ───────
const MODE_X = 230;
const MODE_Y = 26;
const MODE_H = 46;
const MODE_BTN_W = 165;
const MODE_GAP = 8;

// ── Colours ───────────────────────────────────────────────────────────────────
const ACCENT = "rgba(96,165,250,";
const GOLD = "rgba(250,200,80,";
const ORANGE = "rgba(250,140,30,";

type FilterTab = "studios" | "performers";
type MediaFilter = VRMediaFilter;
type SortMode = VRSortMode;
type ContentMode = "scenes" | "galleries";

export class VRHomePanel extends VRCanvasPanel {
  // Server-paged grid: only the current page (+ prefetched neighbours) are held
  // in memory at once. `pageCache` maps an absolute page index → up to PER_PAGE
  // card entries; `totalCount` (from the server) drives the page geometry.
  private pageCache = new Map<number, IVRSceneEntry[]>();
  private requestedPages = new Set<number>();
  private loadedFlat: IVRSceneEntry[] = []; // flattened cached pages (hover-preview lookup)
  private totalCount = 0;
  private loaded = false; // first page/total has arrived (distinguishes loading vs empty)
  private pageRequester: ((pageIndex: number) => void) | null = null;
  private currentSceneId: string | null = null;
  private previewVideo: HTMLVideoElement | null = null;
  private filterLabel: string | null = null;
  private sortMode: SortMode = "recent";

  // Content mode: the wall shows either the scene grid or the gallery grid. The
  // page-slide state (page/offset/anim) and the rail are shared — only one grid
  // is visible at a time, so switching modes resets the page window.
  private contentMode: ContentMode = "scenes";
  // Server-paged gallery grid (parallels the scene pageCache above).
  private galleryPageCache = new Map<number, IVRGalleryEntry[]>();
  private galleryRequestedPages = new Set<number>();
  private galleryTotal = 0;
  private galleryLoaded = false;
  private galleryPageRequester: ((pageIndex: number) => void) | null = null;

  // Filter rail
  private studios: IVRFilterEntry[] = [];
  private performers: IVRFilterEntry[] = [];
  private filterTab: FilterTab = "studios";
  private activeFilterId: string | null = null;
  private mediaFilter: MediaFilter = "all";
  private sceneCounts = { all: 0, vr: 0, flat: 0, funscript: 0 };
  private railScroll = 0;
  private railMaxScroll = 0;

  // Gaze-dwell launch: track which scene-card the user has been looking at and for how long.
  private dwellId: string | null = null;
  private dwellStart = 0;
  private pendingAction: VRControlAction | null = null;

  // User preferences (settings gear). Mirrored from React; the panel renders the
  // toggle states and uses hoverLaunch / dwellMs to drive gaze-dwell behaviour.
  private hoverLaunch = true;
  private dwellMs = DWELL_MS_DEFAULT;
  private soundOnPlay = true;
  private settingsOpen = false;

  // Thumbstick nav edge-trigger arms (reset when stick returns to centre).
  private lobbyHArmed = true;
  private lobbyVArmed = true;

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
  private pressTime = 0;
  private gridOffsetBase = 0;
  private railScrollBase = 0;

  constructor() {
    super(PANEL_WIDTH_M, CANVAS_W, CANVAS_H, PANEL_RADIUS);
    this.mesh.name = "vr-home-panel";
  }

  get hasContent(): boolean {
    return this.totalCount > 0;
  }

  get hoveredSceneId(): string | null {
    if (this.hoveredId?.startsWith("scene:")) {
      return this.hoveredId.slice("scene:".length);
    }
    return null;
  }

  /** Injected by the manager: request a page of scenes from the server pager. */
  setPageRequester(cb: (pageIndex: number) => void) {
    this.pageRequester = cb;
  }

  /**
   * Drop all cached pages and reset to page 0 — called when the query (sort /
   * media / studio-performer filter) changes so the grid re-pages from scratch.
   */
  resetLibrary() {
    this.pageCache.clear();
    this.requestedPages.clear();
    this.loadedFlat = [];
    this.totalCount = 0;
    this.loaded = false;
    this.page = 0;
    this.offset = 0;
    this.animStart = 0;
    this.markDirty();
  }

  /** Receive a fetched page from the manager's pager. */
  setPageData(pageIndex: number, scenes: IVRSceneEntry[], totalCount: number) {
    this.pageCache.set(pageIndex, scenes);
    this.requestedPages.delete(pageIndex);
    this.totalCount = totalCount;
    this.loaded = true;
    this.rebuildLoadedFlat();
    this.markDirty();
  }

  /** Flattened view of all cached pages — for the manager's hover-preview lookup. */
  allLoadedScenes(): IVRSceneEntry[] {
    return this.loadedFlat;
  }

  private rebuildLoadedFlat() {
    this.loadedFlat = [];
    for (const pg of this.pageCache.values()) this.loadedFlat.push(...pg);
  }

  /** Request any of the visible pages (current ± 1) not already cached/in-flight. */
  private ensurePagesLoaded() {
    const last = this.pageCount - 1;
    const want = [this.page, this.page - 1, this.page + 1];
    if (this.contentMode === "galleries") {
      if (!this.galleryPageRequester) return;
      for (const pg of want) {
        if (pg < 0 || pg > last) continue;
        if (this.galleryPageCache.has(pg) || this.galleryRequestedPages.has(pg))
          continue;
        this.galleryRequestedPages.add(pg);
        this.galleryPageRequester(pg);
      }
      return;
    }
    if (!this.pageRequester) return;
    for (const pg of want) {
      if (pg < 0 || pg > last) continue;
      if (this.pageCache.has(pg) || this.requestedPages.has(pg)) continue;
      this.requestedPages.add(pg);
      this.pageRequester(pg);
    }
  }

  setSortMode(mode: SortMode) {
    if (mode === this.sortMode) return;
    this.sortMode = mode;
    // Sorting is server-side now: reset the grid and let the manager re-query.
    this.resetLibrary();
  }

  takePendingAction(): VRControlAction | null {
    const a = this.pendingAction;
    this.pendingAction = null;
    return a;
  }

  /** Sync user preferences (from React / persisted localStorage). */
  setSettings(s: IVRHomeSettings) {
    let changed = false;
    if (s.hoverLaunch !== this.hoverLaunch) {
      this.hoverLaunch = s.hoverLaunch;
      changed = true;
    }
    if (s.dwellMs !== this.dwellMs) {
      this.dwellMs = s.dwellMs;
      changed = true;
    }
    if (s.soundOnPlay !== this.soundOnPlay) {
      this.soundOnPlay = s.soundOnPlay;
      changed = true;
    }
    if (changed) {
      // Reset any in-flight gaze so a delay change takes effect cleanly.
      this.dwellId = null;
      this.dwellStart = 0;
      this.markDirty();
    }
  }

  /** Horizontal thumbstick: page the scene grid left or right. */
  nudgePage(dir: 1 | -1) {
    if (dir > 0) {
      if (!this.lobbyHArmed) return;
      this.lobbyHArmed = false;
    } else {
      if (!this.lobbyHArmed) return;
      this.lobbyHArmed = false;
    }
    this.startArrow(dir);
  }

  /** Vertical thumbstick: scroll the filter rail up or down. */
  nudgeRail(dir: 1 | -1) {
    if (dir > 0) {
      if (!this.lobbyVArmed) return;
      this.lobbyVArmed = false;
    } else {
      if (!this.lobbyVArmed) return;
      this.lobbyVArmed = false;
    }
    const step = 140;
    const next = Math.min(
      this.railMaxScroll,
      Math.max(0, this.railScroll + dir * step)
    );
    if (next !== this.railScroll) {
      this.railScroll = next;
      this.markDirty();
    }
  }

  /** Rearm thumbstick axes when they return near centre. */
  tickLobbyAxes(h: number, v: number) {
    if (Math.abs(h) < 0.25) this.lobbyHArmed = true;
    if (Math.abs(v) < 0.25) this.lobbyVArmed = true;
  }

  get hoveredPreviewUrl(): string | null {
    const id = this.hoveredId;
    if (!id?.startsWith("scene:")) return null;
    const sceneId = id.slice("scene:".length);
    for (const pg of this.pageCache.values()) {
      const found = pg.find((s) => s.id === sceneId);
      if (found) return found.previewUrl ?? null;
    }
    return null;
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

  setSceneCounts(all: number, vr: number, flat: number, funscript: number) {
    this.sceneCounts = { all, vr, flat, funscript };
    this.markDirty();
  }

  // ── Galleries content mode ──────────────────────────────────────────────────

  get contentModeValue(): ContentMode {
    return this.contentMode;
  }

  /** Switch the wall between the Scenes grid and the Galleries grid. */
  setContentMode(mode: ContentMode) {
    if (mode === this.contentMode) return;
    this.contentMode = mode;
    // One grid is visible at a time — reset the shared page-slide window and any
    // in-flight gaze so the new grid starts clean at page 0.
    this.page = 0;
    this.offset = 0;
    this.animStart = 0;
    this.dwellId = null;
    this.dwellStart = 0;
    this.markDirty();
  }

  /** Injected by the manager: request a page of galleries from the server pager. */
  setGalleryPageRequester(cb: (pageIndex: number) => void) {
    this.galleryPageRequester = cb;
  }

  /** Drop cached gallery pages and reset — called when the gallery query changes. */
  resetGalleryLibrary() {
    this.galleryPageCache.clear();
    this.galleryRequestedPages.clear();
    this.galleryTotal = 0;
    this.galleryLoaded = false;
    if (this.contentMode === "galleries") {
      this.page = 0;
      this.offset = 0;
      this.animStart = 0;
    }
    this.markDirty();
  }

  /** Receive a fetched gallery page from the manager's pager. */
  setGalleryPageData(
    pageIndex: number,
    galleries: IVRGalleryEntry[],
    totalCount: number
  ) {
    this.galleryPageCache.set(pageIndex, galleries);
    this.galleryRequestedPages.delete(pageIndex);
    this.galleryTotal = totalCount;
    this.galleryLoaded = true;
    this.markDirty();
  }

  private get pageCount(): number {
    const total =
      this.contentMode === "galleries" ? this.galleryTotal : this.totalCount;
    return Math.max(1, Math.ceil(total / PER_PAGE));
  }

  private get railItems(): IVRFilterEntry[] {
    return this.filterTab === "studios" ? this.studios : this.performers;
  }

  /** Look up a cached gallery entry by id (for the openGallery action title). */
  private findGallery(id: string): IVRGalleryEntry | null {
    for (const pg of this.galleryPageCache.values()) {
      const found = pg.find((g) => g.id === id);
      if (found) return found;
    }
    return null;
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
    this.pressTime = performance.now();
    this.animStart = 0;
    return null;
  }

  pointerMove(uv: THREE.Vector2): void {
    if (!this.pressActive) return;
    // While the settings modal is open the wall behind it is inert.
    if (this.settingsOpen) return;
    // Settle window: absorb the trigger-pull kick by re-baselining the press
    // point (and the drag bases) to wherever the ray has settled, so the spike
    // never counts toward the drag delta. A drag can only begin afterwards.
    if (!this.dragging && performance.now() - this.pressTime < SETTLE_MS) {
      this.pressX = uv.x * this.cw;
      this.pressY = (1 - uv.y) * this.ch;
      this.gridOffsetBase = this.offset;
      this.railScrollBase = this.railScroll;
      return;
    }
    if (this.pressZone === "grid") {
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
    } else {
      const dy = (1 - uv.y) * this.ch - this.pressY;
      if (Math.abs(dy) > RAIL_DRAG_THRESHOLD) this.dragging = true;
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

    // Settings gear + modal interactions (handled in-panel; settings changes
    // are also emitted so React can persist them and apply audio side-effects).
    if (id === "settings") {
      this.settingsOpen = !this.settingsOpen;
      this.markDirty();
      return null;
    }
    if (id === "settingsClose") {
      this.settingsOpen = false;
      this.markDirty();
      return null;
    }
    if (this.settingsOpen) {
      if (id === "set:hoverLaunch") {
        this.hoverLaunch = !this.hoverLaunch;
        this.markDirty();
        return {
          type: "setVrSetting",
          key: "hoverLaunch",
          value: this.hoverLaunch,
        };
      }
      if (id === "set:soundOnPlay") {
        this.soundOnPlay = !this.soundOnPlay;
        this.markDirty();
        return {
          type: "setVrSetting",
          key: "soundOnPlay",
          value: this.soundOnPlay,
        };
      }
      if (id.startsWith("dwell:")) {
        const ms = parseInt(id.slice("dwell:".length), 10);
        if (!Number.isNaN(ms)) {
          this.dwellMs = ms;
          this.markDirty();
          return { type: "setVrDwellMs", ms };
        }
        return null;
      }
      return null;
    }

    if (id === "exitVR") return { type: "exit" };
    if (id === "mode:scenes" || id === "mode:galleries") {
      const mode: ContentMode = id === "mode:galleries" ? "galleries" : "scenes";
      if (mode !== this.contentMode) {
        this.setContentMode(mode);
        return { type: "setContentMode", mode };
      }
      return null;
    }
    if (id.startsWith("gallery:")) {
      const galleryId = id.slice("gallery:".length);
      const g = this.findGallery(galleryId);
      return { type: "openGallery", galleryId, title: g?.title };
    }
    if (id.startsWith("scene:")) {
      return { type: "switchScene", sceneId: id.slice("scene:".length) };
    }
    if (id === "pageR") {
      this.startArrow(1);
      return null;
    }
    if (id === "pageL") {
      this.startArrow(-1);
      return null;
    }
    if (id === "tab:studios" || id === "tab:performers") {
      const next: FilterTab = id === "tab:studios" ? "studios" : "performers";
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
    if (id === "media:funscript")
      return { type: "setMediaFilter", filter: "funscript" };
    if (id === "sort:recent") {
      this.setSortMode("recent");
      return { type: "setHomeSort", sort: "recent" };
    }
    if (id === "sort:rating") {
      this.setSortMode("rating");
      return { type: "setHomeSort", sort: "rating" };
    }
    if (id === "sort:title") {
      this.setSortMode("title");
      return { type: "setHomeSort", sort: "title" };
    }
    return null;
  }

  // ── Dwell / update ────────────────────────────────────────────────────────

  update() {
    // Pull in any visible pages we don't have yet (deduped against in-flight
    // requests + cache); cheap to call every frame.
    this.ensurePagesLoaded();
    this.tickDwell();
    super.update();
  }

  private tickDwell() {
    // Disabled when the user turns off gaze-launch, or while the settings modal
    // is open (the grid is non-interactive behind it).
    if (!this.hoverLaunch || this.settingsOpen) {
      this.dwellId = null;
      this.dwellStart = 0;
      return;
    }
    // Dwell-launch targets the active grid: scene cards launch playback, gallery
    // cards open the XR gallery viewer.
    const prefix = this.contentMode === "galleries" ? "gallery:" : "scene:";
    const id = this.hoveredId;
    if (!id?.startsWith(prefix)) {
      this.dwellId = null;
      this.dwellStart = 0;
      return;
    }
    if (id !== this.dwellId) {
      this.dwellId = id;
      this.dwellStart = performance.now();
    }
    const elapsed = performance.now() - this.dwellStart;
    const frac = Math.min(1, elapsed / this.dwellMs);
    if (frac >= 1 && !this.pendingAction) {
      if (this.contentMode === "galleries") {
        const galleryId = id.slice("gallery:".length);
        const g = this.findGallery(galleryId);
        this.pendingAction = { type: "openGallery", galleryId, title: g?.title };
      } else {
        const sceneId = id.slice("scene:".length);
        this.pendingAction = { type: "switchScene", sceneId };
      }
      this.dwellId = null;
      this.dwellStart = 0;
    }
    if (frac > 0 && frac < 1) {
      this.markDirty();
    }
  }

  private getDwellFrac(id: string): number {
    const prefix = this.contentMode === "galleries" ? "gallery:" : "scene:";
    if (this.dwellId !== `${prefix}${id}`) return 0;
    return Math.min(1, (performance.now() - this.dwellStart) / this.dwellMs);
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  protected draw() {
    this.tickAnimation();
    this.panelBackground();
    this.drawHeader();
    this.drawSettingsButton();
    this.drawModeToggle();
    this.drawExitButton();
    this.drawDivider();
    this.drawRail();
    this.drawGrid();

    // Settings modal sits on top: it dims the wall and discards the underlying
    // interactive regions so only its own controls are tappable. Tapping the
    // dimmed area outside the modal (incl. the gear) closes it via the backdrop.
    if (this.settingsOpen) {
      this.regions = [];
      this.drawSettingsOverlay();
    }
  }

  /** Draw the active grid (scenes or galleries) or an empty-state message. */
  private drawGrid() {
    const { ctx } = this;
    const galleries = this.contentMode === "galleries";
    const loaded = galleries ? this.galleryLoaded : this.loaded;
    const total = galleries ? this.galleryTotal : this.totalCount;
    // Empty state only once we know the library is genuinely empty for this
    // filter; before the first page arrives we fall through to skeleton cards.
    if (loaded && total === 0) {
      ctx.font = "500 26px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      const kind = galleries ? "galleries" : "scenes";
      ctx.fillText(
        this.filterLabel
          ? `No ${kind} for this filter`
          : `No ${kind} found`,
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
    const logo = this.image("/vexxx.png");
    if (logo) {
      // Contain-fit the logo into the header band, centred on LOGO_CY. Much
      // larger than before — the brand should read clearly across the room.
      const maxW = 640;
      const maxH = 88;
      const ir = logo.naturalWidth / logo.naturalHeight;
      const lw = ir > maxW / maxH ? maxW : maxH * ir;
      const lh = ir > maxW / maxH ? maxW / ir : maxH;
      ctx.drawImage(logo, this.cw / 2 - lw / 2, LOGO_CY - lh / 2, lw, lh);
    } else {
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.font = "800 40px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.96)";
      ctx.fillText("VEXXX", this.cw / 2 - 62, TITLE_Y);
      ctx.font = "300 40px sans-serif";
      ctx.fillStyle = `${ACCENT}0.95)`;
      ctx.fillText("Home", this.cw / 2 + 70, TITLE_Y);
    }

    const galleries = this.contentMode === "galleries";
    const count = galleries ? this.galleryTotal : this.totalCount;
    const base = galleries
      ? count === 1
        ? "1 gallery"
        : `${count} galleries`
      : count === 1
      ? "1 scene"
      : `${count} scenes`;
    const mediaLabel =
      this.mediaFilter === "vr"
        ? "VR library"
        : this.mediaFilter === "flat"
        ? "2D library"
        : this.mediaFilter === "funscript"
        ? "interactive library"
        : "library";
    const sub = this.filterLabel
      ? `${this.filterLabel}  ·  ${base}`
      : galleries
      ? `${base} in your library`
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
    // Galleries have no media type — hide the All/VR/2D/FS toggle in that mode.
    if (this.contentMode !== "galleries") this.drawMediaToggle();
    this.drawFilterTabs();
    this.drawAllChip();
    this.drawSortChips();

    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RAIL_VIEW_Y0, RAIL_W, RAIL_VIEW_Y1 - RAIL_VIEW_Y0);
    ctx.clip();
    this.drawRailGrid();
    ctx.restore();
    this.drawRailScrollbar();
  }

  /** 3-button media-type row: [All N] [VR N] [2D N] */
  private drawMediaToggle() {
    const { ctx } = this;
    const counts: Record<MediaFilter, number> = {
      all: this.sceneCounts.all,
      vr: this.sceneCounts.vr,
      flat: this.sceneCounts.flat,
      funscript: this.sceneCounts.funscript,
    };
    const options: Array<{ id: MediaFilter; label: string }> = [
      { id: "all", label: "All" },
      { id: "vr", label: "VR" },
      { id: "flat", label: "2D" },
      { id: "funscript", label: "FS" },
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
      // Bold label + lighter count, measured and centred as a single unit so
      // the pair stays balanced in the narrow 4-button row.
      const n = counts[opt.id];
      const cy = CONTENT_Y0 + MEDIA_H / 2 + 1;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = "700 18px sans-serif";
      const labelW = ctx.measureText(opt.label).width;
      const countStr = n > 0 ? `${n}` : "";
      ctx.font = "400 13px sans-serif";
      const countW = countStr ? ctx.measureText(countStr).width + 6 : 0;
      const tx = bx + MEDIA_BTN_W / 2 - (labelW + countW) / 2;
      ctx.font = "700 18px sans-serif";
      ctx.fillStyle = active ? "#05111f" : "rgba(255,255,255,0.88)";
      ctx.fillText(opt.label, tx, cy);
      if (countStr) {
        ctx.font = "400 13px sans-serif";
        ctx.fillStyle = active
          ? "rgba(5,17,31,0.70)"
          : "rgba(255,255,255,0.50)";
        ctx.fillText(countStr, tx + labelW + 6, cy);
      }
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
      this.regions.push({
        id: `tab:${t.id}`,
        x: tx,
        y: TAB_Y,
        w: tabW,
        h: TAB_H,
      });
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
      this.contentMode === "galleries" ? "All galleries" : "All scenes",
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

  /** Sort-mode chips: Recent / Rating / A–Z */
  private drawSortChips() {
    const { ctx } = this;
    const chips: Array<{ id: SortMode; label: string }> = [
      { id: "recent", label: "Recent" },
      { id: "rating", label: "Rating" },
      { id: "title", label: "A–Z" },
    ];
    const chipW = Math.floor(
      (RAIL_INNER - 5 * (chips.length - 1)) / chips.length
    );
    let cx = RAIL_PAD;
    for (const chip of chips) {
      const active = this.sortMode === chip.id;
      const hovered = this.hoveredId === `sort:${chip.id}`;
      this.roundRect(cx, SORT_Y, chipW, SORT_H, SORT_H / 2);
      ctx.fillStyle = active
        ? `${ACCENT}0.18)`
        : hovered
        ? "rgba(255,255,255,0.12)"
        : "rgba(255,255,255,0.05)";
      ctx.fill();
      if (active) {
        this.roundRect(cx, SORT_Y, chipW, SORT_H, SORT_H / 2);
        ctx.strokeStyle = `${ACCENT}0.65)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.font = "500 15px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = active ? `${ACCENT}0.95)` : "rgba(255,255,255,0.70)";
      ctx.fillText(chip.label, cx + chipW / 2, SORT_Y + SORT_H / 2 + 1);
      this.regions.push({
        id: `sort:${chip.id}`,
        x: cx,
        y: SORT_Y,
        w: chipW,
        h: SORT_H,
      });
      cx += chipW + 5;
    }
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
    this.railMaxScroll = Math.max(0, totalH - (RAIL_VIEW_Y1 - RAIL_VIEW_Y0));
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

      // Image area — studios use contain (logos must not be cropped),
      // performers use cover (portrait fills nicely).
      const img = this.image(it.imageUrl);
      ctx.save();
      this.roundRect(tileX, tileY, TILE_W, imgH, 12);
      ctx.clip();
      if (img) {
        if (isStudio) {
          this.drawImageContain(
            img,
            tileX,
            tileY,
            TILE_W,
            imgH,
            0,
            "rgba(255,255,255,0.04)"
          );
        } else {
          this.drawImageCover(img, tileX, tileY, TILE_W, imgH, 0);
        }
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
      ctx.fillStyle = active ? `${ACCENT}0.95)` : "rgba(255,255,255,0.92)";
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
      RAIL_VIEW_Y0 + (viewH - thumbH) * (this.railScroll / this.railMaxScroll);
    ctx.fillStyle = `${ACCENT}0.6)`;
    ctx.fillRect(trackX, thumbY, 3, thumbH);
  }

  // ── Scene grid ─────────────────────────────────────────────────────────────

  private drawPageCards(
    pageIndex: number,
    xShift: number,
    interactive: boolean
  ) {
    if (this.contentMode === "galleries") {
      this.drawGalleryPageCards(pageIndex, xShift, interactive);
      return;
    }
    const items = this.pageCache.get(pageIndex);
    if (!items) {
      // Page not fetched yet — draw placeholder skeletons (ensurePagesLoaded
      // has already queued the request). How many slots this page holds is
      // known from the total count.
      const slots = Math.min(
        PER_PAGE,
        Math.max(0, this.totalCount - pageIndex * PER_PAGE)
      );
      // Before the total is known, fill a full page of skeletons.
      const n = this.loaded ? slots : PER_PAGE;
      for (let i = 0; i < n; i++) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = GRID_X0 + col * (CARD_W + GAP_X) + xShift;
        const y = GRID_TOP + row * (CARD_H + GAP_Y);
        this.drawSkeletonCard(x, y);
      }
      return;
    }
    for (let i = 0; i < items.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = GRID_X0 + col * (CARD_W + GAP_X) + xShift;
      const y = GRID_TOP + row * (CARD_H + GAP_Y);
      this.drawCard(items[i], x, y, interactive);
    }
  }

  private drawGalleryPageCards(
    pageIndex: number,
    xShift: number,
    interactive: boolean
  ) {
    const items = this.galleryPageCache.get(pageIndex);
    const slots = Math.min(
      PER_PAGE,
      Math.max(0, this.galleryTotal - pageIndex * PER_PAGE)
    );
    const n = items ? items.length : this.galleryLoaded ? slots : PER_PAGE;

    // Gather entries with aspect ratios for row-packing.
    const entries: Array<{
      entry: IVRGalleryEntry | undefined;
      aspect: number;
    }> = [];
    for (let i = 0; i < n; i++) {
      const entry = items?.[i];
      let aspect = GAL_DEF_ASPECT;
      if (entry) {
        const img = this.image(entry.coverUrl);
        if (img && img.naturalWidth > 0) {
          aspect = Math.max(img.naturalWidth / img.naturalHeight, 0.25);
        }
      }
      entries.push({ entry, aspect });
    }

    // Greedy row-packing: add cards until overflow, then justify.
    let y = GRID_Y0;
    for (let i = 0; i < entries.length; ) {
      let totalAspect = entries[i].aspect;
      let rowEnd = i + 1;
      while (rowEnd < entries.length) {
        const testAspect = totalAspect + entries[rowEnd].aspect;
        const testW =
          testAspect * GAL_TARGET_H + GAL_GAP * (rowEnd - i);
        if (rowEnd - i === 1 || testW <= GRID_W) {
          totalAspect = testAspect;
          rowEnd++;
        } else {
          break;
        }
      }

      const availW = GRID_W - GAL_GAP * (rowEnd - i - 1);
      const coverH = Math.max(80, Math.min(400, availW / totalAspect));
      const cardH = coverH + GAL_CAP_H;

      let ix = GRID_X0 + xShift;
      for (let j = i; j < rowEnd; j++) {
        const item = entries[j];
        const iw = item.aspect * coverH;
        if (item.entry) {
          this.drawGalleryCard(item.entry, ix, y, iw, coverH, interactive);
        } else {
          this.drawSkeletonCard(ix, y, iw, coverH);
        }
        ix += iw + GAL_GAP;
      }

      y += cardH + GAL_GAP;
      i = rowEnd;
    }
  }

  /** Placeholder card shown while a page is still loading from the server. */
  private drawSkeletonCard(x: number, y: number, w?: number, coverH?: number) {
    const { ctx } = this;
    const cw = w ?? CARD_W;
    const ch = coverH ?? THUMB_H;
    this.roundRect(x, y, cw, ch, 14);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();
    this.roundRect(x + 10, y + ch + 14, cw * 0.62, 16, 6);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
    this.roundRect(x + 10, y + ch + 40, cw * 0.4, 13, 6);
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fill();
  }

  /**
   * Settings gear — opens an in-place preferences modal (gaze-launch toggle +
   * delay, audio on/off). Sits top-left where the old Shuffle button lived.
   */
  private drawSettingsButton() {
    const { ctx } = this;
    const w = 150;
    const h = 44;
    const x = PAD;
    const y = 26;
    const open = this.settingsOpen;
    const hovered = this.hoveredId === "settings";
    this.roundRect(x, y, w, h, h / 2);
    ctx.fillStyle = open || hovered ? `${ACCENT}0.92)` : `${ACCENT}0.18)`;
    ctx.fill();
    this.roundRect(x, y, w, h, h / 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = open || hovered ? `${ACCENT}0.7)` : `${ACCENT}0.5)`;
    ctx.stroke();
    ctx.font = "600 19px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = open || hovered ? "#06121f" : `${ACCENT}0.95)`;
    ctx.fillText("⚙  Settings", x + w / 2, y + h / 2 + 1);
    this.regions.push({ id: "settings", x, y, w, h });
  }

  /** Scenes | Galleries segmented toggle (header, between Settings and the logo). */
  private drawModeToggle() {
    const { ctx } = this;
    const options: Array<{ id: ContentMode; label: string }> = [
      { id: "scenes", label: "Scenes" },
      { id: "galleries", label: "Galleries" },
    ];
    let bx = MODE_X;
    for (const opt of options) {
      const active = this.contentMode === opt.id;
      const hovered = this.hoveredId === `mode:${opt.id}`;
      this.roundRect(bx, MODE_Y, MODE_BTN_W, MODE_H, MODE_H / 2);
      if (active) {
        const g = ctx.createLinearGradient(bx, MODE_Y, bx, MODE_Y + MODE_H);
        g.addColorStop(0, "rgba(130,190,255,0.95)");
        g.addColorStop(1, "rgba(70,130,230,0.85)");
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = hovered
          ? "rgba(255,255,255,0.16)"
          : "rgba(255,255,255,0.07)";
      }
      ctx.fill();
      ctx.font = "700 20px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = active ? "#06121f" : "rgba(255,255,255,0.88)";
      ctx.fillText(opt.label, bx + MODE_BTN_W / 2, MODE_Y + MODE_H / 2 + 1);
      this.regions.push({
        id: `mode:${opt.id}`,
        x: bx,
        y: MODE_Y,
        w: MODE_BTN_W,
        h: MODE_H,
      });
      bx += MODE_BTN_W + MODE_GAP;
    }
  }

  /**
   * Modal preferences panel drawn over the dimmed wall. Controls:
   *  • Auto-launch on gaze (on/off) + the dwell delay (1.5 / 2.5 / 4 s)
   *  • Play sound on launch (on/off)
   * Control regions are pushed first so they win over the full-canvas backdrop
   * region (pushed last) that closes the modal on an outside tap.
   */
  private drawSettingsOverlay() {
    const { ctx } = this;

    // Dim the whole wall behind the modal.
    ctx.fillStyle = "rgba(4,6,12,0.72)";
    ctx.fillRect(0, 0, this.cw, this.ch);

    const mW = 760;
    const mH = 520;
    const mX = (this.cw - mW) / 2;
    const mY = (this.ch - mH) / 2;

    this.roundRect(mX, mY, mW, mH, 24);
    const g = ctx.createLinearGradient(mX, mY, mX, mY + mH);
    g.addColorStop(0, "rgba(30,32,44,0.98)");
    g.addColorStop(1, "rgba(14,15,22,0.98)");
    ctx.fillStyle = g;
    ctx.fill();
    this.roundRect(mX, mY, mW, mH, 24);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.stroke();

    // Title
    ctx.font = "700 30px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText("Settings", mX + 36, mY + 56);

    // Close (✕) button — top-right of the modal.
    const clW = 44;
    const clX = mX + mW - clW - 24;
    const clY = mY + 22;
    const clHover = this.hoveredId === "settingsClose";
    this.roundRect(clX, clY, clW, clW, clW / 2);
    ctx.fillStyle = clHover ? "rgba(220,72,72,0.92)" : "rgba(255,255,255,0.08)";
    ctx.fill();
    ctx.font = "600 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = clHover ? "#fff" : "rgba(255,255,255,0.8)";
    ctx.fillText("✕", clX + clW / 2, clY + clW / 2 + 1);
    this.regions.push({ id: "settingsClose", x: clX, y: clY, w: clW, h: clW });

    const rowX = mX + 36;
    const rowW = mW - 72;
    let rowY = mY + 104;

    // ── Row 1: Auto-launch on gaze toggle ───────────────────────────────────
    this.drawSettingRow(
      rowX,
      rowY,
      rowW,
      "Auto-launch on gaze",
      "Look at a card to start it automatically",
      this.hoverLaunch,
      "set:hoverLaunch"
    );
    rowY += 96;

    // ── Dwell-delay chips (only meaningful when auto-launch is on) ───────────
    ctx.font = "500 19px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = this.hoverLaunch
      ? "rgba(255,255,255,0.72)"
      : "rgba(255,255,255,0.32)";
    ctx.fillText("Gaze delay", rowX, rowY + 22);

    const chipW = 120;
    const chipH = 44;
    const chipGap = 12;
    let chipX = rowX + rowW - (chipW * 3 + chipGap * 2);
    for (const ms of DWELL_TIME_OPTIONS) {
      const active = this.dwellMs === ms;
      const hovered = this.hoveredId === `dwell:${ms}`;
      const enabled = this.hoverLaunch;
      this.roundRect(chipX, rowY, chipW, chipH, chipH / 2);
      ctx.fillStyle = !enabled
        ? "rgba(255,255,255,0.04)"
        : active
        ? `${ACCENT}0.85)`
        : hovered
        ? "rgba(255,255,255,0.16)"
        : "rgba(255,255,255,0.07)";
      ctx.fill();
      ctx.font = "600 19px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = !enabled
        ? "rgba(255,255,255,0.3)"
        : active
        ? "#06121f"
        : "rgba(255,255,255,0.85)";
      ctx.fillText(
        `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)}s`,
        chipX + chipW / 2,
        rowY + chipH / 2 + 1
      );
      if (enabled) {
        this.regions.push({
          id: `dwell:${ms}`,
          x: chipX,
          y: rowY,
          w: chipW,
          h: chipH,
        });
      }
      chipX += chipW + chipGap;
    }
    rowY += 88;

    // Divider
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rowX, rowY);
    ctx.lineTo(rowX + rowW, rowY);
    ctx.stroke();
    rowY += 24;

    // ── Row 2: Sound on launch toggle ───────────────────────────────────────
    this.drawSettingRow(
      rowX,
      rowY,
      rowW,
      "Play sound on launch",
      "Start scenes with audio (off = muted)",
      this.soundOnPlay,
      "set:soundOnPlay"
    );

    // Backdrop region (pushed LAST so the controls above win the hit test).
    this.regions.push({
      id: "settingsClose",
      x: 0,
      y: 0,
      w: this.cw,
      h: this.ch,
    });
  }

  /** One labelled toggle row with a pill switch on the right. */
  private drawSettingRow(
    x: number,
    y: number,
    w: number,
    label: string,
    sub: string,
    on: boolean,
    id: string
  ) {
    const { ctx } = this;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "600 23px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(label, x, y + 24);
    ctx.font = "400 17px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(sub, x, y + 50);

    // Pill switch
    const swW = 72;
    const swH = 38;
    const swX = x + w - swW;
    const swY = y + 6;
    const hovered = this.hoveredId === id;
    this.roundRect(swX, swY, swW, swH, swH / 2);
    ctx.fillStyle = on ? `${ACCENT}0.85)` : "rgba(255,255,255,0.14)";
    ctx.fill();
    if (hovered) {
      this.roundRect(swX, swY, swW, swH, swH / 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.stroke();
    }
    const knobR = swH / 2 - 5;
    const knobX = on ? swX + swW - knobR - 5 : swX + knobR + 5;
    ctx.beginPath();
    ctx.arc(knobX, swY + swH / 2, knobR, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    this.regions.push({ id, x: swX, y: swY, w: swW, h: swH });
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
      let sx = 0,
        sy = 0,
        sw = videoEl.videoWidth,
        sh = videoEl.videoHeight;
      if (vr > cr) {
        sw = sh * cr;
        sx = (videoEl.videoWidth - sw) / 2;
      } else {
        sh = sw / cr;
        sy = (videoEl.videoHeight - sh) / 2;
      }
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

    // Resume progress bar — thin accent line at the very bottom of the thumbnail
    // showing how far the user got last time.
    const rt = scene.resumeTime ?? 0;
    const dur = scene.durationSecs ?? 0;
    if (rt > 30 && dur > 0) {
      const frac = Math.min(1, rt / dur);
      ctx.fillStyle = "rgba(0,0,0,0.50)";
      ctx.fillRect(x, y + THUMB_H - 4, CARD_W, 4);
      ctx.fillStyle = `${ACCENT}0.95)`;
      ctx.fillRect(x, y + THUMB_H - 4, CARD_W * frac, 4);
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
      const bw = 104,
        bh = 26;
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
      const bw = 42,
        bh = 22;
      const bx = x + CARD_W - bw - 10;
      const by = y + (isPlaying ? 44 : 10);
      this.roundRect(bx, by, bw, bh, bh / 2);
      ctx.fillStyle = `${ORANGE}0.92)`;
      ctx.fill();
      ctx.font = "700 13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(20,8,0,0.96)";
      ctx.fillText("FS", bx + bw / 2, by + bh / 2 + 1);
    }

    // Hover metadata pills — duration, resolution, rating — shown in lower-left
    // of the thumbnail when the card is hovered.
    if (hovered) {
      const pills: string[] = [];
      if (dur > 0) {
        const totalMins = Math.round(dur / 60);
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        pills.push(h > 0 ? `${h}h ${m}m` : `${m}m`);
      }
      if (scene.height) {
        const res =
          scene.height >= 2160
            ? "4K"
            : scene.height >= 1440
            ? "2K"
            : scene.height >= 1080
            ? "FHD"
            : scene.height >= 720
            ? "HD"
            : `${scene.height}p`;
        pills.push(res);
      }
      if (scene.rating) {
        pills.push(`★ ${(scene.rating / 20).toFixed(1)}`);
      }
      if (pills.length > 0) {
        ctx.font = "600 13px sans-serif";
        let pillX = x + 10;
        const pillY = y + THUMB_H - 32;
        const pillH = 22;
        for (const pill of pills) {
          const pillW = ctx.measureText(pill).width + 14;
          this.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
          ctx.fillStyle = "rgba(5,10,20,0.82)";
          ctx.fill();
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "rgba(255,255,255,0.95)";
          ctx.fillText(pill, pillX + pillW / 2, pillY + pillH / 2 + 1);
          pillX += pillW + 5;
        }
      }
    }

    // Gaze-dwell arc — radial fill countdown that fires auto-launch when full.
    const dwellFrac = interactive ? this.getDwellFrac(scene.id) : 0;
    if (dwellFrac > 0) {
      const arcCx = x + CARD_W / 2;
      const arcCy = y + THUMB_H / 2;
      const arcR = 30;
      ctx.save();
      ctx.beginPath();
      ctx.arc(arcCx, arcCy, arcR + 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.52)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(
        arcCx,
        arcCy,
        arcR,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * dwellFrac
      );
      ctx.lineWidth = 5;
      ctx.strokeStyle = `${ACCENT}0.95)`;
      ctx.stroke();
      ctx.font = "700 24px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText("▶", arcCx + 2, arcCy + 1);
      ctx.restore();
    }

    // Hover / playing border
    if (isPlaying || hovered) {
      this.roundRect(x, y, CARD_W, CARD_H, R);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = isPlaying ? `${GOLD}0.85)` : `${ACCENT}0.75)`;
      ctx.stroke();
    }

    if (interactive) {
      this.regions.push({
        id: `scene:${scene.id}`,
        x,
        y,
        w: CARD_W,
        h: CARD_H,
      });
      if (hovered && this.previewVideo) this.markDirty();
    }
  }

  /** A gallery cover tile in the Galleries grid (parallels drawCard for scenes). */
  private drawGalleryCard(
    gallery: IVRGalleryEntry,
    x: number,
    y: number,
    w: number,
    coverH: number,
    interactive: boolean
  ) {
    const cardH = coverH + GAL_CAP_H;
    const { ctx } = this;
    const hovered = interactive && this.hoveredId === `gallery:${gallery.id}`;
    const R = 14;

    ctx.save();
    this.roundRect(x, y, w, cardH, R);
    ctx.clip();

    // Cover thumbnail.
    const img = this.image(gallery.coverUrl);
    if (img) {
      this.drawImageCover(img, x, y, w, coverH, 0);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(x, y, w, coverH);
      // Folder glyph placeholder when there's no cover.
      ctx.font = "300 56px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillText("🖼", x + w / 2, y + coverH / 2);
    }

    // Caption bar.
    ctx.fillStyle = "rgba(12,12,17,0.94)";
    ctx.fillRect(x, y + coverH, w, GAL_CAP_H);
    ctx.restore();

    // Title + studio text.
    const textX = x + 16;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "600 21px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(
      this.fitText(gallery.title || `Gallery ${gallery.id}`, w - 32),
      textX,
      y + coverH + (gallery.studioName ? 33 : 49)
    );
    if (gallery.studioName) {
      ctx.font = "400 16px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(
        this.fitText(gallery.studioName, w - 32),
        textX,
        y + coverH + 60
      );
    }

    // Image-count badge (top-right of the cover).
    {
      const label = `${gallery.imageCount} ${
        gallery.imageCount === 1 ? "image" : "images"
      }`;
      ctx.font = "700 14px sans-serif";
      const bw = ctx.measureText(label).width + 22;
      const bh = 26;
      const bx = x + w - bw - 10;
      const by = y + 10;
      this.roundRect(bx, by, bw, bh, bh / 2);
      ctx.fillStyle = "rgba(5,10,20,0.78)";
      ctx.fill();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText(label, bx + bw / 2, by + bh / 2 + 1);
    }

    // Rating pill (lower-left of the cover) when present.
    if (gallery.rating) {
      const label = `★ ${(gallery.rating / 20).toFixed(1)}`;
      ctx.font = "600 13px sans-serif";
      const pw = ctx.measureText(label).width + 14;
      const ph = 22;
      const px = x + 10;
      const py = y + coverH - 32;
      this.roundRect(px, py, pw, ph, ph / 2);
      ctx.fillStyle = "rgba(5,10,20,0.82)";
      ctx.fill();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = `${GOLD}0.95)`;
      ctx.fillText(label, px + pw / 2, py + ph / 2 + 1);
    }

    // Gaze-dwell arc — opens the gallery viewer when full.
    const dwellFrac = interactive ? this.getDwellFrac(gallery.id) : 0;
    if (dwellFrac > 0) {
      const arcCx = x + w / 2;
      const arcCy = y + coverH / 2;
      const arcR = 30;
      ctx.save();
      ctx.beginPath();
      ctx.arc(arcCx, arcCy, arcR + 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.52)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(
        arcCx,
        arcCy,
        arcR,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * dwellFrac
      );
      ctx.lineWidth = 5;
      ctx.strokeStyle = `${ACCENT}0.95)`;
      ctx.stroke();
      ctx.font = "700 22px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText("⊞", arcCx, arcCy + 1);
      ctx.restore();
    }

    // Hover border.
    if (hovered) {
      this.roundRect(x, y, w, cardH, R);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `${ACCENT}0.75)`;
      ctx.stroke();
    }

    if (interactive) {
      this.regions.push({
        id: `gallery:${gallery.id}`,
        x,
        y,
        w,
        h: cardH,
      });
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
        this.regions.push({
          id,
          x,
          y: cy - PAGER_H / 2,
          w: arrowW,
          h: PAGER_H,
        });
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
