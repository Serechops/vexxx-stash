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
  IVRGroupEntry,
  VRContentMode,
  VRMediaFilter,
  VRSortMode,
  VR_SCENE_GRID_COLS,
  VR_SCENE_GRID_ROWS,
  VR_GROUP_GRID_COLS,
  VR_GROUP_GRID_ROWS,
  VR_GALLERY_PAGE_SIZE,
} from "./types";
import { VRCanvasPanel, IPanelRegion } from "./VRInfoPanels";
import { IVRSceneEntry } from "./VRScenesPanel";
import { faptapFavorites } from "./faptapLibrary";
import { pmvhavenFavorites } from "./pmvhavenLibrary";
import { VRT } from "./vrTheme";

export type { IVRFilterEntry };

// ── Canvas / panel dimensions ─────────────────────────────────────────────────
// A wide cinematic wall: 4.4 m of arc at 2.65 m radius wraps ~95° around the
// viewer. Canvas dimensions scale with the physical size so pixel density
// stays ~650 px/m and text keeps its crispness. The wall stands ~2.4 m tall
// (three scene-card rows), extending symmetrically around eye level.
const CANVAS_W = 2880;
const CANVAS_H = 1560;
const PANEL_WIDTH_M = 4.4;
const PANEL_RADIUS = 2.65;

// ── Shared layout ─────────────────────────────────────────────────────────────
const PAD = 40;
const TITLE_Y = 58;
const LOGO_CY = 50; // vertical centre of the enlarged header logo
const SUB_Y = 110; // pushed down to clear the larger logo
const CONTENT_Y0 = 132; // top of all content rows

// ── Filter rail (left 620 px) ─────────────────────────────────────────────────
// Widened from 540px: at the old width the rail had shrunk to ~18.75% of the
// (now much wider) canvas, next to grid cards that grew — studio/performer
// tiles read as a cramped strip. 620px restores it to ~21.5%, closer to the
// original 24.5% balance, at the cost of ~3.6% narrower grid cards.
const RAIL_W = 620;
const RAIL_PAD = 28;
const RAIL_INNER = RAIL_W - RAIL_PAD * 2; // 564

// Media-type toggle row ( [All] [VR] [2D] [FS] )
const MEDIA_H = 46;
const MEDIA_BTN_COUNT = 4;
const MEDIA_BTN_GAP = 8;
const MEDIA_BTN_W = Math.floor(
  (RAIL_INNER - MEDIA_BTN_GAP * (MEDIA_BTN_COUNT - 1)) / MEDIA_BTN_COUNT
); // 135

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
const RAIL_VIEW_Y1 = CANVAS_H - 68; // 1492

// 2-column tile grid within the rail
const TILE_COLS = 2;
const TILE_GAP_X = 12;
const TILE_GAP_Y = 12;
const TILE_W = Math.floor(
  (RAIL_INNER - TILE_GAP_X * (TILE_COLS - 1)) / TILE_COLS
); // 276

const STUDIO_IMG_H = Math.round((TILE_W * 9) / 16); // 155 — landscape logo
const STUDIO_LABEL_H = 28;
const STUDIO_TILE_H = STUDIO_IMG_H + STUDIO_LABEL_H; // 183
const STUDIO_ROW_H = STUDIO_TILE_H + TILE_GAP_Y; // 195

const PERF_IMG_H = Math.round((TILE_W * 3) / 2); // 414 — tall portrait
const PERF_LABEL_H = 28;
const PERF_TILE_H = PERF_IMG_H + PERF_LABEL_H; // 442
const PERF_ROW_H = PERF_TILE_H + TILE_GAP_Y; // 454

// ── Scene grid (right side) ───────────────────────────────────────────────────
const GRID_X0 = RAIL_W + 28;
const GRID_RIGHT = CANVAS_W - PAD;
const GRID_W = GRID_RIGHT - GRID_X0; // 2192
// Scene cards: 4 × 3 = 12 per page. Col/row counts live in types.ts so the
// data sources' fetch page size can't drift from the layout. Card width gave
// up ~20px (≈550→≈530) to the widened filter rail — still comfortably larger
// than the pre-redesign 3-across layout.
const COLS = VR_SCENE_GRID_COLS;
const ROWS = VR_SCENE_GRID_ROWS;
const PER_PAGE = COLS * ROWS; // 12 — scene grid (Scenes mode + movie detail)
const GAP_X = 24;
const GAP_Y = 20;
const CARD_W = Math.floor((GRID_W - GAP_X * (COLS - 1)) / COLS); // ≈530
const THUMB_H = Math.round((CARD_W * 9) / 16); // ≈298
const CAP_H = 104; // title + studio + tag-chip row
const CARD_H = THUMB_H + CAP_H; // ≈402
const GRID_Y0 = CONTENT_Y0;
const GRID_Y1 = CANVAS_H - 90; // 1470
const GRID_BLOCK_H = ROWS * CARD_H + (ROWS - 1) * GAP_Y; // ≈1246
const GRID_TOP = GRID_Y0 + Math.max(0, (GRID_Y1 - GRID_Y0 - GRID_BLOCK_H) / 2); // ≈178
const PAGER_Y = CANVAS_H - 45; // 1515
const PAGER_H = 44;

// Gallery justified-row layout — galleries are packed greedily by cover-aspect
// ratio so each row fills GRID_W. The card height varies per row (cover area +
// fixed caption bar). Separate from the scene fixed grid constants above.
const GAL_TARGET_H = 210;   // target cover height before justification
const GAL_GAP = 16;          // horizontal + vertical gap between cards
const GAL_CAP_H = 78;       // caption bar height
const GAL_DEF_ASPECT = 16 / 9;
// Galleries page independently of the (smaller) scene grid. Page size lives
// in types.ts (justified-row layout has no fixed col/row count to derive it
// from) alongside the scene/group grid contracts.
const GALLERY_PER_PAGE = VR_GALLERY_PAGE_SIZE;

// Movie (group) poster grid — portrait 2:3 posters, 8 cols × 3 rows = 24/page.
// Shares the right-hand grid region with the scene grid; a drilled-in movie
// swaps back to the scene-card grid. Col/row counts live in types.ts alongside
// the scene grid's so vrGroupLibrary's page size stays in lockstep. The
// widened filter rail narrowed GRID_W further (≈266px→≈256px cards), which
// freed up vertical slack (narrower 2:3 cards are also shorter) — put back
// into a less-cramped caption bar than the first 8×3 pass (36px→44px).
const POSTER_COLS = VR_GROUP_GRID_COLS;
const POSTER_GAP_X = 20;
const POSTER_GAP_Y = 20;
const POSTER_CAP_H = 44;
const POSTER_CARD_W = Math.floor(
  (GRID_W - POSTER_GAP_X * (POSTER_COLS - 1)) / POSTER_COLS
); // ≈256
const POSTER_IMG_H = Math.round((POSTER_CARD_W * 3) / 2); // 2:3 portrait poster
const POSTER_CARD_H = POSTER_IMG_H + POSTER_CAP_H;
const POSTER_ROWS = VR_GROUP_GRID_ROWS;
const POSTER_BLOCK_H =
  POSTER_ROWS * POSTER_CARD_H + (POSTER_ROWS - 1) * POSTER_GAP_Y;
const POSTER_TOP =
  GRID_Y0 + Math.max(0, (GRID_Y1 - GRID_Y0 - POSTER_BLOCK_H) / 2);

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
// Settings (40–190) + help "?" (202–246) sit to the left; start the mode
// toggle well clear of them so it doesn't crowd/overlap the help button.
const MODE_X = 280;
const MODE_Y = 26;
const MODE_H = 46;
const MODE_BTN_W = 165;
const MODE_GAP = 8;

// ── Search pill — header, between the logo and the Exit pill ─────────────────
const SEARCH_W = 360;
const SEARCH_H = 44;
const SEARCH_Y = 26;
// Matches drawExitButton's geometry (132 wide at cw − PAD).
const SEARCH_EXIT_W = 132;
const SEARCH_EXIT_GAP = 16;

// ── Colours ───────────────────────────────────────────────────────────────────
// Prefix constants (not full VRT tokens) so every call site below can compose
// its own one-off alpha via `${ACCENT}0.42)` — VRT's fixed-alpha tokens don't
// cover all of them. Deriving from VRT.accentRGB/goldRGB (rather than
// hardcoding the hue again) is what keeps this file from drifting out of sync
// with the shared theme.
const ACCENT = `rgba(${VRT.accentRGB},`;
const GOLD = `rgba(${VRT.goldRGB},`;
const ORANGE = "rgba(250,140,30,";

type FilterTab = "studios" | "performers";
type MediaFilter = VRMediaFilter;
type SortMode = VRSortMode;
type ContentMode = VRContentMode;

const ONBOARDING_SEEN_KEY = "vrOnboardingSeen";

