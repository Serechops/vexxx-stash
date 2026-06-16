/**
 * XRSessionManager — owns the three.js renderer + immersive WebXR session.
 *
 * Rendering approach: three.js `renderer.xr` drives the session and per-eye
 * cameras (the robust, well-trodden WebXR video path). The video is shown on a
 * sphere (360) / hemisphere (180) / plane (flat) with a per-eye UV split for
 * stereo (left mesh → layer 1, right mesh → layer 2). This single path supports
 * every projection control (FOV, stereo, swap-eyes, recenter) and renders
 * crisply on Quest 3 at high framebuffer scale.
 *
 * NOTE: an `XREquirectLayer` media-layer "max quality" mode (compositor-sampled
 * video) is a planned follow-up — it needs on-device tuning and gracefully sits
 * behind this same manager interface.
 *
 * The floating UI (control bar + performers + scene-info panels) lives in one
 * group that is pinned in front of the viewer by default, grip-draggable, and
 * auto-hides after a few seconds of no input. Drawing is dirty-checked and the
 * UI fades as a unit so per-frame GPU work stays minimal.
 *
 * Playback state is *pulled* each frame via `getState()` and all interactions
 * are *pushed* out via `onAction`, so the React layer remains the only owner of
 * the <video> element and projection state.
 */
import * as THREE from "three";
import {
  IProjectionSettings,
  IUVTransform,
  horizontalCoverage,
  isStereo,
  uvTransformForEye,
} from "./projection";
import { VRControlPanel } from "./VRControls";
import { VRControllerInput, IPanelHit } from "./VRControllerInput";
import {
  VRCanvasPanel,
  VRPerformersPanel,
  VRSceneInfoPanel,
  IVRSceneInfo,
} from "./VRInfoPanels";
import { VRControlAction, IVRMarker, IVRPlaybackState } from "./types";
import type { IThumbnailCrop } from "./vttThumbnails";

const DOME_RADIUS = 500;
const PANEL_DISTANCE = 2.4;
const PANEL_DROP = 0.45; // metres below eye level
const PANEL_TILT = 0.18; // radians the UI group leans back toward the eyes

// Auto-hide: fade the whole UI out after this much input-free time, and back in
// on the next deliberate input. Applies even when the panel is pinned.
const AUTO_HIDE_MS = 4000;
const FADE_LERP = 0.18;
const POSITION_LERP = 0.18;

// Info-panel layout (above the control bar).
const UI_ABOVE_GAP = 0.04; // metres between controls top and info panels bottom
const PANEL_GAP_M = 0.06; // metres between side-by-side info panels

// Floating scrubber-hover thumbnail preview.
const THUMB_W_M = 0.6;
const THUMB_H_M = (THUMB_W_M * 9) / 16;
const THUMB_CANVAS_W = 320;
const THUMB_CANVAS_H = 180;

export interface IXRSessionManagerOptions {
  video: HTMLVideoElement;
  container: HTMLElement;
  projection: IProjectionSettings;
  /** Static, per-scene info for the performers + scene-info panels. */
  info: IVRSceneInfo;
  getState: () => IVRPlaybackState;
  getMarkers: () => IVRMarker[];
  getChapterTitle: () => string | null;
  getCaption: () => string | null;
  /** Sprite crop for a scrubber-hover preview, or null when unavailable. */
  getThumbnail?: (time: number) => IThumbnailCrop | null;
  onAction: (a: VRControlAction) => void;
  onEnd: () => void;
}

/** A panel the controller can hover/select, routed by its hit-target mesh. */
interface IHittable {
  target: THREE.Object3D;
  hover: (uv: THREE.Vector2 | null) => void;
  select: (uv: THREE.Vector2) => VRControlAction | null;
}

export class XRSessionManager {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private videoGroup: THREE.Group;
  private uiGroup: THREE.Group;
  private videoTexture: THREE.VideoTexture;
  private panel: VRControlPanel;
  private input: VRControllerInput;
  private session: XRSession | null = null;
  private projection: IProjectionSettings;
  private domeMeshes: THREE.Mesh[] = [];
  private opts: IXRSessionManagerOptions;
  private onSessionEnd = () => this.handleEnd();
  private tmpVec = new THREE.Vector3();
  private tmpTarget = new THREE.Vector3();
  private tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");

