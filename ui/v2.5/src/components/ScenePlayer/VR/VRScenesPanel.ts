/**
 * VRScenesPanel — Browse surface "Scenes" tab: landscape scene cards with
 * lower-third title/studio overlay and a hover video preview. Shares the
 * right-side Browse slot with VRInfoPanel; only one is visible at a time.
 */
import { VRControlAction } from "./types";
import { VRCanvasPanel, IPanelRegion } from "./VRInfoPanels";

export interface IVRSceneEntry {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  streamUrl: string | null;
  studioName: string | null;
  performers: string[];
}

const CANVAS_W = 1200;
const CANVAS_H = 500;
const PANEL_WIDTH_M = 1.8;

// Cards start below the tab header (84 px) with a small gap.
const CARD_Y = 90;
const CARD_W = 280; // landscape ~3:2
const CARD_H = 187;
const GAP = 16;

export class VRScenesPanel extends VRCanvasPanel {
  private scenes: IVRSceneEntry[] = [];
  private scroll = 0;
  private previewVideo: HTMLVideoElement | null = null;

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
    this.markDirty();
  }

  /** Provide the preview video element; pass null to revert to screenshot. */
  setPreviewVideo(video: HTMLVideoElement | null) {
    this.previewVideo = video;
    this.markDirty();
  }

  protected handleSelect(region: IPanelRegion): VRControlAction | null {
    if (region.id === "scenesScrollL") {
      this.scroll = this.scrollBy("scenes", -1, this.scroll);
      this.markDirty();
      return null;
    }
    if (region.id === "scenesScrollR") {
      this.scroll = this.scrollBy("scenes", 1, this.scroll);
      this.markDirty();
      return null;
    }
    if (region.id === "browseTab:info") {
      return { type: "browseSetTab", tab: "info" };
    }
    if (region.id.startsWith("scene:")) {
      return { type: "navigateToScene", sceneId: region.id.slice("scene:".length) };
    }
    return null;
  }

  protected draw() {
    const { ctx } = this;
    this.regions = [];

    this.panelBackground();
    this.drawTabHeader("scenes");

    if (this.scenes.length === 0) {
      ctx.font = "500 22px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText("No VR scenes found", 24, CARD_Y + CARD_H / 2);
      this.texture.needsUpdate = true;
      return;
    }

    const widths = this.scenes.map(() => CARD_W);
    this.hStrip({
      prefix: "scenes",
      x0: 24,
      x1: CANVAS_W - 24,
      y: CARD_Y,
      h: CARD_H,
      scrollX: this.scroll,
      widths,
      gap: GAP,
      drawItem: (i, x) => this.drawSceneCard(i, x),
      regionId: (i) => ({ id: `scene:${this.scenes[i].id}` }),
    });

    this.texture.needsUpdate = true;
  }

  private drawSceneCard(i: number, x: number) {
    const { ctx } = this;
    const scene = this.scenes[i];
    const hovered = this.hoveredId === `scene:${scene.id}`;

    // Card outline — glass base
    this.roundRect(x, CARD_Y, CARD_W, CARD_H, 12);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fill();

    // Thumbnail: preview video when hovered + loaded, else static screenshot.
    const videoEl = hovered ? this.previewVideo : null;
    if (videoEl && videoEl.readyState >= 2) {
      ctx.save();
      this.roundRect(x, CARD_Y, CARD_W, CARD_H, 12);
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
      ctx.drawImage(videoEl, sx, sy, sw, sh, x, CARD_Y, CARD_W, CARD_H);
      ctx.restore();
    } else {
      const img = this.image(scene.thumbnailUrl);
      if (img) {
        this.drawImageCover(img, x, CARD_Y, CARD_W, CARD_H, 12);
      } else {
        this.roundRect(x, CARD_Y, CARD_W, CARD_H, 12);
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.fill();
      }
    }

    // Lower-third gradient overlay.
    const overlayH = Math.round(CARD_H * 0.38);
    const overlayY = CARD_Y + CARD_H - overlayH;
    ctx.save();
    this.roundRect(x, CARD_Y, CARD_W, CARD_H, 12);
    ctx.clip();
    const grad = ctx.createLinearGradient(0, overlayY, 0, CARD_Y + CARD_H);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.35, "rgba(0,0,0,0.6)");
    grad.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, overlayY, CARD_W, overlayH);
    ctx.restore();

    // Hover border stroke (drawn after overlays so it's visible).
    if (hovered) {
      this.roundRect(x, CARD_Y, CARD_W, CARD_H, 12);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(96,165,250,0.70)";
      ctx.stroke();
    }

    // Title + studio inside the overlay.
    const textX = x + 10;
    const titleY = CARD_Y + CARD_H - (scene.studioName ? 34 : 22);
    ctx.font = "600 18px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(
      this.fitText(scene.title || `Scene ${scene.id}`, CARD_W - 20),
      textX,
      titleY
    );
    if (scene.studioName) {
      ctx.font = "400 14px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillText(
        this.fitText(scene.studioName, CARD_W - 20),
        textX,
        CARD_Y + CARD_H - 14
      );
    }
  }
}