/** Has the one-time controls onboarding already been dismissed on this device? */
function loadOnboardingSeen(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveOnboardingSeen() {
  try {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

interface IOnboardingCard {
  icon: string;
  title: string;
  body: string;
}
interface IOnboardingPage {
  heading: string;
  sub: string;
  cards: IOnboardingCard[];
}

/**
 * One-time onboarding content — page 1 is the gesture legend (recenter /
 * look-around / tap-vs-drag), page 2 walks through the player features that
 * aren't otherwise self-evident from the control bar (captions, interactive
 * scripts, chapters/looping, comfort). Reopenable any time via the "?" button.
 */
const ONBOARDING_PAGES: IOnboardingPage[] = [
  {
    heading: "Welcome to VR",
    sub: "A few controls before you dive in",
    cards: [
      {
        icon: "◎",
        title: "Recenter",
        body: "Give the grip button a quick squeeze while pointing at empty space to reset your view forward.",
      },
      {
        icon: "↻",
        title: "Look around",
        body: "Hold the grip button and move the controller to grab and rotate the video around you.",
      },
      {
        icon: "⇥",
        title: "Tap vs. drag",
        body: "A quick trigger press selects. Press and move before releasing to drag — scroll a strip, adjust a slider.",
      },
    ],
  },
  {
    heading: "Know the features",
    sub: "A quick tour of what's built in",
    cards: [
      {
        icon: "CC",
        title: "Captions",
        body: "Tap CC on the control bar to cycle through every subtitle track, then off again.",
      },
      {
        icon: "▶",
        title: "Interactive scripts",
        body: "Scenes with more than one script let you pick from the Handy panel — your choice is remembered next time you open the scene.",
      },
      {
        icon: "⟳",
        title: "Chapters & looping",
        body: "Jump between chapter markers from the control bar. Tap A/B twice to loop a custom segment, or Loop to repeat the whole scene.",
      },
      {
        icon: "◐",
        title: "Comfort vignette",
        body: "Feeling queasy while looking around or zooming? Turn on Comfort vignette in Settings to dim your peripheral vision.",
      },
    ],
  },
];

/** Which of the wall's four paged grids a page-fetch error belongs to. */
export type VRHomeGridKind = "scenes" | "galleries" | "groups" | "groupScenes";

export class VRHomePanel extends VRCanvasPanel {
  // Server-paged grid: only the current page (+ prefetched neighbours) are held
  // in memory at once. `pageCache` maps an absolute page index → up to PER_PAGE
  // card entries; `totalCount` (from the server) drives the page geometry.
  private pageCache = new Map<number, IVRSceneEntry[]>();
  private requestedPages = new Set<number>();
  // Pages whose fetch failed, keyed "<grid>:<pageIndex>". Errored pages are
  // excluded from ensurePagesLoaded's auto-pump (so a dead server isn't
  // hammered once per draw) and render as a tap-to-retry card instead of
  // skeletons that never resolve.
  private pageErrors = new Set<string>();
  private loadedFlat: IVRSceneEntry[] = []; // flattened cached pages (hover-preview lookup)
  private totalCount = 0;
  private loaded = false; // first page/total has arrived (distinguishes loading vs empty)
  private pageRequester: ((pageIndex: number) => void) | null = null;
  private currentSceneId: string | null = null;
  private previewVideo: HTMLVideoElement | null = null;
  private filterLabel: string | null = null;
  private sortMode: SortMode = "recent";
  // Live free-text search (typed on the system keyboard), mirrored from the
  // manager so the pill + subtitle track keystrokes as they arrive.
  private searchText: string | null = null;

  // Content mode: the wall shows either the scene grid or the gallery grid. The
  // page-slide state (page/offset/anim) and the rail are shared — only one grid
  // is visible at a time, so switching modes resets the page window.
  private contentMode: ContentMode = "scenes";
  // Whether the premium FapTap sidecar catalog is available (its database is
  // present). When false the FapTap mode tab renders locked and is non-selectable.
  private faptapAvailable = false;
  // Whether the premium PMVHaven sidecar catalog is available (its database is
  // present). When false the PMVHaven mode tab renders locked and non-selectable.
  private pmvhavenAvailable = false;
  // Server-paged gallery grid (parallels the scene pageCache above).
  private galleryPageCache = new Map<number, IVRGalleryEntry[]>();
  private galleryRequestedPages = new Set<number>();
  private galleryTotal = 0;
  private galleryLoaded = false;
  private galleryPageRequester: ((pageIndex: number) => void) | null = null;

  // Movies (groups) mode. Two layers on the same wall: a poster grid of groups,
  // and — once a movie is drilled into via `activeGroupId` — that group's scenes
  // rendered with the *same* scene cards as the Scenes grid. Both are server-
  // paged; the scene layer parallels the scene `pageCache`/`totalCount` above.
  private groupPageCache = new Map<number, IVRGroupEntry[]>();
  private groupRequestedPages = new Set<number>();
  private groupTotal = 0;
  private groupLoaded = false;
  private groupPageRequester: ((pageIndex: number) => void) | null = null;
  private activeGroupId: string | null = null;
  private activeGroupTitle: string | null = null;
  private activeGroupPosterUrl: string | null = null;
  private activeGroupBackUrl: string | null = null;
  private groupScenePageCache = new Map<number, IVRSceneEntry[]>();
  private groupSceneRequestedPages = new Set<number>();
  private groupSceneTotal = 0;
  private groupSceneLoaded = false;
  private groupScenePageRequester: ((pageIndex: number) => void) | null = null;

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
  private uiSfx = true;
  private passthroughHome = false;
  private comfortVignette = false;
  private controllerLock = false;
  // Whether the live session can composite camera passthrough at all
  // (immersive-ar). Gates the settings row — runtime capability, not a pref.
  private passthroughSupported = false;
  private settingsOpen = false;

  // One-time controls legend (recenter / look-around / tap-vs-drag) followed
  // by a feature walkthrough page. Opens automatically the first time this
  // device shows the Home wall; reopenable any time via the "?" help button
  // next to the settings gear (always restarts on page 0).
  private onboardingOpen = false;
  private onboardingPage = 0;

  // Thumbstick nav edge-trigger arms (reset when stick returns to centre).
  private lobbyHArmed = true;
  private lobbyVArmed = true;

  // Grid page-slide (0 = settled, +1 = next page animating, −1 = prev)
  private page = 0;
  private offset = 0;
  private animFrom = 0;
  private animTo = 0;
  private animStart = 0;

  // Pager-track scrubbing (libraries with >12 pages): press on the track and
  // drag to preview a target page; release jumps straight to it. Fetches only
  // happen on release, so sweeping across hundreds of pages costs nothing.
  private scrubbing = false;
  private scrubX0 = 0;
  private scrubW = 0;
  private scrubPreview = 0;

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
    this.onboardingOpen = !loadOnboardingSeen();
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
    this.clearPageErrors("scenes");
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
    this.prefetchSceneThumbs(pageIndex, scenes);
    this.markDirty();
  }

  /**
   * Warm the image cache for a page that is NOT on screen. Pages arrive via
   * ensurePagesLoaded's current±1 prefetch; decoding their thumbnails now (off
   * the render thread, no redraw) means a page-flip paints complete instead of
   * popping in card by card. The on-screen page skips this — its cards go
   * through image() during draw anyway.
   */
  private prefetchSceneThumbs(pageIndex: number, scenes: IVRSceneEntry[]) {
    if (pageIndex === this.page) return;
    for (const s of scenes) {
      this.prefetchImage(s.thumbnailUrl);
      this.prefetchImage(s.heatmapUrl ?? null);
    }
  }

  /**
   * Mark a page fetch as failed (called by the manager when the library
   * rejects). Clears the in-flight mark so a retry tap can re-request, and
   * flags the page so it draws as a tap-to-retry card.
   */
  setPageError(kind: VRHomeGridKind, pageIndex: number) {
    this.inflightFor(kind).delete(pageIndex);
    this.pageErrors.add(`${kind}:${pageIndex}`);
    this.markDirty();
  }

  private inflightFor(kind: VRHomeGridKind): Set<number> {
    if (kind === "galleries") return this.galleryRequestedPages;
    if (kind === "groups") return this.groupRequestedPages;
    if (kind === "groupScenes") return this.groupSceneRequestedPages;
    return this.requestedPages;
  }

  /** The grid kind currently on screen (drives error keys + retry). */
  private get gridKind(): VRHomeGridKind {
    if (this.isGalleryGrid) return "galleries";
    if (this.isGroupGrid) return "groups";
    if (this.inGroupDetail) return "groupScenes";
    return "scenes";
  }

  /** Forget one grid's page errors — on query change/reset they're stale. */
  private clearPageErrors(kind: VRHomeGridKind) {
    for (const k of this.pageErrors) {
      if (k.startsWith(`${kind}:`)) this.pageErrors.delete(k);
    }
  }

  /**
   * Flattened view of all cached scene pages — for the manager's hover-preview
   * lookup. Source-aware: while a movie is drilled into, the hovered cards come
   * from the group's scene cache, so the manager must search *that* set or the
   * preview src lookup misses every card (only ones that happened to also sit in
   * the Home cache would play).
   */
  allLoadedScenes(): IVRSceneEntry[] {
    if (this.inGroupDetail) {
      const flat: IVRSceneEntry[] = [];
      for (const pg of this.groupScenePageCache.values()) flat.push(...pg);
      return flat;
    }
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
    const pump = (
      kind: VRHomeGridKind,
      requester: ((pageIndex: number) => void) | null,
      cache: Map<number, unknown>,
      inflight: Set<number>
    ) => {
      if (!requester) return;
      for (const pg of want) {
        if (pg < 0 || pg > last) continue;
        if (cache.has(pg) || inflight.has(pg)) continue;
        // Errored pages wait for an explicit retry tap — auto-pumping them
        // again every draw would hot-loop against an unreachable server.
        if (this.pageErrors.has(`${kind}:${pg}`)) continue;
        inflight.add(pg);
        requester(pg);
      }
    };
    if (this.isGalleryGrid) {
      pump(
        "galleries",
        this.galleryPageRequester,
        this.galleryPageCache,
        this.galleryRequestedPages
      );
    } else if (this.isGroupGrid) {
      pump(
        "groups",
        this.groupPageRequester,
        this.groupPageCache,
        this.groupRequestedPages
      );
    } else if (this.inGroupDetail) {
      pump(
        "groupScenes",
        this.groupScenePageRequester,
        this.groupScenePageCache,
        this.groupSceneRequestedPages
      );
    } else {
      pump("scenes", this.pageRequester, this.pageCache, this.requestedPages);
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
    if (!!s.passthroughHome !== this.passthroughHome) {
      this.passthroughHome = !!s.passthroughHome;
      changed = true;
    }
    if (!!s.uiSfx !== this.uiSfx) {
      this.uiSfx = !!s.uiSfx;
      changed = true;
    }
    if (!!s.comfortVignette !== this.comfortVignette) {
      this.comfortVignette = !!s.comfortVignette;
      changed = true;
    }
    if (!!s.controllerLock !== this.controllerLock) {
      this.controllerLock = !!s.controllerLock;
      changed = true;
    }
    if (changed) {
      // Reset any in-flight gaze so a delay change takes effect cleanly.
      this.dwellId = null;
      this.dwellStart = 0;
      this.markDirty();
    }
  }

  /** Runtime capability from the session (immersive-ar); shows/hides the row. */
  setPassthroughSupported(on: boolean) {
    if (this.passthroughSupported === on) return;
    this.passthroughSupported = on;
    this.markDirty();
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
    for (const pg of this.sceneCache.values()) {
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

  /** Mirror the manager's live search text (updates as the user types). */
  setSearchText(text: string | null) {
    const t = text?.trim() ? text.trim() : null;
    if (t !== this.searchText) {
      this.searchText = t;
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

  /** Injected by the manager once the FapTap sidecar status is known. */
  setFaptapAvailable(available: boolean) {
    if (available === this.faptapAvailable) return;
    this.faptapAvailable = available;
    this.markDirty();
  }

  get isFaptapAvailable(): boolean {
    return this.faptapAvailable;
  }

  /** Injected by the manager once the PMVHaven sidecar status is known. */
  setPmvhavenAvailable(available: boolean) {
    if (available === this.pmvhavenAvailable) return;
    this.pmvhavenAvailable = available;
    this.markDirty();
  }

  get isPmvhavenAvailable(): boolean {
    return this.pmvhavenAvailable;
  }

  /**
   * The favorites store backing the active content mode. FapTap and PMVHaven are
   * separate catalogs with separate id-spaces, so each gets its own store; any
   * other mode falls back to FapTap's (unused there).
   */
  private get favoritesStore() {
    return this.contentMode === "pmvhaven" ? pmvhavenFavorites : faptapFavorites;
  }

  /** Whether the active content mode is a premium sidecar catalog (FapTap/PMVHaven). */
  private get isSidecarMode(): boolean {
    return this.contentMode === "faptap" || this.contentMode === "pmvhaven";
  }

  /** Switch the wall between the Scenes, Galleries and Movies grids. */
  setContentMode(mode: ContentMode) {
    if (mode === this.contentMode) return;
    this.contentMode = mode;
    // Leaving Movies (or re-entering it) always returns to the poster grid.
    this.activeGroupId = null;
    this.activeGroupTitle = null;
    this.activeGroupPosterUrl = null;
    this.activeGroupBackUrl = null;
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
    this.clearPageErrors("galleries");
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
    // Warm covers for off-screen (neighbour-prefetched) pages — see
    // prefetchSceneThumbs.
    if (pageIndex !== this.page) {
      for (const g of galleries) this.prefetchImage(g.coverUrl);
    }
    this.markDirty();
  }

  // Per-mode page size. The scene grid is small (6); galleries and the movie
  // poster grid keep their own (larger) page sizes, so paging math must pick the
  // right divisor for whichever grid is on screen.
  private get perPage(): number {
    if (this.isGalleryGrid) return GALLERY_PER_PAGE;
    if (this.isGroupGrid) return POSTER_COLS * POSTER_ROWS;
    return PER_PAGE;
  }

  private get pageCount(): number {
    const total = this.isGalleryGrid
      ? this.galleryTotal
      : this.isGroupGrid
      ? this.groupTotal
      : this.sceneTotal;
    return Math.max(1, Math.ceil(total / this.perPage));
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

  // ── Movies (groups) content mode ────────────────────────────────────────────

  /** True while a movie is drilled into (its scene grid is showing). */
  private get inGroupDetail(): boolean {
    return this.contentMode === "movies" && this.activeGroupId !== null;
  }

  /** The right-hand grid is showing scene cards (Scenes/FapTap mode, or movie detail). */
  private get isSceneGrid(): boolean {
    return (
      this.contentMode === "scenes" ||
      this.contentMode === "faptap" ||
      this.contentMode === "pmvhaven" ||
      this.inGroupDetail
    );
  }

  /** The right-hand grid is showing the gallery cover grid. */
  private get isGalleryGrid(): boolean {
    return this.contentMode === "galleries";
  }

  /** The right-hand grid is showing the movie poster grid (no movie drilled in). */
  private get isGroupGrid(): boolean {
    return this.contentMode === "movies" && this.activeGroupId === null;
  }

  // The scene-card grid is fed from either the Home library (Scenes mode) or the
  // active movie's scenes (movie detail) — these pick the right backing store so
  // drawPageCards / pageCount / hover-preview stay source-agnostic.
  private get sceneCache(): Map<number, IVRSceneEntry[]> {
    return this.inGroupDetail ? this.groupScenePageCache : this.pageCache;
  }
  private get sceneTotal(): number {
    return this.inGroupDetail ? this.groupSceneTotal : this.totalCount;
  }
  private get sceneLoaded(): boolean {
    return this.inGroupDetail ? this.groupSceneLoaded : this.loaded;
  }

  /** Injected by the manager: request a page of movie posters from the pager. */
  setGroupPageRequester(cb: (pageIndex: number) => void) {
    this.groupPageRequester = cb;
  }

  /** Injected by the manager: request a page of the active movie's scenes. */
  setGroupScenePageRequester(cb: (pageIndex: number) => void) {
    this.groupScenePageRequester = cb;
  }

  /** Drop cached movie poster pages and reset — called when the movie query changes. */
  resetGroupLibrary() {
    this.groupPageCache.clear();
    this.groupRequestedPages.clear();
    this.clearPageErrors("groups");
    this.groupTotal = 0;
    this.groupLoaded = false;
    if (this.isGroupGrid) {
      this.page = 0;
      this.offset = 0;
      this.animStart = 0;
    }
    this.markDirty();
  }

  /** Receive a fetched movie poster page from the manager's pager. */
  setGroupPageData(
    pageIndex: number,
    groups: IVRGroupEntry[],
    totalCount: number
  ) {
    this.groupPageCache.set(pageIndex, groups);
    this.groupRequestedPages.delete(pageIndex);
    this.groupTotal = totalCount;
    this.groupLoaded = true;
    // Warm posters for off-screen (neighbour-prefetched) pages — see
    // prefetchSceneThumbs.
    if (pageIndex !== this.page) {
      for (const g of groups) this.prefetchImage(g.posterUrl);
    }
    this.markDirty();
  }

  /** Receive a fetched page of the active movie's scenes from the manager's pager. */
  setGroupScenePageData(
    pageIndex: number,
    scenes: IVRSceneEntry[],
    totalCount: number
  ) {
    this.groupScenePageCache.set(pageIndex, scenes);
    this.groupSceneRequestedPages.delete(pageIndex);
    this.groupSceneTotal = totalCount;
    this.groupSceneLoaded = true;
    this.prefetchSceneThumbs(pageIndex, scenes);
    this.markDirty();
  }

  /** Look up a cached movie entry by id (for the openGroup action / detail title). */
  private findGroup(id: string): IVRGroupEntry | null {
    for (const pg of this.groupPageCache.values()) {
      const found = pg.find((g) => g.id === id);
      if (found) return found;
    }
    return null;
  }

  /** Drill into a movie: swap the grid to that movie's scenes (page 0). */
  private enterGroup(groupId: string, group: IVRGroupEntry | null) {
    this.activeGroupId = groupId;
    this.activeGroupTitle = group?.title ?? null;
    this.activeGroupPosterUrl = group?.posterUrl ?? null;
    this.activeGroupBackUrl = group?.backUrl ?? null;
    this.groupScenePageCache.clear();
    this.groupSceneRequestedPages.clear();
    this.clearPageErrors("groupScenes");
    this.groupSceneTotal = 0;
    this.groupSceneLoaded = false;
    this.page = 0;
    this.offset = 0;
    this.animStart = 0;
    this.dwellId = null;
    this.dwellStart = 0;
    this.markDirty();
  }

  /** Leave the movie scene grid and return to the movie poster grid. */
  private exitGroup() {
    this.activeGroupId = null;
    this.activeGroupTitle = null;
    this.activeGroupPosterUrl = null;
    this.activeGroupBackUrl = null;
    this.groupScenePageCache.clear();
    this.groupSceneRequestedPages.clear();
    this.clearPageErrors("groupScenes");
    this.groupSceneTotal = 0;
    this.groupSceneLoaded = false;
    this.page = 0;
    this.offset = 0;
    this.animStart = 0;
    this.dwellId = null;
    this.dwellStart = 0;
    this.markDirty();
  }

  // ── Drag / tap / pagination ────────────────────────────────────────────────

  activate(uv: THREE.Vector2): VRControlAction | null {
    const px = uv.x * this.cw;
    const py = (1 - uv.y) * this.ch;
    const downRegion = this.regionAt(uv);
    this.downId = downRegion?.id ?? null;
    if (downRegion?.id === "pageTrack") {
      this.scrubbing = true;
      this.scrubX0 = downRegion.x;
      this.scrubW = downRegion.w;
      this.scrubPreview = this.pageFromTrack(px);
      this.markDirty();
    }
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
    // While the settings modal or onboarding legend is open the wall behind it
    // is inert.
    if (this.settingsOpen || this.onboardingOpen) return;
    // Pager-track scrub: track the ray along the track, previewing the target
    // page (no settle window — the preview is cheap and instant).
    if (this.scrubbing) {
      const t = this.pageFromTrack(uv.x * this.cw);
      if (t !== this.scrubPreview) {
        this.scrubPreview = t;
        this.markDirty();
      }
      return;
    }
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
    if (this.scrubbing) {
      this.scrubbing = false;
      this.pressActive = false;
      this.dragging = false;
      this.downId = null;
      this.jumpToPage(this.scrubPreview);
      this.markDirty();
      return null;
    }
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

  /** Map a canvas x on the pager track to its proportional page index. */
  private pageFromTrack(px: number): number {
    if (this.scrubW <= 0) return this.page;
    const frac = Math.max(0, Math.min(1, (px - this.scrubX0) / this.scrubW));
    return Math.round(frac * (this.pageCount - 1));
  }

  /** Direct jump (pager dots) — skips the slide animation, which only knows
   *  how to travel ±1 page. */
  private jumpToPage(target: number) {
    const clamped = Math.max(0, Math.min(this.pageCount - 1, target));
    if (this.animStart || clamped === this.page) return;
    this.page = clamped;
    this.offset = 0;
    this.ensurePagesLoaded();
    this.markDirty();
  }

  protected handleSelect(region: IPanelRegion): VRControlAction | null {
    const { id } = region;

    // Shuffle — the manager rolls a random index and launches that scene.
    if (id === "shuffle") return { type: "homeShuffle" };

    // Retry a failed page fetch — clear the grid's error flags so
    // ensurePagesLoaded re-requests the visible pages.
    if (id === "retryPage") {
      this.clearPageErrors(this.gridKind);
      this.ensurePagesLoaded();
      this.markDirty();
      return null;
    }

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
    // Controls legend — "?" reopens it any time; dismissing marks it seen so
    // it won't auto-show again on this device.
    if (id === "help") {
      this.onboardingOpen = true;
      this.onboardingPage = 0;
      this.markDirty();
      return null;
    }
    if (id === "onboardingClose" || id === "onboardingGotIt") {
      this.onboardingOpen = false;
      saveOnboardingSeen();
      this.markDirty();
      return null;
    }
    if (id === "onboardingNext") {
      this.onboardingPage = Math.min(
        ONBOARDING_PAGES.length - 1,
        this.onboardingPage + 1
      );
      this.markDirty();
      return null;
    }
    if (id === "onboardingBack") {
      this.onboardingPage = Math.max(0, this.onboardingPage - 1);
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
      if (id === "set:uiSfx") {
        this.uiSfx = !this.uiSfx;
        this.markDirty();
        return {
          type: "setVrSetting",
          key: "uiSfx",
          value: this.uiSfx,
        };
      }
      if (id === "set:comfortVignette") {
        this.comfortVignette = !this.comfortVignette;
        this.markDirty();
        return {
          type: "setVrSetting",
          key: "comfortVignette",
          value: this.comfortVignette,
        };
      }
      if (id === "set:passthroughHome") {
        this.passthroughHome = !this.passthroughHome;
        this.markDirty();
        return {
          type: "setVrSetting",
          key: "passthroughHome",
          value: this.passthroughHome,
        };
      }
      if (id === "set:controllerLock") {
        this.controllerLock = !this.controllerLock;
        this.markDirty();
        return {
          type: "setVrSetting",
          key: "controllerLock",
          value: this.controllerLock,
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
    if (id === "searchOpen") return { type: "homeSearchOpen" };
    if (id === "searchClear") {
      this.searchText = null;
      this.markDirty();
      return { type: "setHomeSearch", search: null };
    }
    if (id.startsWith("mode:")) {
      const mode = id.slice("mode:".length) as ContentMode;
      // FapTap and PMVHaven are premium add-ons: locked (non-selectable) until
      // their sidecar database is present.
      if (mode === "faptap" && !this.faptapAvailable) return null;
      if (mode === "pmvhaven" && !this.pmvhavenAvailable) return null;
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
    if (id.startsWith("group:")) {
      const groupId = id.slice("group:".length);
      const g = this.findGroup(groupId);
      // Drill into the movie's scene grid; the manager scopes the group library.
      this.enterGroup(groupId, g);
      return { type: "openGroup", groupId, title: g?.title };
    }
    if (id === "groupBack") {
      this.exitGroup();
      return { type: "closeGroup" };
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
    if (id.startsWith("pageDot:")) {
      this.jumpToPage(Number(id.slice("pageDot:".length)));
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
    if (id === "media:favorites")
      return { type: "setMediaFilter", filter: "favorites" };
    if (id.startsWith("fav:")) {
      this.favoritesStore.toggle(id.slice("fav:".length));
      this.markDirty();
      return null;
    }
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
    // or onboarding legend is open (the grid is non-interactive behind it).
    if (!this.hoverLaunch || this.settingsOpen || this.onboardingOpen) {
      this.dwellId = null;
      this.dwellStart = 0;
      return;
    }
    // Dwell-launch targets the active grid: scene cards launch playback, gallery
    // cards open the XR gallery viewer, movie posters drill into the movie.
    const prefix = this.dwellPrefix;
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
      if (this.isGalleryGrid) {
        const galleryId = id.slice("gallery:".length);
        const g = this.findGallery(galleryId);
        this.pendingAction = { type: "openGallery", galleryId, title: g?.title };
      } else if (this.isGroupGrid) {
        const groupId = id.slice("group:".length);
        const g = this.findGroup(groupId);
        // Drill in locally so the wall shows the movie's scenes; the manager
        // scopes the group library's scene paging off the same action.
        this.enterGroup(groupId, g);
        this.pendingAction = { type: "openGroup", groupId, title: g?.title };
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

  /** Region-id prefix the active grid's gaze-dwell targets. */
  private get dwellPrefix(): string {
    if (this.isGalleryGrid) return "gallery:";
    if (this.isGroupGrid) return "group:";
    return "scene:";
  }

  private getDwellFrac(id: string): number {
    if (this.dwellId !== `${this.dwellPrefix}${id}`) return 0;
    return Math.min(1, (performance.now() - this.dwellStart) / this.dwellMs);
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  protected draw() {
    this.tickAnimation();
    this.panelBackground();
    this.drawHeader();
    this.drawSettingsButton();
    this.drawHelpButton();
    this.drawShuffleButton();
    this.drawModeToggle();
    this.drawSearchPill();
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
    } else if (this.onboardingOpen) {
      this.regions = [];
      this.drawOnboardingOverlay();
    }
  }

  /** Draw the active grid (scenes or galleries) or an empty-state message. */
  private drawGrid() {
    const { ctx } = this;
    const loaded = this.isGalleryGrid
      ? this.galleryLoaded
      : this.isGroupGrid
      ? this.groupLoaded
      : this.sceneLoaded;
    const total = this.isGalleryGrid
      ? this.galleryTotal
      : this.isGroupGrid
      ? this.groupTotal
      : this.sceneTotal;
    // Empty state only once we know the library is genuinely empty for this
    // filter; before the first page arrives we fall through to skeleton cards.
    if (loaded && total === 0) {
      ctx.font = "500 26px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      const kind = this.isGalleryGrid
        ? "galleries"
        : this.isGroupGrid
        ? "movies"
        : this.inGroupDetail
        ? "scenes in this movie"
        : "scenes";
      const cx = GRID_X0 + GRID_W / 2;
      const cy = (GRID_Y0 + GRID_Y1) / 2;
      const bySearch = !!this.searchText && !this.inGroupDetail;
      const byFilter = !bySearch && !!this.filterLabel;
      ctx.fillText(
        bySearch
          ? `No ${kind} matching “${this.searchText}”`
          : byFilter
          ? `No ${kind} for this filter`
          : `No ${kind} found`,
        cx,
        cy
      );
      // A dead end shouldn't be a blank wall: offer the obvious way out as a
      // tappable pill. Reuses the existing searchClear / filterAll handlers.
      if (bySearch || byFilter) {
        const label = bySearch ? "Clear search" : "Show everything";
        const rid = bySearch ? "searchClear" : "filterAll";
        const w = 260;
        const h = 62;
        const x = cx - w / 2;
        const y = cy + 44;
        const hovered = this.hoveredId === rid;
        this.roundRect(x, y, w, h, h / 2);
        ctx.fillStyle = hovered
          ? `${ACCENT}0.92)`
          : "rgba(255,255,255,0.10)";
        ctx.fill();
        this.roundRect(x, y, w, h, h / 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = hovered ? `${ACCENT}0.7)` : "rgba(255,255,255,0.25)";
        ctx.stroke();
        ctx.font = "600 24px sans-serif";
        ctx.fillStyle = hovered ? "#06121f" : "rgba(255,255,255,0.9)";
        ctx.fillText(label, cx, y + h / 2 + 1);
        this.regions.push({ id: rid, x, y, w, h });
      }
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

    const plural = (n: number, one: string, many: string) =>
      n === 1 ? `1 ${one}` : `${n} ${many}`;
    let sub: string;
    if (this.isGalleryGrid) {
      const base = plural(this.galleryTotal, "gallery", "galleries");
      sub = this.filterLabel
        ? `${this.filterLabel}  ·  ${base}`
        : `${base} in your library`;
    } else if (this.isGroupGrid) {
      const base = plural(this.groupTotal, "movie", "movies");
      sub = this.filterLabel
        ? `${this.filterLabel}  ·  ${base}`
        : `${base} in your library`;
    } else if (this.inGroupDetail) {
      const base = plural(this.groupSceneTotal, "scene", "scenes");
      sub = this.activeGroupTitle
        ? `${this.activeGroupTitle}  ·  ${base}`
        : `${base} in this movie`;
    } else {
      const base = plural(this.totalCount, "scene", "scenes");
      const mediaLabel =
        this.mediaFilter === "vr"
          ? "VR library"
          : this.mediaFilter === "flat"
          ? "2D library"
          : this.mediaFilter === "funscript"
          ? "interactive library"
          : "library";
      sub = this.filterLabel
        ? `${this.filterLabel}  ·  ${base}`
        : `${base} in your ${mediaLabel}`;
    }
    // Active search reads as part of the query line (skipped in a movie
    // drill-down, whose scene list ignores the search).
    if (this.searchText && !this.inGroupDetail) {
      sub = `“${this.searchText}”  ·  ${sub}`;
    }
    ctx.font = "500 19px sans-serif";
    ctx.fillStyle =
      this.filterLabel || (this.searchText && !this.inGroupDetail)
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
    // Drilled into a movie: the rail is replaced by a Back control + the movie
    // title; the studio/performer/sort filters don't apply to a single movie's
    // (scene_index-ordered) scenes.
    if (this.inGroupDetail) {
      this.drawGroupDetailRail();
      return;
    }
    // Only scene grids carry a media type — hide the All/VR/2D/FS toggle for
    // galleries and movies. FapTap and PMVHaven share the scene grid + toggle.
    if (
      this.contentMode === "scenes" ||
      this.contentMode === "faptap" ||
      this.contentMode === "pmvhaven"
    )
      this.drawMediaToggle();
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

  /** Rail content while a movie is drilled in: a Back button + the movie title. */
  private drawGroupDetailRail() {
    const { ctx } = this;
    const x = RAIL_PAD;
    const w = RAIL_INNER;
    const h = 50;
    const y = CONTENT_Y0;
    const hovered = this.hoveredId === "groupBack";
    this.roundRect(x, y, w, h, 12);
    ctx.fillStyle = hovered ? `${ACCENT}0.92)` : `${ACCENT}0.18)`;
    ctx.fill();
    this.roundRect(x, y, w, h, 12);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hovered ? `${ACCENT}0.7)` : `${ACCENT}0.5)`;
    ctx.stroke();
    ctx.font = "600 20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = hovered ? "#06121f" : `${ACCENT}0.95)`;
    ctx.fillText("‹  All movies", x + w / 2, y + h / 2 + 1);
    this.regions.push({ id: "groupBack", x, y, w, h });

    // Movie title beneath the Back control.
    let cursorY = y + h + 12;
    if (this.activeGroupTitle) {
      ctx.font = "700 24px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(this.fitText(this.activeGroupTitle, w), x, cursorY + 24);
      cursorY += 40;
    }

    // Front + back covers. Shown side-by-side when both exist (each portrait),
    // otherwise a single centred front cover. drawImageContain preserves the
    // real cover aspect inside the box, so non-2:3 art isn't distorted.
    const front = this.activeGroupPosterUrl;
    const back = this.activeGroupBackUrl;
    const labelY = cursorY + 22;
    const coverY = labelY + 10;
    const drawCover = (
      label: string,
      url: string | null,
      cx: number,
      cw: number,
      chh: number
    ) => {
      ctx.font = "600 14px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText(label, cx + 2, labelY);
      const img = this.image(url);
      if (img) {
        this.drawImageContain(
          img,
          cx,
          coverY,
          cw,
          chh,
          10,
          "rgba(255,255,255,0.04)"
        );
      } else {
        this.roundRect(cx, coverY, cw, chh, 10);
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fill();
        ctx.font = "300 44px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.16)";
        ctx.fillText("🎬", cx + cw / 2, coverY + chh / 2);
      }
    };

    if (front && back) {
      const gap = 16;
      const cw = Math.floor((w - gap) / 2);
      const chh = Math.round(cw * 1.5); // 2:3 portrait box
      drawCover("Front", front, x, cw, chh);
      drawCover("Back", back, x + cw + gap, cw, chh);
    } else {
      const cw = Math.min(w, 300);
      const chh = Math.round(cw * 1.5);
      const cx = x + (w - cw) / 2;
      drawCover("Cover", front, cx, cw, chh);
    }
  }

  /**
   * Media-type row. Scenes/FapTap: [All N] [VR N] [2D N] [FS N] (+ [★ N] in
   * FapTap mode). PMVHaven is all flat + funscript-capable, so the VR/2D/FS
   * split is meaningless there — it shows just [All N] (+ [★ N]).
   */
  private drawMediaToggle() {
    const counts: Record<MediaFilter, number> = {
      all: this.sceneCounts.all,
      vr: this.sceneCounts.vr,
      flat: this.sceneCounts.flat,
      funscript: this.sceneCounts.funscript,
      favorites: this.favoritesStore.list().length,
    };
    const pmvhaven = this.contentMode === "pmvhaven";
    const mainOptions: Array<{ id: MediaFilter; label: string }> = pmvhaven
      ? [{ id: "all", label: "All" }]
      : [
          { id: "all", label: "All" },
          { id: "vr", label: "VR" },
          { id: "flat", label: "2D" },
          { id: "funscript", label: "FS" },
        ];

    // Both sidecar catalogs (FapTap/PMVHaven) carry a ★ favorites chip on the right.
    const showFav = this.isSidecarMode;
    const FAV_W = 62;
    const mainW = showFav
      ? Math.floor(
          (RAIL_INNER - FAV_W - MEDIA_BTN_GAP * mainOptions.length) /
            mainOptions.length
        )
      : MEDIA_BTN_W;

    let bx = RAIL_PAD;
    for (const opt of mainOptions) {
      this.drawMediaChip(bx, mainW, opt.id, opt.label, counts[opt.id]);
      bx += mainW + MEDIA_BTN_GAP;
    }

    if (showFav) {
      const fx = RAIL_PAD + RAIL_INNER - FAV_W;
      this.drawMediaChip(fx, FAV_W, "favorites", "★", counts.favorites);
    }
  }

  /** Draw a single media-filter chip and register its hit region. */
  private drawMediaChip(
    bx: number,
    w: number,
    id: MediaFilter,
    label: string,
    n: number
  ) {
    const { ctx } = this;
    const active = this.mediaFilter === id;
    const hovered = this.hoveredId === `media:${id}`;
    this.roundRect(bx, CONTENT_Y0, w, MEDIA_H, MEDIA_H / 2);
    if (active) {
      const g = ctx.createLinearGradient(bx, CONTENT_Y0, bx, CONTENT_Y0 + MEDIA_H);
      g.addColorStop(0, "rgba(96,165,250,0.90)");
      g.addColorStop(1, "rgba(60,120,220,0.78)");
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = hovered
        ? "rgba(255,255,255,0.16)"
        : "rgba(255,255,255,0.07)";
    }
    ctx.fill();
    // Bold label + lighter count, measured and centred as a single unit.
    const cy = CONTENT_Y0 + MEDIA_H / 2 + 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "700 18px sans-serif";
    const labelW = ctx.measureText(label).width;
    const countStr = n > 0 ? `${n}` : "";
    ctx.font = "400 13px sans-serif";
    const countW = countStr ? ctx.measureText(countStr).width + 6 : 0;
    const tx = bx + w / 2 - (labelW + countW) / 2;
    ctx.font = "700 18px sans-serif";
    ctx.fillStyle = active ? "#05111f" : "rgba(255,255,255,0.88)";
    ctx.fillText(label, tx, cy);
    if (countStr) {
      ctx.font = "400 13px sans-serif";
      ctx.fillStyle = active ? "rgba(5,17,31,0.70)" : "rgba(255,255,255,0.50)";
      ctx.fillText(countStr, tx + labelW + 6, cy);
    }
    this.regions.push({ id: `media:${id}`, x: bx, y: CONTENT_Y0, w, h: MEDIA_H });
  }

  /** Studios / Performers tabs */
  private drawFilterTabs() {
    const { ctx } = this;
    // In the sidecar modes the rail's two slots are relabelled: FapTap carries
    // Tags (filterable) + Creators (display only); PMVHaven carries Tags + Stars
    // (both filterable).
    const faptap = this.contentMode === "faptap";
    const pmvhaven = this.contentMode === "pmvhaven";
    const tabs: Array<{ id: FilterTab; label: string }> = [
      { id: "studios", label: faptap || pmvhaven ? "Tags" : "Studios" },
      {
        id: "performers",
        label: pmvhaven ? "Stars" : faptap ? "Creators" : "Performers",
      },
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
      this.contentMode === "galleries"
        ? "All galleries"
        : this.contentMode === "faptap"
        ? "All FapTap"
        : this.contentMode === "pmvhaven"
        ? "All PMVHaven"
        : "All scenes",
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
    if (this.isGalleryGrid) {
      this.drawGalleryPageCards(pageIndex, xShift, interactive);
      return;
    }
    if (this.isGroupGrid) {
      this.drawGroupPageCards(pageIndex, xShift, interactive);
      return;
    }
    const items = this.sceneCache.get(pageIndex);
    if (!items && this.pageErrors.has(`${this.gridKind}:${pageIndex}`)) {
      this.drawPageLoadError(xShift, interactive);
      return;
    }
    if (!items) {
      // Page not fetched yet — draw placeholder skeletons (ensurePagesLoaded
      // has already queued the request). How many slots this page holds is
      // known from the total count.
      const slots = Math.min(
        PER_PAGE,
        Math.max(0, this.sceneTotal - pageIndex * PER_PAGE)
      );
      // Before the total is known, fill a full page of skeletons.
      const n = this.sceneLoaded ? slots : PER_PAGE;
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
    if (!items && this.pageErrors.has(`galleries:${pageIndex}`)) {
      this.drawPageLoadError(xShift, interactive);
      return;
    }
    const slots = Math.min(
      GALLERY_PER_PAGE,
      Math.max(0, this.galleryTotal - pageIndex * GALLERY_PER_PAGE)
    );
    const n = items
      ? items.length
      : this.galleryLoaded
      ? slots
      : GALLERY_PER_PAGE;

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

  /** Movie poster grid — fixed 8×3 portrait posters (parallels the scene grid). */
  private drawGroupPageCards(
    pageIndex: number,
    xShift: number,
    interactive: boolean
  ) {
    const items = this.groupPageCache.get(pageIndex);
    if (!items && this.pageErrors.has(`groups:${pageIndex}`)) {
      this.drawPageLoadError(xShift, interactive);
      return;
    }
    const posterPerPage = POSTER_COLS * POSTER_ROWS;
    const slots = Math.min(
      posterPerPage,
      Math.max(0, this.groupTotal - pageIndex * posterPerPage)
    );
    const n = items ? items.length : this.groupLoaded ? slots : posterPerPage;
    for (let i = 0; i < n; i++) {
      const col = i % POSTER_COLS;
      const row = Math.floor(i / POSTER_COLS);
      const x = GRID_X0 + col * (POSTER_CARD_W + POSTER_GAP_X) + xShift;
      const y = POSTER_TOP + row * (POSTER_CARD_H + POSTER_GAP_Y);
      const entry = items?.[i];
      if (entry) this.drawGroupCard(entry, x, y, interactive);
      else this.drawSkeletonCard(x, y, POSTER_CARD_W, POSTER_IMG_H);
    }
  }

  /**
   * Tap-to-retry state for a page whose fetch failed (server unreachable /
   * network blip). Drawn in place of the card grid; tapping the pill clears
   * the error flag so ensurePagesLoaded re-requests the page.
   */
  private drawPageLoadError(xShift: number, interactive: boolean) {
    const { ctx } = this;
    const cx = GRID_X0 + GRID_W / 2 + xShift;
    const cy = (GRID_Y0 + GRID_Y1) / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "500 28px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText("Couldn't reach the server", cx, cy - 56);
    ctx.font = "400 22px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText("Check the connection to your Vexxx server", cx, cy - 18);

    const w = 240;
    const h = 62;
    const x = cx - w / 2;
    const y = cy + 26;
    const hovered = this.hoveredId === "retryPage";
    ctx.fillStyle = hovered ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.12)";
    this.roundRect(x, y, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    this.roundRect(x, y, w, h, h / 2);
    ctx.stroke();
    ctx.font = "600 24px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText("Tap to retry", cx, y + h / 2);
    if (interactive) {
      this.regions.push({ id: "retryPage", x, y, w, h });
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

  /** Small round "?" button beside the settings gear — reopens the one-time
   * onboarding (controls legend + feature walkthrough) any time. */
  private drawHelpButton() {
    const { ctx } = this;
    const w = 44;
    const x = PAD + 150 + 12;
    const y = 26;
    const hovered = this.hoveredId === "help";
    const active = this.onboardingOpen;
    this.roundRect(x, y, w, w, w / 2);
    ctx.fillStyle =
      active || hovered ? `${ACCENT}0.92)` : "rgba(255,255,255,0.08)";
    ctx.fill();
    this.roundRect(x, y, w, w, w / 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = active || hovered ? `${ACCENT}0.7)` : "rgba(255,255,255,0.2)";
    ctx.stroke();
    ctx.font = "600 20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = active || hovered ? "#06121f" : "rgba(255,255,255,0.75)";
    ctx.fillText("?", x + w / 2, y + w / 2 + 1);
    this.regions.push({ id: "help", x, y, w, h: w });
  }

  /**
   * Shuffle button — launches a uniformly random scene from the current
   * filtered/sorted library (handled in-manager via [homeShuffle]). A compact
   * round icon (matching the "?" button) sitting just left of the header search
   * pill, so it never collides with the mode toggle in the header's left
   * cluster. Scene grids only: hidden on the gallery/movie-poster grids and
   * inside a movie drill-down, where "random from the whole library" would be
   * surprising.
   */
  private drawShuffleButton() {
    if (!this.isSceneGrid || this.inGroupDetail) return;
    const { ctx } = this;
    const w = 44;
    // Anchor to the search pill's left edge (the search pill is always present
    // alongside the shuffle button — both are hidden only inside a drill-down).
    const searchX =
      this.cw - PAD - SEARCH_EXIT_W - SEARCH_EXIT_GAP - SEARCH_W;
    const x = searchX - 16 - w;
    const y = 26;
    const hovered = this.hoveredId === "shuffle";
    this.roundRect(x, y, w, w, w / 2);
    ctx.fillStyle = hovered ? `${ACCENT}0.92)` : "rgba(255,255,255,0.08)";
    ctx.fill();
    this.roundRect(x, y, w, w, w / 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hovered ? `${ACCENT}0.7)` : "rgba(255,255,255,0.2)";
    ctx.stroke();
    ctx.font = "600 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = hovered ? "#06121f" : "rgba(255,255,255,0.75)";
    ctx.fillText("⇄", x + w / 2, y + w / 2 + 1);
    this.regions.push({ id: "shuffle", x, y, w, h: w });
  }

  /**
   * Header search pill — tap to summon the system keyboard (handled in-manager
   * via [homeSearchOpen]). While a search is active it shows the live term plus
   * an ✕ sub-region that clears it; hidden inside a movie drill-down, where the
   * (scene_index-ordered) scene list ignores the search.
   */
  private drawSearchPill() {
    if (this.inGroupDetail) return;
    const { ctx } = this;
    const w = SEARCH_W;
    const h = SEARCH_H;
    const y = SEARCH_Y;
    const x = this.cw - PAD - SEARCH_EXIT_W - SEARCH_EXIT_GAP - w;
    const active = !!this.searchText;
    const hovered =
      this.hoveredId === "searchOpen" || this.hoveredId === "searchClear";

    this.roundRect(x, y, w, h, h / 2);
    if (active) {
      ctx.fillStyle = `${ACCENT}0.22)`;
    } else {
      const pg = ctx.createLinearGradient(x, y, x, y + h);
      if (hovered) {
        pg.addColorStop(0, VRT.raisedHoverTop);
        pg.addColorStop(1, VRT.raisedHoverBot);
      } else {
        pg.addColorStop(0, VRT.raisedTop);
        pg.addColorStop(1, VRT.raisedBot);
      }
      ctx.fillStyle = pg;
    }
    ctx.fill();
    this.roundRect(x, y, w, h, h / 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = active
      ? `${ACCENT}0.65)`
      : hovered
      ? "rgba(255,255,255,0.35)"
      : VRT.raisedBorder;
    ctx.stroke();

    // Clear ✕ (active search only) — pushed before the main region so it wins.
    const clearW = active ? h : 0;
    if (active) {
      const cx = x + w - h / 2 - 4;
      const cy = y + h / 2;
      const clearHover = this.hoveredId === "searchClear";
      if (clearHover) {
        ctx.beginPath();
        ctx.arc(cx, cy, 15, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fill();
      }
      ctx.font = "600 20px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = clearHover
        ? "rgba(255,255,255,0.95)"
        : "rgba(255,255,255,0.6)";
      ctx.fillText("✕", cx, cy + 1);
      this.regions.push({
        id: "searchClear",
        x: x + w - h - 4,
        y,
        w: h + 4,
        h,
      });
    }

    ctx.font = active ? "600 19px sans-serif" : "500 19px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let label: string;
    if (active) {
      ctx.fillStyle = `${ACCENT}0.95)`;
      label = `🔍  “${this.searchText}”`;
    } else {
      ctx.fillStyle = hovered
        ? "rgba(255,255,255,0.92)"
        : "rgba(255,255,255,0.6)";
      label = "🔍  Search";
    }
    // Ellipsize long terms so they never collide with the clear ✕.
    const maxTextW = w - 24 * 2 - clearW;
    while (label.length > 4 && ctx.measureText(label).width > maxTextW) {
      label = `${label.slice(0, -2)}…`;
    }
    ctx.fillText(label, x + 24, y + h / 2 + 1);
    this.regions.push({ id: "searchOpen", x, y, w: w - clearW, h });
  }

  /** Scenes | Galleries | Movies | FapTap | PMV segmented toggle (header). */
  private drawModeToggle() {
    const { ctx } = this;
    const options: Array<{ id: ContentMode; label: string; locked?: boolean }> =
      [
        { id: "scenes", label: "Scenes" },
        { id: "galleries", label: "Galleries" },
        { id: "movies", label: "Movies" },
        { id: "faptap", label: "FapTap", locked: !this.faptapAvailable },
        { id: "pmvhaven", label: "PMV", locked: !this.pmvhavenAvailable },
      ];
    // Keep the original 3-button span; fit all buttons within it so the header
    // layout (logo to the right) is unaffected by the extra sidecar tabs.
    const span = 3 * MODE_BTN_W + 2 * MODE_GAP;
    const btnW = Math.floor((span - (options.length - 1) * MODE_GAP) / options.length);
    let bx = MODE_X;
    for (const opt of options) {
      const active = this.contentMode === opt.id;
      const hovered = this.hoveredId === `mode:${opt.id}`;
      this.roundRect(bx, MODE_Y, btnW, MODE_H, MODE_H / 2);
      if (active) {
        const g = ctx.createLinearGradient(bx, MODE_Y, bx, MODE_Y + MODE_H);
        g.addColorStop(0, "rgba(130,190,255,0.95)");
        g.addColorStop(1, "rgba(70,130,230,0.85)");
        ctx.fillStyle = g;
      } else if (opt.locked) {
        ctx.fillStyle = "rgba(255,255,255,0.04)";
      } else {
        ctx.fillStyle = hovered
          ? "rgba(255,255,255,0.16)"
          : "rgba(255,255,255,0.07)";
      }
      ctx.fill();
      ctx.font = "700 19px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = active
        ? "#06121f"
        : opt.locked
        ? "rgba(255,255,255,0.34)"
        : "rgba(255,255,255,0.88)";
      const label = opt.locked ? `🔒 ${opt.label}` : opt.label;
      ctx.fillText(label, bx + btnW / 2, MODE_Y + MODE_H / 2 + 1);
      this.regions.push({
        id: `mode:${opt.id}`,
        x: bx,
        y: MODE_Y,
        w: btnW,
        h: MODE_H,
      });
      bx += btnW + MODE_GAP;
    }
  }

  /**
   * Modal preferences panel drawn over the dimmed wall. Controls:
   *  • Auto-launch on gaze (on/off) + the dwell delay (1.5 / 2.5 / 4 s)
   *  • Play sound on launch (on/off)
   *  • Passthrough while browsing (on/off) — immersive-ar sessions only
   * Control regions are pushed first so they win over the full-canvas backdrop
   * region (pushed last) that closes the modal on an outside tap.
   */
  private drawSettingsOverlay() {
    const { ctx } = this;

    // Dim the whole wall behind the modal.
    ctx.fillStyle = "rgba(4,6,12,0.72)";
    ctx.fillRect(0, 0, this.cw, this.ch);

    const mW = 760;
    // Taller when the passthrough row is present (AR session).
    const mH = this.passthroughSupported ? 952 : 832;
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

    // ── Row 3: UI sound cues toggle ─────────────────────────────────────────
    rowY += 96;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rowX, rowY);
    ctx.lineTo(rowX + rowW, rowY);
    ctx.stroke();
    rowY += 24;
    this.drawSettingRow(
      rowX,
      rowY,
      rowW,
      "UI sound effects",
      "Soft cues when hovering and selecting",
      this.uiSfx,
      "set:uiSfx"
    );

    // ── Row 4: Comfort vignette ───────────────────────────────────────────────
    rowY += 96;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rowX, rowY);
    ctx.lineTo(rowX + rowW, rowY);
    ctx.stroke();
    rowY += 24;
    this.drawSettingRow(
      rowX,
      rowY,
      rowW,
      "Comfort vignette",
      "Dim edges of view while looking around or zooming",
      this.comfortVignette,
      "set:comfortVignette"
    );

    // ── Row 5: Controller lock ────────────────────────────────────────────────
    rowY += 96;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rowX, rowY);
    ctx.lineTo(rowX + rowW, rowY);
    ctx.stroke();
    rowY += 24;
    this.drawSettingRow(
      rowX,
      rowY,
      rowW,
      "Controller lock",
      "Ignore hand tracking while a controller is connected",
      this.controllerLock,
      "set:controllerLock"
    );

    // ── Row 6: Hub passthrough (only in an immersive-ar session) ────────────
    if (this.passthroughSupported) {
      rowY += 96;
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rowX, rowY);
      ctx.lineTo(rowX + rowW, rowY);
      ctx.stroke();
      rowY += 24;
      this.drawSettingRow(
        rowX,
        rowY,
        rowW,
        "Passthrough while browsing",
        "See your room behind the Home wall",
        this.passthroughHome,
        "set:passthroughHome"
      );
    }

    // Backdrop region (pushed LAST so the controls above win the hit test).
    this.regions.push({
      id: "settingsClose",
      x: 0,
      y: 0,
      w: this.cw,
      h: this.ch,
    });
  }

  /**
   * One-time onboarding — page 1 is the controls legend (recenter /
   * look-around / tap-vs-drag), page 2 walks through the player features.
   * Shown automatically the first time this device opens the Home wall (see
   * loadOnboardingSeen in the constructor); reopenable via the "?" button
   * (always restarts on page 1).
   */
  private drawOnboardingOverlay() {
    const { ctx } = this;
    const pageIndex = this.onboardingPage;
    const page = ONBOARDING_PAGES[pageIndex];
    const isLastPage = pageIndex === ONBOARDING_PAGES.length - 1;

    ctx.fillStyle = "rgba(4,6,12,0.78)";
    ctx.fillRect(0, 0, this.cw, this.ch);

    const mW = 760;
    // Sized to fit this page's cards (104px/row) plus fixed header/footer
    // chrome — matches the original 620px for the 3-card gesture legend.
    const mH = page.cards.length * 104 + 308;
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

    ctx.font = "700 30px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(page.heading, mX + 36, mY + 56);
    ctx.font = "400 18px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(page.sub, mX + 36, mY + 84);

    const clW = 44;
    const clX = mX + mW - clW - 24;
    const clY = mY + 22;
    const clHover = this.hoveredId === "onboardingClose";
    this.roundRect(clX, clY, clW, clW, clW / 2);
    ctx.fillStyle = clHover ? "rgba(220,72,72,0.92)" : "rgba(255,255,255,0.08)";
    ctx.fill();
    ctx.font = "600 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = clHover ? "#fff" : "rgba(255,255,255,0.8)";
    ctx.fillText("✕", clX + clW / 2, clY + clW / 2 + 1);
    this.regions.push({ id: "onboardingClose", x: clX, y: clY, w: clW, h: clW });

    const rowX = mX + 36;
    const rowW = mW - 72;
    const rowH = 104;
    let rowY = mY + 116;
    for (const card of page.cards) {
      const iconR = 28;
      this.roundRect(rowX, rowY, iconR * 2, iconR * 2, iconR);
      ctx.fillStyle = `${ACCENT}0.16)`;
      ctx.fill();
      ctx.font = "600 22px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = `${ACCENT}0.95)`;
      ctx.fillText(card.icon, rowX + iconR, rowY + iconR + 2);

      const textX = rowX + iconR * 2 + 24;
      const textW = rowW - iconR * 2 - 24;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = "600 22px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText(card.title, textX, rowY + 26);

      ctx.font = "400 18px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.62)";
      let ly = rowY + 54;
      for (const line of this.wrapLines(card.body, textW)) {
        ctx.fillText(line, textX, ly);
        ly += 24;
      }

      rowY += rowH;
    }

    // Page dots — only meaningful with more than one page, but harmless at 1.
    if (ONBOARDING_PAGES.length > 1) {
      const dotR = 5;
      const dotGap = 18;
      const dotsW = (ONBOARDING_PAGES.length - 1) * dotGap;
      let dotX = mX + mW / 2 - dotsW / 2;
      const dotY = mY + mH - 68;
      for (let i = 0; i < ONBOARDING_PAGES.length; i++) {
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
        ctx.fillStyle =
          i === pageIndex ? `${ACCENT}0.9)` : "rgba(255,255,255,0.25)";
        ctx.fill();
        dotX += dotGap;
      }
    }

    const btnW = 220;
    const btnH = 52;
    const btnY = mY + mH - btnH - 28;
    const showBack = pageIndex > 0;
    const primaryId = isLastPage ? "onboardingGotIt" : "onboardingNext";
    const primaryLabel = isLastPage ? "Got it" : "Next";

    if (showBack) {
      const backW = 120;
      const gap = 16;
      const groupW = backW + gap + btnW;
      const backX = mX + (mW - groupW) / 2;
      const btnX = backX + backW + gap;
      const backHover = this.hoveredId === "onboardingBack";
      this.roundRect(backX, btnY, backW, btnH, btnH / 2);
      ctx.fillStyle = backHover
        ? "rgba(255,255,255,0.16)"
        : "rgba(255,255,255,0.07)";
      ctx.fill();
      ctx.font = "600 18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText("Back", backX + backW / 2, btnY + btnH / 2 + 1);
      this.regions.push({
        id: "onboardingBack",
        x: backX,
        y: btnY,
        w: backW,
        h: btnH,
      });

      const primaryHover = this.hoveredId === primaryId;
      this.roundRect(btnX, btnY, btnW, btnH, btnH / 2);
      ctx.fillStyle = primaryHover ? `${ACCENT}0.95)` : `${ACCENT}0.85)`;
      ctx.fill();
      ctx.font = "600 20px sans-serif";
      ctx.fillStyle = "#06121f";
      ctx.fillText(primaryLabel, btnX + btnW / 2, btnY + btnH / 2 + 1);
      this.regions.push({ id: primaryId, x: btnX, y: btnY, w: btnW, h: btnH });
    } else {
      const btnX = mX + (mW - btnW) / 2;
      const primaryHover = this.hoveredId === primaryId;
      this.roundRect(btnX, btnY, btnW, btnH, btnH / 2);
      ctx.fillStyle = primaryHover ? `${ACCENT}0.95)` : `${ACCENT}0.85)`;
      ctx.fill();
      ctx.font = "600 20px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#06121f";
      ctx.fillText(primaryLabel, btnX + btnW / 2, btnY + btnH / 2 + 1);
      this.regions.push({ id: primaryId, x: btnX, y: btnY, w: btnW, h: btnH });
    }

    // Backdrop region (pushed LAST so the controls above win the hit test).
    this.regions.push({
      id: "onboardingClose",
      x: 0,
      y: 0,
      w: this.cw,
      h: this.ch,
    });
  }

  /** Break `text` into lines no wider than `maxW` at the canvas's current font. */
  private wrapLines(text: string, maxW: number): string[] {
    const { ctx } = this;
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxW && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
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

    // Bottom scrim — grounds the caption bar and keeps the heatmap strip and
    // metadata pills readable over bright frames.
    const scrimH = 84;
    const scrim = ctx.createLinearGradient(
      0,
      y + THUMB_H - scrimH,
      0,
      y + THUMB_H
    );
    scrim.addColorStop(0, "rgba(8,10,16,0)");
    scrim.addColorStop(1, "rgba(8,10,16,0.55)");
    ctx.fillStyle = scrim;
    ctx.fillRect(x, y + THUMB_H - scrimH, CARD_W, scrimH);

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

    // Caption bar — subtle vertical gradient so the card reads as a lit tile
    // rather than a flat cut-out.
    const cap = ctx.createLinearGradient(0, y + THUMB_H, 0, y + CARD_H);
    cap.addColorStop(0, "rgba(20,23,32,0.96)");
    cap.addColorStop(1, "rgba(11,12,18,0.96)");
    ctx.fillStyle = cap;
    ctx.fillRect(x, y + THUMB_H, CARD_W, CAP_H);
    ctx.restore();

    // Resting hairline — separates the card from the glass background so the
    // grid still reads as tiles between hovers.
    this.roundRect(x, y, CARD_W, CARD_H, R);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.stroke();

    // Title + studio text
    const textX = x + 16;
    const textW = CARD_W - 32;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "600 22px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(
      this.fitText(scene.title || `Scene ${scene.id}`, textW),
      textX,
      y + THUMB_H + 32
    );
    if (scene.studioName) {
      ctx.font = "400 16px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(this.fitText(scene.studioName, textW), textX, y + THUMB_H + 56);
    }

    // Tag-chip row — as many tags as fit on one line, in the lower caption band.
    // Gives an at-a-glance read of a scene's tags (shared by Scenes + movie
    // detail since both render through drawCard).
    if (scene.tags && scene.tags.length > 0) {
      const chipH = 22;
      const chipY = y + THUMB_H + (scene.studioName ? 70 : 56);
      const maxX = x + CARD_W - 14;
      let chipX = textX;
      for (const tag of scene.tags) {
        ctx.font = "500 14px sans-serif";
        const cw = ctx.measureText(tag).width + 18;
        if (chipX + cw > maxX) break;
        this.roundRect(chipX, chipY, cw, chipH, chipH / 2);
        ctx.fillStyle = `${ACCENT}0.16)`;
        ctx.fill();
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(190,215,255,0.92)";
        ctx.fillText(tag, chipX + 9, chipY + chipH / 2 + 1);
        chipX += cw + 6;
      }
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

    // Hover / playing border — a wide low-alpha pass under the crisp stroke
    // fakes an outer glow without canvas shadowBlur (too slow per-frame). VRT
    // tokens (not the ACCENT/GOLD prefixes) so this reads identically to the
    // Scenes-panel row's hover glow, which uses the same technique.
    if (isPlaying || hovered) {
      const halo = isPlaying ? VRT.goldHalo : VRT.accentHalo;
      const glow = isPlaying ? VRT.goldGlow : VRT.accent;
      this.roundRect(x, y, CARD_W, CARD_H, R);
      ctx.lineWidth = 7;
      ctx.strokeStyle = halo;
      ctx.stroke();
      this.roundRect(x, y, CARD_W, CARD_H, R);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = glow;
      ctx.stroke();
    }

    if (interactive) {
      // Heart (favorite) badge for sidecar-catalog cards (FapTap/PMVHaven) —
      // top-right of thumbnail. Pushed before the card region so this smaller
      // hit area wins.
      if (this.isSidecarMode) {
        const isFav = this.favoritesStore.has(scene.id);
        const hw = 36, hh = 26;
        const hx = x + CARD_W - hw - 10;
        // Shift down when the FS badge occupies the top-right at y+10.
        const hy = y + (scene.hasFunscript && !isPlaying ? 44 : 10);
        this.roundRect(hx, hy, hw, hh, hh / 2);
        ctx.fillStyle = isFav ? "rgba(239,68,68,0.88)" : "rgba(0,0,0,0.50)";
        ctx.fill();
        ctx.font = "600 16px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = isFav ? "#fff" : "rgba(255,255,255,0.55)";
        ctx.fillText("♥", hx + hw / 2, hy + hh / 2 + 1);
        this.regions.push({ id: `fav:${scene.id}`, x: hx, y: hy, w: hw, h: hh });
      }
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

  /** Movie poster card — portrait front image + title + scene-count badge. */
  private drawGroupCard(
    group: IVRGroupEntry,
    x: number,
    y: number,
    interactive: boolean
  ) {
    const { ctx } = this;
    const w = POSTER_CARD_W;
    const imgH = POSTER_IMG_H;
    const cardH = POSTER_CARD_H;
    const hovered = interactive && this.hoveredId === `group:${group.id}`;
    const R = 14;

    ctx.save();
    this.roundRect(x, y, w, cardH, R);
    ctx.clip();

    // Poster (front_image_path).
    const img = this.image(group.posterUrl);
    if (img) {
      this.drawImageCover(img, x, y, w, imgH, 0);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(x, y, w, imgH);
      ctx.font = "300 56px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillText("🎬", x + w / 2, y + imgH / 2);
    }

    // Caption bar.
    ctx.fillStyle = "rgba(12,12,17,0.94)";
    ctx.fillRect(x, y + imgH, w, POSTER_CAP_H);
    ctx.restore();

    // Title + studio text — condensed to fit the trimmed POSTER_CAP_H (44px).
    const textX = x + 12;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "600 16px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(
      this.fitText(group.title, w - 24),
      textX,
      y + imgH + (group.studioName ? 18 : 26)
    );
    if (group.studioName) {
      ctx.font = "400 13px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(this.fitText(group.studioName, w - 24), textX, y + imgH + 32);
    }

    // Scene-count badge (top-right of the poster).
    {
      const label = `${group.sceneCount} ${
        group.sceneCount === 1 ? "scene" : "scenes"
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

    // Rating pill (lower-left of the poster) when present.
    if (group.rating) {
      const label = `★ ${(group.rating / 20).toFixed(1)}`;
      ctx.font = "600 13px sans-serif";
      const pw = ctx.measureText(label).width + 14;
      const ph = 22;
      const px = x + 10;
      const py = y + imgH - 32;
      this.roundRect(px, py, pw, ph, ph / 2);
      ctx.fillStyle = "rgba(5,10,20,0.82)";
      ctx.fill();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = `${GOLD}0.95)`;
      ctx.fillText(label, px + pw / 2, py + ph / 2 + 1);
    }

    // Gaze-dwell arc — drills into the movie's scenes when full.
    const dwellFrac = interactive ? this.getDwellFrac(group.id) : 0;
    if (dwellFrac > 0) {
      const arcCx = x + w / 2;
      const arcCy = y + imgH / 2;
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
      ctx.fillText("▸", arcCx + 1, arcCy + 1);
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
      this.regions.push({ id: `group:${group.id}`, x, y, w, h: cardH });
    }
  }

  private drawPager() {
    const { ctx } = this;
    const pages = this.pageCount;
    if (pages <= 1) return;

    const cy = PAGER_Y;
    const arrowW = 48;
    const gap = 24;
    // Dots up to a dozen pages (each dot is a tap target that jumps straight
    // to its page); beyond that a fraction label over a thin progress track.
    const useDots = pages <= 12;
    const DOT_STEP = 26;
    const DOT_R = 4.5;

    let midW: number;
    if (useDots) {
      midW = (pages - 1) * DOT_STEP + DOT_R * 2;
    } else {
      // Wide enough to scrub with reasonable precision across hundreds of
      // pages (arrows still give exact ±1).
      midW = 720;
    }
    let x = GRID_X0 + (GRID_W - (arrowW + gap + midW + gap + arrowW)) / 2;

    const drawArrow = (id: "pageL" | "pageR", enabled: boolean) => {
      const hovered = this.hoveredId === id;
      this.roundRect(x, cy - PAGER_H / 2, arrowW, PAGER_H, PAGER_H / 2);
      ctx.fillStyle = !enabled
        ? "rgba(255,255,255,0.04)"
        : hovered
        ? `${ACCENT}0.30)`
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

    if (useDots) {
      for (let i = 0; i < pages; i++) {
        const dx = x + DOT_R + i * DOT_STEP;
        const active = i === this.page;
        const hovered = this.hoveredId === `pageDot:${i}`;
        if (active) {
          // Soft halo behind the active dot.
          ctx.beginPath();
          ctx.arc(dx, cy, DOT_R + 5, 0, Math.PI * 2);
          ctx.fillStyle = `${ACCENT}0.22)`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(dx, cy, active ? DOT_R + 1 : DOT_R, 0, Math.PI * 2);
        ctx.fillStyle = active
          ? `${ACCENT}0.95)`
          : hovered
          ? "rgba(255,255,255,0.65)"
          : "rgba(255,255,255,0.28)";
        ctx.fill();
        if (!active) {
          this.regions.push({
            id: `pageDot:${i}`,
            x: dx - DOT_STEP / 2,
            y: cy - PAGER_H / 2,
            w: DOT_STEP,
            h: PAGER_H,
          });
        }
      }
      x += midW + gap;
    } else {
      // Scrubber: the track is a tap/drag target — press anywhere to jump
      // proportionally, drag to sweep with a live "page / pages" preview.
      const scrub = this.scrubbing;
      const shown = scrub ? this.scrubPreview : this.page;
      const hovered = scrub || this.hoveredId === "pageTrack";
      ctx.font = "600 20px sans-serif";
      ctx.fillStyle = scrub ? `${ACCENT}0.95)` : "rgba(255,255,255,0.75)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${shown + 1} / ${pages}`, x + midW / 2, cy - 9);
      const trackY = cy + 12;
      const trackH = hovered ? 6 : 4;
      this.roundRect(x, trackY - trackH / 2, midW, trackH, trackH / 2);
      ctx.fillStyle = hovered
        ? "rgba(255,255,255,0.20)"
        : "rgba(255,255,255,0.12)";
      ctx.fill();
      const frac = shown / (pages - 1);
      this.roundRect(
        x,
        trackY - trackH / 2,
        Math.max(8, midW * frac),
        trackH,
        trackH / 2
      );
      ctx.fillStyle = `${ACCENT}0.9)`;
      ctx.fill();
      // Thumb — reads as draggable even at rest.
      ctx.beginPath();
      ctx.arc(x + midW * frac, trackY, hovered ? 10 : 7, 0, Math.PI * 2);
      ctx.fillStyle = scrub ? `${ACCENT}1)` : "rgba(255,255,255,0.85)";
      ctx.fill();
      this.regions.push({
        id: "pageTrack",
        x,
        y: cy - PAGER_H / 2,
        w: midW,
        h: PAGER_H,
      });
      x += midW + gap;
    }

    drawArrow("pageR", this.page < pages - 1);
  }
}