  // Auxiliary info panels (created only when the scene has content for them).
  private performersPanel: VRPerformersPanel | null = null;
  private sceneInfoPanel: VRSceneInfoPanel | null = null;
  private hittables: IHittable[] = [];

  // Panel is "pinned" (world-anchored + grip-draggable) by default, since a
  // head-following panel is jarring on entry. Toggle via the Pin button.
  private panelLocked = true;

  // Auto-hide fade state.
  private uiOpacity = 1;
  private lastActivity = 0;
  private placed = false;
  private hovering = false;

  // Scrubber-hover thumbnail preview (floats above the panel scrubber).
  private thumbPreview: THREE.Mesh;
  private thumbCanvas: HTMLCanvasElement;
  private thumbCtx: CanvasRenderingContext2D | null;
  private thumbTexture: THREE.CanvasTexture;
  private getThumb: ((time: number) => IThumbnailCrop | null) | null;
  private lastThumbKey: string | null = null;

  constructor(opts: IXRSessionManagerOptions) {
    this.opts = opts;
    this.projection = opts.projection;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType("local-floor");
    this.renderer.domElement.style.display = "none";
    opts.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
    // So the flat (non-immersive) preview shows the left eye.
    this.camera.layers.enable(1);

    this.videoGroup = new THREE.Group();
    this.uiGroup = new THREE.Group();
    this.scene.add(this.videoGroup);
    this.scene.add(this.uiGroup);

    this.videoTexture = new THREE.VideoTexture(opts.video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.videoTexture.magFilter = THREE.LinearFilter;
    this.videoTexture.generateMipmaps = false;

    this.panel = new VRControlPanel();
    this.panel.onAction = (a) => this.opts.onAction(a);
    this.uiGroup.add(this.panel.object);

    // Build the info panels, keeping only the ones with content, and lay them
    // out centred above the control bar.
    const present: VRCanvasPanel[] = [];
    const performers = new VRPerformersPanel(opts.info.performers);
    if (performers.hasContent) {
      this.performersPanel = performers;
      present.push(performers);
    } else {
      performers.dispose();
    }
    const sceneInfo = new VRSceneInfoPanel(opts.info);
    if (sceneInfo.hasContent) {
      this.sceneInfoPanel = sceneInfo;
      present.push(sceneInfo);
    } else {
      sceneInfo.dispose();
    }
    this.layoutInfoPanels(present);

    this.input = new VRControllerInput(this.renderer, this.scene, {
      onHover: (hit) => this.routeHover(hit),
      onSelect: (hit) => this.routeSelect(hit),
      onScrub: (seconds) =>
        this.opts.onAction({ type: "seekRelative", seconds }),
      onRecenter: () => this.recenter(),
    });

    // Assemble the hit-routing table (control bar + present info panels).
    this.hittables = [
      {
        target: this.panel.hitTarget,
        hover: (uv) => this.panel.setHovered(uv),
        select: (uv) => this.panel.activate(uv),
      },
      ...present.map((p) => ({
        target: p.hitTarget,
        hover: (uv: THREE.Vector2 | null) => p.setHovered(uv),
        select: (uv: THREE.Vector2) => p.activate(uv),
      })),
    ];
    this.input.setTargets(this.hittables.map((h) => h.target));
    // Pinned by default → grip grabs/drags the UI group (squeeze elsewhere
    // still recenters).
    this.input.setDraggable(this.uiGroup, true);

    // Thumbnail preview quad (child of the UI group so it rides the panel).
    this.getThumb = opts.getThumbnail ?? null;
    this.thumbCanvas = document.createElement("canvas");
    this.thumbCanvas.width = THUMB_CANVAS_W;
    this.thumbCanvas.height = THUMB_CANVAS_H;
    this.thumbCtx = this.thumbCanvas.getContext("2d");
    this.thumbTexture = new THREE.CanvasTexture(this.thumbCanvas);
    this.thumbTexture.colorSpace = THREE.SRGBColorSpace;
    this.thumbTexture.minFilter = THREE.LinearFilter;
    this.thumbTexture.magFilter = THREE.LinearFilter;
    this.thumbTexture.generateMipmaps = false;
    this.thumbPreview = new THREE.Mesh(
      new THREE.PlaneGeometry(THUMB_W_M, THUMB_H_M),
      new THREE.MeshBasicMaterial({
        map: this.thumbTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      })
    );
    this.thumbPreview.renderOrder = 12;
    this.thumbPreview.visible = false;
    this.uiGroup.add(this.thumbPreview);

    this.buildDome();
  }

  /** Attach an already-requested immersive session and start rendering. */
  async init(session: XRSession): Promise<void> {
    this.session = session;
    session.addEventListener("end", this.onSessionEnd);
    await this.renderer.xr.setSession(session);
    this.input.setSession(session);
    try {
      this.renderer.xr.setFoveation(0.5);
    } catch {
      /* not supported — ignore */
    }
    this.renderer.setAnimationLoop(this.render);
  }

  setProjection(projection: IProjectionSettings) {
    this.projection = projection;
    this.buildDome();
  }

  setHeatmap(cssUrl: string | null) {
    this.panel.setHeatmap(cssUrl);
  }

  /** Re-orient the video so the current gaze direction becomes its centre. */
  recenter() {
    const cam = this.renderer.xr.getCamera();
    this.tmpEuler.setFromQuaternion(cam.quaternion, "YXZ");
    this.videoGroup.rotation.y = this.tmpEuler.y;
  }

  /**
   * Toggle the control panel between head-following and pinned. When pinned the
   * panel stays where it is and can be grabbed/moved with the grip button.
   */
  toggleLock() {
    this.panelLocked = !this.panelLocked;
    this.input.setDraggable(this.uiGroup, this.panelLocked);
  }

  end() {
    this.session?.end().catch(() => undefined);
  }

  // --- hit routing ----------------------------------------------------------

  private routeHover(hit: IPanelHit | null) {
    this.hovering = !!hit;
    for (const h of this.hittables) {
      h.hover(hit && hit.object === h.target ? hit.uv : null);
    }
  }

  private routeSelect(hit: IPanelHit) {
    const h = this.hittables.find((x) => x.target === hit.object);
    if (!h) return;
    const action = h.select(hit.uv);
    if (action) this.opts.onAction(action);
  }

  /** Place the info panels centred in a row just above the control bar. */
  private layoutInfoPanels(panels: VRCanvasPanel[]) {
    if (!panels.length) return;
    const totalW =
      panels.reduce((s, p) => s + p.widthMeters, 0) +
      PANEL_GAP_M * (panels.length - 1);
    const bottomY = this.panel.heightMeters / 2 + UI_ABOVE_GAP;
    let x = -totalW / 2;
    for (const p of panels) {
      p.object.position.set(
        x + p.widthMeters / 2,
        bottomY + p.heightMeters / 2,
        0
      );
      this.uiGroup.add(p.object);
      x += p.widthMeters + PANEL_GAP_M;
    }
  }

  // --- dome construction ----------------------------------------------------

  private clearDome() {
    for (const m of this.domeMeshes) {
      this.videoGroup.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.domeMeshes = [];
  }

  private buildDome() {
    this.clearDome();
    const p = this.projection;

    if (p.fov === "flat") {
      this.domeMeshes.push(this.makeFlatScreen(p.zoom));
    } else if (isStereo(p)) {
      this.domeMeshes.push(this.makeDomeMesh(uvTransformForEye(p, "left"), 1));
      this.domeMeshes.push(this.makeDomeMesh(uvTransformForEye(p, "right"), 2));
    } else {
      // mono — single mesh on the default layer (visible to both eyes)
      this.domeMeshes.push(
        this.makeDomeMesh({ scaleX: 1, offsetX: 0, scaleY: 1, offsetY: 0 }, 0)
      );
    }

    for (const m of this.domeMeshes) this.videoGroup.add(m);
  }

  private makeDomeMesh(uv: IUVTransform, layer: number): THREE.Mesh {
    const coverage = horizontalCoverage(this.projection); // PI (180) or 2PI (360)
    const is180 = this.projection.fov === "180";
    // For 180, span the front hemisphere; phiStart calibrated so the centre
    // faces forward after the -PI/2 mesh rotation below. Full sphere for 360.
    const phiStart = is180 ? Math.PI / 2 : 0;
    const geometry = new THREE.SphereGeometry(
      DOME_RADIUS,
      64,
      40,
      phiStart,
      coverage
    );
    // Render the inside without mirroring the texture (proven recipe).
    geometry.scale(-1, 1, 1);
    this.applyUv(geometry, uv);

    const material = new THREE.MeshBasicMaterial({ map: this.videoTexture });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = -Math.PI / 2;
    mesh.layers.set(layer);
    return mesh;
  }

  private makeFlatScreen(zoom: number): THREE.Mesh {
    const w = 4 * zoom;
    const h = 2.25 * zoom; // 16:9
    const geometry = new THREE.PlaneGeometry(w, h);
    const material = new THREE.MeshBasicMaterial({ map: this.videoTexture });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 1.4, -3.2);
    mesh.layers.set(0);
    return mesh;
  }

  private applyUv(geometry: THREE.BufferGeometry, t: IUVTransform) {
    const { uv } = geometry.attributes;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(
        i,
        uv.getX(i) * t.scaleX + t.offsetX,
        uv.getY(i) * t.scaleY + t.offsetY
      );
    }
    uv.needsUpdate = true;
  }

