/**
 * VRScenesPanel — left-side peripheral "Scenes" browser: a compact vertical
 * list of scenes (small landscape thumbnail + title/studio text per row) so
 * far more scenes fit in view than a large-card carousel would.
 *
 * Interaction: the list is click-and-dragged to scroll (vertical), and a row
 * is only navigated to on a *tap* (press + release without dragging) — so
 * users can browse the list before committing. Drag-vs-tap is resolved here in
 * pointerMove/pointerUp, fed by the controller input's trigger-press stream.
 *
 * Hover preview: unlike the old carousel (which played the hover clip inline
 * inside the card), a row's preview floats in a larger popup beside the panel
 * — the session manager's shared thumbnail-preview quad, the same one used
 * for marker/chapter hover (see xrSession's updateThumbnailPreview). This
 * panel only exposes the data that popup needs (`getScenePreviewImage`,
 * `sceneRowAnchorLocal`); it does not draw the preview itself.
 */
import * as THREE from "three";
import TextUtils from "src/utils/text";
import { VRControlAction } from "./types";
import { VRCanvasPanel } from "./VRInfoPanels";

export interface IVRSceneEntry {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  streamUrl: string | null;
  studioName: string | null;
  performers: string[];
  // Extended fields for the immersive Home wall (optional so the carousel and
  // existing call sites keep working unchanged).
  /** Short preview clip URL (paths.preview) — used for hover + slideshow. */
  previewUrl?: string | null;
  /** VR projection mode string (scene.vr_mode), for slideshow correction. */
  vrMode?: string | null;
  studioId?: string | null;
  studioLogoUrl?: string | null;
  performerDetails?: { id: string; name: string; imageUrl: string | null }[];
  /** True when an interactive funscript file is attached to this scene. */
  hasFunscript?: boolean;
  /** URL to the pre-generated funscript heatmap image (paths.interactive_heatmap). */
  heatmapUrl?: string | null;
  /** Seconds into the scene where playback was last left (resume_time). */
  resumeTime?: number | null;
  /** Scene rating 0–100 (rating100). */
  rating?: number | null;
  /** Duration in seconds (files[0].duration). */
  durationSecs?: number | null;
  /** ISO date string from the scene `date` field, e.g. "2024-05-01". */
  dateAdded?: string | null;
  /** Video width in pixels. */
  width?: number | null;
  /** Video height in pixels. */
  height?: number | null;
  /** Scene tag names (tags[].name) — rendered as a chip row on the Home card. */
  tags?: string[];
}

// Same dimensions as the Info panel for symmetry; the height matches the main
// control bar's height in metres.
const CANVAS_W = 820;
const CANVAS_H = 736;
const PANEL_WIDTH_M = 1.1;

const TITLE_Y = 44; // "SCENES" label baseline
const VIEW_Y0 = 64; // list viewport top (below the title)
const VIEW_Y1 = CANVAS_H - 16; // list viewport bottom

// Compact row: a small landscape thumbnail + title/studio text. At ROW_H=100
// with a 10px gap, ~6 rows are visible at once vs. 2 with the old large-card
// layout.
const ROW_X0 = 20;
const ROW_W = CANVAS_W - ROW_X0 * 2;
const ROW_GAP = 10;
const ROW_H = 100;
const ROW_PAD = 14; // inner padding between the row edge and its thumbnail/text
const THUMB_W = 150;
const THUMB_H = Math.round((THUMB_W * 9) / 16);
const TEXT_X = ROW_X0 + ROW_PAD + THUMB_W + 16;
const TEXT_W = ROW_W - (ROW_PAD + THUMB_W + 16 + ROW_PAD);

// Pixels of travel before a held press is treated as a drag (cancels the tap).
const DRAG_THRESHOLD = 10;

export class VRScenesPanel extends VRCanvasPanel {
  // Server-paged: the panel grows the list by appending pages as the user
  // scrolls toward the bottom, rather than holding a fixed capped slice. Pages
  // are pulled through an injected requester (the session manager fetches them
  // from VRCarouselLibrary and feeds them back via appendPage).
  private scenes: IVRSceneEntry[] = [];
  private totalCount = 0;
  private requestedPages = 0; // how many pages we've asked for (next index = this)
  private loading = false; // a page request is in flight
  private reachedEnd = false; // server returned an empty page → no more to load
  private pageRequester: ((pageIndex: number) => void) | null = null;

  private scroll = 0; // vertical scroll offset, px
  private maxScroll = 0;
  private currentSceneId: string | null = null;

  // Drag/tap resolution state for the current trigger press.
  private pressY: number | null = null;
  private pressScroll = 0;
  private dragged = false;
  private downId: string | null = null;

  constructor() {
    super(PANEL_WIDTH_M, CANVAS_W, CANVAS_H);
    this.mesh.name = "vr-scenes-panel";
  }

  get hasContent(): boolean {
    return this.scenes.length > 0;
  }

