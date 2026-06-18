/**
 * VRScenesPanel — left-side peripheral "Scenes" browser: a vertical carousel of
 * landscape scene cards (two visible at a time) with a lower-third title/studio
 * overlay and a hover video preview.
 *
 * Interaction: the carousel is click-and-dragged to scroll (vertical), and a
 * card is only navigated to on a *tap* (press + release without dragging) — so
 * users can browse the list before committing. Drag-vs-tap is resolved here in
 * pointerMove/pointerUp, fed by the controller input's trigger-press stream.
 */
import * as THREE from "three";
import { VRControlAction } from "./types";
import { VRCanvasPanel } from "./VRInfoPanels";

export interface IVRSceneEntry {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  streamUrl: string | null;
  studioName: string | null;
  performers: string[];
}

// Same dimensions as the Info panel for symmetry; the height matches the main
// control bar's height in metres.
const CANVAS_W = 820;
const CANVAS_H = 736;
const PANEL_WIDTH_M = 1.1;

const TITLE_Y = 44; // "SCENES" label baseline
const VIEW_Y0 = 64; // carousel viewport top (below the title)
const VIEW_Y1 = CANVAS_H - 16; // carousel viewport bottom
const CARD_GAP = 18;
// Two cards visible at a time, landscape 16:9, centred horizontally.
const CARD_H = Math.floor((VIEW_Y1 - VIEW_Y0 - CARD_GAP) / 2);
const CARD_W = Math.round((CARD_H * 16) / 9);
const CARD_X = Math.round((CANVAS_W - CARD_W) / 2);

// Pixels of travel before a held press is treated as a drag (cancels the tap).
const DRAG_THRESHOLD = 10;

export class VRScenesPanel extends VRCanvasPanel {
  private scenes: IVRSceneEntry[] = [];
  private scroll = 0; // vertical scroll offset, px
  private maxScroll = 0;
  private previewVideo: HTMLVideoElement | null = null;

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

  /** Scene ID of the card currently under the ray/cursor, or null. */
  get hoveredSceneId(): string | null {
    if (this.hoveredId?.startsWith("scene:")) {
      return this.hoveredId.slice("scene:".length);
    }
    return null;
  }

  setScenes(scenes: IVRSceneEntry[]) {
    this.scenes = scenes;
    this.scroll = 0;
    this.markDirty();
  }

  /** Provide the preview video element; pass null to revert to screenshot. */
  setPreviewVideo(video: HTMLVideoElement | null) {
    this.previewVideo = video;
    this.markDirty();
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
    // Drag down → reveal earlier cards (content follows the finger).
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
    // Only navigate if the release lands on the same card the press started on.
    const region = this.regionAt(uv);
    if (region && region.id === downId && region.id.startsWith("scene:")) {
      return {
        type: "navigateToScene",
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

    if (this.scenes.length === 0) {
      ctx.font = "500 22px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText("No VR scenes found", 24, (VIEW_Y0 + VIEW_Y1) / 2);
      return;
    }

    const viewH = VIEW_Y1 - VIEW_Y0;
    const total =
      this.scenes.length * CARD_H + (this.scenes.length - 1) * CARD_GAP;
    this.maxScroll = Math.max(0, total - viewH);
    const sc = Math.min(this.maxScroll, Math.max(0, this.scroll));
    this.scroll = sc;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, VIEW_Y0, this.cw, viewH);
    ctx.clip();
    for (let i = 0; i < this.scenes.length; i++) {
      const y = VIEW_Y0 - sc + i * (CARD_H + CARD_GAP);
      if (y + CARD_H < VIEW_Y0 || y > VIEW_Y1) continue;
      this.drawSceneCard(i, CARD_X, y);
      // Clamp the hit region to the visible viewport.
      const ry = Math.max(y, VIEW_Y0);
      const rh = Math.min(y + CARD_H, VIEW_Y1) - ry;
      if (rh > 6) {
        this.regions.push({
          id: `scene:${this.scenes[i].id}`,
          x: CARD_X,
          y: ry,
          w: CARD_W,
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

  private drawSceneCard(i: number, x: number, y: number) {
    const { ctx } = this;
    const scene = this.scenes[i];
    const hovered = this.hoveredId === `scene:${scene.id}`;

    // Card base — glass placeholder behind the thumbnail.
    this.roundRect(x, y, CARD_W, CARD_H, 12);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fill();

    // Thumbnail: preview video when hovered + loaded, else static screenshot.
    const videoEl = hovered ? this.previewVideo : null;
    if (videoEl && videoEl.readyState >= 2) {
      ctx.save();
      this.roundRect(x, y, CARD_W, CARD_H, 12);
      ctx.clip();
      const vr = videoEl.videoWidth / videoEl.videoHeight;
      const cr = CARD_W / CARD_H;
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
      ctx.drawImage(videoEl, sx, sy, sw, sh, x, y, CARD_W, CARD_H);
      ctx.restore();
    } else {
      const img = this.image(scene.thumbnailUrl);
      if (img) {
        this.drawImageCover(img, x, y, CARD_W, CARD_H, 12);
      } else {
        this.roundRect(x, y, CARD_W, CARD_H, 12);
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.fill();
      }
    }

    // Lower-third gradient overlay.
    const overlayH = Math.round(CARD_H * 0.38);
    const overlayY = y + CARD_H - overlayH;
    ctx.save();
    this.roundRect(x, y, CARD_W, CARD_H, 12);
    ctx.clip();
    const grad = ctx.createLinearGradient(0, overlayY, 0, y + CARD_H);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.35, "rgba(0,0,0,0.6)");
    grad.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, overlayY, CARD_W, overlayH);
    ctx.restore();

    // Hover border (drawn after overlays so it stays visible).
    if (hovered) {
      this.roundRect(x, y, CARD_W, CARD_H, 12);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(96,165,250,0.70)";
      ctx.stroke();
    }

    // Title + studio inside the overlay.
    const textX = x + 12;
    const titleY = y + CARD_H - (scene.studioName ? 36 : 22);
    ctx.font = "600 20px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(
      this.fitText(scene.title || `Scene ${scene.id}`, CARD_W - 24),
      textX,
      titleY
    );
    if (scene.studioName) {
      ctx.font = "400 15px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillText(
        this.fitText(scene.studioName, CARD_W - 24),
        textX,
        y + CARD_H - 14
      );
    }
  }
}