  // --- render loop ----------------------------------------------------------

  private render = (time: number) => {
    // Ensure the XR sub-cameras see their stereo eye layers.
    const xrCam = this.renderer.xr.getCamera() as THREE.ArrayCamera;
    if (xrCam.cameras && xrCam.cameras.length >= 2) {
      xrCam.cameras[0].layers.enable(1);
      xrCam.cameras[1].layers.enable(2);
    }

    // Snap the UI in front of the viewer once on entry (default pinned); after
    // that, hold position when pinned, or head-follow when unpinned. Wait for a
    // valid viewer pose first — on the very first frame(s) the headset pose may
    // not be acquired yet (camera at the origin) and we'd pin it off to a side.
    if (!this.placed) {
      this.tmpVec.setFromMatrixPosition(xrCam.matrixWorld);
      if (this.tmpVec.lengthSq() > 0.01) {
        this.placeUiInstant(xrCam);
        this.placed = true;
        this.lastActivity = time;
      }
    } else if (!this.panelLocked) {
      this.positionUi(xrCam);
    }

    // Drive controllers (hover/scrub/drag) and gather this-frame activity.
    this.input.update();
    if (this.input.consumeActivity() || this.hovering) {
      this.lastActivity = time;
    }

    // Auto-hide: fade the whole UI group toward visible/hidden.
    const idle = time - this.lastActivity > AUTO_HIDE_MS;
    this.uiOpacity += ((idle ? 0 : 1) - this.uiOpacity) * FADE_LERP;
    const op = this.uiOpacity;
    this.panel.setRenderState(op);
    this.performersPanel?.setRenderState(op);
    this.sceneInfoPanel?.setRenderState(op);

    const state = this.opts.getState();
    if (op > 0.02) {
      this.panel.update({
        state,
        projection: this.projection,
        markers: this.opts.getMarkers(),
        chapterTitle: this.opts.getChapterTitle(),
        caption: this.opts.getCaption(),
        locked: this.panelLocked,
      });
      this.performersPanel?.update();
      this.sceneInfoPanel?.update();
    }

    this.updateThumbnailPreview(state.duration, op);

    this.renderer.render(this.scene, this.camera);
  };

