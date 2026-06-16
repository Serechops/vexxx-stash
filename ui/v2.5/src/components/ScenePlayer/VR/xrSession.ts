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
import { VRControllerInput } from "./VRControllerInput";
import { VRControlAction, IVRMarker, IVRPlaybackState } from "./types";
import type { IThumbnailCrop } from "./vttThumbnails";

const DOME_RADIUS = 500;
const PANEL_DISTANCE = 2.4;
const PANEL_DROP = 0.45; // metres below eye level

// Floating scrubber-hover thumbnail preview.
const THUMB_W_M = 0.6;
const THUMB_H_M = (THUMB_W_M * 9) / 16;
const THUMB_CANVAS_W = 320;
const THUMB_CANVAS_H = 180;

export interface IXRSessionManagerOptions {
  video: HTMLVideoElement;
  container: HTMLElement;
  projection: IProjectionSettings;
  getState: () => IVRPlaybackState;
  getMarkers: () => IVRMarker[];
  getChapterTitle: () => string | null;
  getCaption: () => string | null;
  /** Sprite crop for a scrubber-hover preview, or null when unavailable. */
  getThumbnail?: (time: number) => IThumbnailCrop | null;
  onAction: (a: VRControlAction) => void;
  onEnd: () => void;
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
  private tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");

  // Panel is "pinned" (world-anchored + grip-draggable) vs head-following.
  private panelLocked = false;

  // Scrubber-hover thumbnail preview (floats above the panel scrubber).
  private thumbPreview: THREE.Mesh;
  private thumbCanvas: HTMLCanvasElement;
  private thumbCtx: CanvasRenderingContext2D | null;
  private thumbTexture: THREE.CanvasTexture;
  private getThumb: ((time: number) => IThumbnailCrop | null) | null;

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

    this.input = new VRControllerInput(this.renderer, this.scene, {
      onHover: (uv) => this.panel.setHovered(uv),
      onSelect: (uv) => {
        const action = this.panel.activate(uv);
        if (action) this.opts.onAction(action);
      },
      onScrub: (seconds) =>
        this.opts.onAction({ type: "seekRelative", seconds }),
      onRecenter: () => this.recenter(),
    });
    this.input.setTarget(this.panel.hitTarget);

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

  private render = () => {
    // Ensure the XR sub-cameras see their stereo eye layers.
    const xrCam = this.renderer.xr.getCamera() as THREE.ArrayCamera;
    if (xrCam.cameras && xrCam.cameras.length >= 2) {
      xrCam.cameras[0].layers.enable(1);
      xrCam.cameras[1].layers.enable(2);
    }

    // Head-follow the panel only when it isn't pinned in place.
    if (!this.panelLocked) this.positionUi(xrCam);

    const state = this.opts.getState();
    this.panel.update({
      state,
      projection: this.projection,
      markers: this.opts.getMarkers(),
      chapterTitle: this.opts.getChapterTitle(),
      caption: this.opts.getCaption(),
      locked: this.panelLocked,
    });

    this.input.update();
    this.updateThumbnailPreview(state.duration);

    this.renderer.render(this.scene, this.camera);
  };

  /** Keep the control panel comfortably in front of the user (yaw-only). */
  private positionUi(cam: THREE.Camera) {
    this.tmpVec.setFromMatrixPosition(cam.matrixWorld);
    this.tmpEuler.setFromQuaternion(cam.quaternion, "YXZ");
    const yaw = this.tmpEuler.y;

    const target = new THREE.Vector3(
      this.tmpVec.x - Math.sin(yaw) * PANEL_DISTANCE,
      this.tmpVec.y - PANEL_DROP,
      this.tmpVec.z - Math.cos(yaw) * PANEL_DISTANCE
    );
    this.uiGroup.position.lerp(target, 0.18);

    // Smoothly turn the panel to face the user.
    const current = this.uiGroup.rotation.y;
    let delta = yaw - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.uiGroup.rotation.y = current + delta * 0.18;
    // Tilt slightly up toward the eyes since the panel sits below eye level.
    this.uiGroup.rotation.x = 0.18;
  }

  /** Float a VTT thumbnail above the scrubber while it's being hovered. */
  private updateThumbnailPreview(duration: number) {
    const frac = this.panel.scrubberHoverFraction;
    if (
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

    // Position above the scrubber at the hovered fraction, clamped to the panel.
    const anchor = this.panel.scrubberAnchorLocal(frac);
    const limit = this.panel.widthMeters / 2 - THUMB_W_M / 2;
    const x = Math.min(limit, Math.max(-limit, anchor.x));
    this.thumbPreview.position.set(
      x,
      anchor.y + THUMB_H_M / 2 + 0.06,
      anchor.z + 0.02
    );
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