  /** Scene ID of the row currently under the ray/cursor, or null. */
  get hoveredSceneId(): string | null {
    if (this.hoveredId?.startsWith("scene:")) {
      return this.hoveredId.slice("scene:".length);
    }
    return null;
  }

  /** Every scene loaded so far — used by the manager's hover-preview lookup. */
  allLoadedScenes(): IVRSceneEntry[] {
    return this.scenes;
  }

  /** Inject the page fetcher (manager → VRCarouselLibrary). Loading is lazy. */
  setPageRequester(fn: (pageIndex: number) => void) {
    this.pageRequester = fn;
  }

  /**
   * Reset the list back to empty (called when the now-playing scene changes, so
   * the list re-pages excluding it). Page 0 is pulled lazily the next time the
   * panel draws while Browse is open.
   */
  resetLibrary() {
    this.scenes = [];
    this.totalCount = 0;
    this.requestedPages = 0;
    this.loading = false;
    this.reachedEnd = false;
    this.scroll = 0;
    this.markDirty();
  }

  /** Append a freshly-fetched page (manager pushes this after a gen check). */
  appendPage(pageIndex: number, scenes: IVRSceneEntry[], totalCount: number) {
    this.loading = false;
    this.totalCount = totalCount;
    if (scenes.length === 0) {
      this.reachedEnd = true;
    } else {
      this.scenes = this.scenes.concat(scenes);
      if (totalCount > 0 && this.scenes.length >= totalCount) {
        this.reachedEnd = true;
      }
    }
    this.markDirty();
  }

  /**
   * Pull the next page when we have a requester, nothing is in flight, more
   * remain, and the user has scrolled within ~1.5 rows of the bottom (or we
   * haven't loaded anything yet). Cheap to call every draw — it self-gates.
   */
  private ensureLoaded() {
    if (!this.pageRequester || this.loading || this.reachedEnd) return;
    const noneYet = this.requestedPages === 0;
    const more = this.totalCount === 0 || this.scenes.length < this.totalCount;
    const nearBottom = this.scroll >= this.maxScroll - ROW_H * 1.5;
    if (noneYet || (more && nearBottom)) {
      this.loading = true;
      const pageIndex = this.requestedPages;
      this.requestedPages += 1;
      this.pageRequester(pageIndex);
    }
  }

  /** Mark which scene is currently playing so its row gets the Now Playing accent. */
  setCurrentSceneId(id: string | null) {
    if (id !== this.currentSceneId) {
      this.currentSceneId = id;
      this.markDirty();
    }
  }

  /**
   * No-op: the row list shows a floating full-size preview via the session
   * manager's shared thumbnail popup (mirrors the marker/chapter hover
   * preview) rather than compositing video inline into the compact row. Kept
   * to satisfy the manager's generic hover-preview panel interface.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setPreviewVideo(_video: HTMLVideoElement | null): void {}

  /** Best-available static preview image for a row's popup (its thumbnail). */
  getScenePreviewImage(id: string): HTMLImageElement | null {
    const scene = this.scenes.find((s) => s.id === id);
    return scene ? this.image(scene.thumbnailUrl) : null;
  }

  /**
   * Panel-local anchor for the row-hover popup: centred just above the
   * panel's top edge, a fixed spot regardless of which row is hovered or how
   * far the list has scrolled — so the popup doesn't jump around as the user
   * browses. `popupHeightM` (the caller's popup mesh height) sizes the gap so
   * the popup clears the panel's top edge rather than overlapping it.
   */
  previewAnchorLocal(popupHeightM: number): THREE.Vector3 {
    const gap = 0.06;
    return new THREE.Vector3(0, this.hM / 2 + popupHeightM / 2 + gap, 0.05);
  }

  // ── Drag-to-scroll + tap-to-select ────────────────────────────────────────

  /** Press: begin a potential drag. Never navigates immediately. */
  activate(uv: THREE.Vector2): VRControlAction | null {
    this.pressY = (1 - uv.y) * this.ch;
    this.pressScroll = this.scroll;
    this.dragged = false;
    this.downId = this.regionAt(uv)?.id ?? null;
    return null;
  }

  pointerMove(uv: THREE.Vector2): void {
    if (this.pressY == null) return;
    const py = (1 - uv.y) * this.ch;
    const dy = py - this.pressY;
    if (Math.abs(dy) > DRAG_THRESHOLD) this.dragged = true;
    // Drag down → reveal earlier rows (content follows the finger).
    const next = Math.min(this.maxScroll, Math.max(0, this.pressScroll - dy));
    if (next !== this.scroll) {
      this.scroll = next;
      this.markDirty();
    }
  }

  pointerUp(uv: THREE.Vector2): VRControlAction | null {
    const wasTap = !this.dragged && this.pressY != null;
    const { downId } = this;
    this.pressY = null;
    this.downId = null;
    if (!wasTap) return null;
    // Only navigate if the release lands on the same row the press started on.
    const region = this.regionAt(uv);
    if (region && region.id === downId && region.id.startsWith("scene:")) {
      return {
        type: "switchScene",
        sceneId: region.id.slice("scene:".length),
      };
    }
    return null;
  }