  /** Snap the UI group directly in front of the viewer (yaw-only). */
  private placeUiInstant(cam: THREE.Camera) {
    this.tmpVec.setFromMatrixPosition(cam.matrixWorld);
    this.tmpEuler.setFromQuaternion(cam.quaternion, "YXZ");
    const yaw = this.tmpEuler.y;
    this.uiGroup.position.set(
      this.tmpVec.x - Math.sin(yaw) * PANEL_DISTANCE,
      this.tmpVec.y - PANEL_DROP,
      this.tmpVec.z - Math.cos(yaw) * PANEL_DISTANCE
    );
    this.uiGroup.rotation.set(PANEL_TILT, yaw, 0);
  }

  /** Keep the control panel comfortably in front of the user (yaw-only). */
  private positionUi(cam: THREE.Camera) {
    this.tmpVec.setFromMatrixPosition(cam.matrixWorld);
    this.tmpEuler.setFromQuaternion(cam.quaternion, "YXZ");
    const yaw = this.tmpEuler.y;

    this.tmpTarget.set(
      this.tmpVec.x - Math.sin(yaw) * PANEL_DISTANCE,
      this.tmpVec.y - PANEL_DROP,
      this.tmpVec.z - Math.cos(yaw) * PANEL_DISTANCE
    );
    this.uiGroup.position.lerp(this.tmpTarget, POSITION_LERP);

    // Smoothly turn the panel to face the user.
    const current = this.uiGroup.rotation.y;
    let delta = yaw - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.uiGroup.rotation.y = current + delta * POSITION_LERP;
    // Tilt slightly up toward the eyes since the panel sits below eye level.
    this.uiGroup.rotation.x = PANEL_TILT;
  }

  /** Float a VTT thumbnail above the scrubber while it's being hovered. */
  private updateThumbnailPreview(duration: number, uiOpacity: number) {
    const frac = this.panel.scrubberHoverFraction;
    if (
      uiOpacity < 0.5 ||
      frac == null ||
      !this.getThumb ||
      !this.thumbCtx ||
      !duration ||
      !isFinite(duration)
    ) {
      this.thumbPreview.visible = false;
      return;
    }
    const crop = this.getThumb(frac * duration);
    if (!crop) {
      this.thumbPreview.visible = false;
      return;
    }

    // Only redraw the preview canvas when the sprite crop actually changes —
    // holding still over one region costs no texture upload.
    const img = crop.image as HTMLImageElement;
    const key = `${img.src ?? ""}#${crop.sx},${crop.sy},${crop.sw},${crop.sh}`;
    if (key !== this.lastThumbKey) {
      this.thumbCtx.clearRect(0, 0, THUMB_CANVAS_W, THUMB_CANVAS_H);
      try {
        this.thumbCtx.drawImage(
          crop.image,
          crop.sx,
          crop.sy,
          crop.sw,
          crop.sh,
          0,
          0,
          THUMB_CANVAS_W,
          THUMB_CANVAS_H
        );
      } catch {
        // tainted/incomplete image — skip this frame
        this.thumbPreview.visible = false;
        return;
      }
      this.thumbCtx.strokeStyle = "rgba(255,255,255,0.6)";
      this.thumbCtx.lineWidth = 4;
      this.thumbCtx.strokeRect(0, 0, THUMB_CANVAS_W, THUMB_CANVAS_H);
      this.thumbTexture.needsUpdate = true;
      this.lastThumbKey = key;
    }

    // Position above the scrubber at the hovered fraction, clamped to the panel.
    const anchor = this.panel.scrubberAnchorLocal(frac);
    const limit = this.panel.widthMeters / 2 - THUMB_W_M / 2;
    const x = Math.min(limit, Math.max(-limit, anchor.x));
    this.thumbPreview.position.set(
      x,
      anchor.y + THUMB_H_M / 2 + 0.06,
      anchor.z + 0.02
    );
    (this.thumbPreview.material as THREE.MeshBasicMaterial).opacity = uiOpacity;
    this.thumbPreview.visible = true;
  }

  private handleEnd() {
    this.opts.onEnd();
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.session?.removeEventListener("end", this.onSessionEnd);
    this.input.dispose();
    this.panel.dispose();
    this.performersPanel?.dispose();
    this.sceneInfoPanel?.dispose();
    this.thumbTexture.dispose();
    (this.thumbPreview.material as THREE.Material).dispose();
    this.thumbPreview.geometry.dispose();
    this.clearDome();
    this.videoTexture.dispose();
    this.renderer.domElement.remove();
    this.renderer.dispose();
    this.session = null;
  }
}