  // handleSelect is unused for navigation (the press path returns null via the
  // activate override); kept to satisfy the abstract base.
  protected handleSelect(): VRControlAction | null {
    return null;
  }

  protected draw() {
    const { ctx } = this;

    this.panelBackground();
    this.sectionLabel("Scenes", 24, TITLE_Y);

    // Drive lazy paging from the draw loop (runs while Browse is open).
    this.ensureLoaded();

    if (this.scenes.length === 0) {
      ctx.font = "500 22px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      // Distinguish "still loading page 0" from a genuinely empty result.
      const msg = this.reachedEnd ? "No VR scenes found" : "Loading scenes…";
      ctx.fillText(msg, 24, (VIEW_Y0 + VIEW_Y1) / 2);
      return;
    }

    const viewH = VIEW_Y1 - VIEW_Y0;
    const total =
      this.scenes.length * ROW_H + (this.scenes.length - 1) * ROW_GAP;
    this.maxScroll = Math.max(0, total - viewH);
    const sc = Math.min(this.maxScroll, Math.max(0, this.scroll));
    this.scroll = sc;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, VIEW_Y0, this.cw, viewH);
    ctx.clip();
    for (let i = 0; i < this.scenes.length; i++) {
      const y = VIEW_Y0 - sc + i * (ROW_H + ROW_GAP);
      if (y + ROW_H < VIEW_Y0 || y > VIEW_Y1) continue;
      this.drawSceneRow(i, y);
      // Clamp the hit region to the visible viewport.
      const ry = Math.max(y, VIEW_Y0);
      const rh = Math.min(y + ROW_H, VIEW_Y1) - ry;
      if (rh > 6) {
        this.regions.push({
          id: `scene:${this.scenes[i].id}`,
          x: ROW_X0,
          y: ry,
          w: ROW_W,
          h: rh,
        });
      }
    }
    ctx.restore();

    // Slim scrollbar on the right edge when the list overflows.
    if (this.maxScroll > 1) {
      const trackX = this.cw - 8;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(trackX, VIEW_Y0, 3, viewH);
      const thumbH = Math.max(30, viewH * (viewH / total));
      const thumbY = VIEW_Y0 + (viewH - thumbH) * (sc / this.maxScroll);
      ctx.fillStyle = "rgba(96,165,250,0.6)";
      ctx.fillRect(trackX, thumbY, 3, thumbH);
    }
  }

  private drawSceneRow(i: number, y: number) {
    const { ctx } = this;
    const scene = this.scenes[i];
    const hovered = this.hoveredId === `scene:${scene.id}`;
    const isPlaying = this.currentSceneId === scene.id;
    const x = ROW_X0;

    // Row background.
    this.roundRect(x, y, ROW_W, ROW_H, 12);
    ctx.fillStyle = hovered
      ? "rgba(255,255,255,0.10)"
      : "rgba(255,255,255,0.05)";
    ctx.fill();
    if (isPlaying || hovered) {
      this.roundRect(x, y, ROW_W, ROW_H, 12);
      ctx.lineWidth = 2;
      ctx.strokeStyle = isPlaying
        ? "rgba(250,200,80,0.85)"
        : "rgba(96,165,250,0.60)";
      ctx.stroke();
    }

    // Thumbnail.
    const tx = x + ROW_PAD;
    const ty = y + (ROW_H - THUMB_H) / 2;
    const img = this.image(scene.thumbnailUrl);
    if (img) {
      this.drawImageCover(img, tx, ty, THUMB_W, THUMB_H, 8);
    } else {
      this.roundRect(tx, ty, THUMB_W, THUMB_H, 8);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fill();
    }

    // Duration badge, bottom-right corner of the thumbnail.
    if (scene.durationSecs) {
      const label = TextUtils.secondsToTimestamp(scene.durationSecs);
      ctx.font = "600 13px monospace";
      const padX = 6;
      const bw = ctx.measureText(label).width + padX * 2;
      const bh = 18;
      const bx = tx + THUMB_W - bw - 5;
      const by = ty + THUMB_H - bh - 5;
      this.roundRect(bx, by, bw, bh, 5);
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fill();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText(label, bx + bw / 2, by + bh / 2 + 1);
    }

    // Now-playing dot, top-left corner of the thumbnail.
    if (isPlaying) {
      ctx.beginPath();
      ctx.arc(tx + 11, ty + 11, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(250,200,80,0.95)";
      ctx.fill();
    }

    // Title + studio.
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "600 21px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(
      this.fitText(scene.title || `Scene ${scene.id}`, TEXT_W),
      TEXT_X,
      y + ROW_H / 2 - (scene.studioName ? 6 : -7)
    );
    if (scene.studioName) {
      ctx.font = "400 16px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText(
        this.fitText(scene.studioName, TEXT_W),
        TEXT_X,
        y + ROW_H / 2 + 19
      );
    }
  }
}
