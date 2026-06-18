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
 * The floating UI is one consolidated control panel (transport + performers
 * carousel + tag/chapter strips) plus a collapsible Handy sub-panel, living in
 * one group that is pinned in front of the viewer by default, grip-draggable,
 * and auto-hides after a few seconds of no input. Drawing is dirty-checked and
 * the UI fades as a unit so per-frame GPU work stays minimal.
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
import { VRControlPanel, IDrawInput } from "./VRControls";
import { VRControllerInput, IPanelHit } from "./VRControllerInput";
import { VRHandyPanel, VRInfoPanel, IVRSceneInfo } from "./VRInfoPanels";
import { VRControlAction, IVRMarker, IVRPlaybackState, IVRHandyState } from "./types";
import type { IThumbnailCrop } from "./vttThumbnails";

const DOME_RADIUS = 500;
const PANEL_DISTANCE = 2.4;
const PANEL_DROP = 0.45; // metres below eye level
const PANEL_TILT = 0.18; // radians the UI group leans back toward the eyes

// Auto-hide: fade the whole UI out after this much hand/controller-input-free
// time, and back in on the next deliberate input.
const AUTO_HIDE_MS = 4000;
const FADE_LERP = 0.18;

// Floating scrubber-hover thumbnail preview (enlarged for legibility, with a
// marker-name caption overlaid when the hovered position falls inside a marker).
const THUMB_W_M = 0.9;
const THUMB_H_M = (THUMB_W_M * 9) / 16;
const THUMB_CANVAS_W = 480;
const THUMB_CANVAS_H = 270;

/**
 * Debug bisection flags for the on-device flicker hunt, read from the URL
 * (`?vrDebug=solid,mono`) or localStorage `vrDebug`. All default off, so the
 * normal render path is unchanged. Flags:
 *   solid      — dome uses a flat colour, not the video texture (isolates the
 *                VideoTexture / per-frame upload as the flicker source)
 *   mono       — force a single mono dome mesh (isolates the stereo eye-layer
 *                assignment)
 *   noaa       — disable renderer MSAA (antialias)
 *   nofov      — disable fixed-foveated rendering
 *   hideui     — keep the whole UI hidden (isolates panel rendering)
 *   noautohide — keep the UI permanently visible (isolates the auto-hide fade)
 */
function readVrDebug(): Set<string> {
  const out = new Set<string>();
  try {
    const url = new URLSearchParams(window.location.search).get("vrDebug");
    const ls = window.localStorage.getItem("vrDebug");
    for (const raw of [url, ls]) {
      if (!raw) continue;
      for (const part of raw.split(",")) {
        const t = part.trim().toLowerCase();
        if (t) out.add(t);
      }
    }
  } catch {
    /* SSR / blocked storage — ignore */
  }
  return out;
}

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
  /** Handy connection state, for the VR Handy panel status bar. */
  getHandyState?: () => IVRHandyState;
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
  private debug: Set<string>;
  private onSessionEnd = () => this.handleEnd();
  private tmpVec = new THREE.Vector3();
  private tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");

  // Collapsible Handy (interactive device) sub-panel, toggled from the bar.
  private handyPanel: VRHandyPanel | null = null;
  private handyPanelOpen = false;
  // Scene-info side panel (performers, tags, chapters), toggled via 'i' button.
  private infoPanel: VRInfoPanel | null = null;
  private infoPanelOpen = false;
  private hittables: IHittable[] = [];
  // Reused per-frame draw payload (avoids allocating an object every frame).
  private drawInput: IDrawInput;

  // Auto-hide fade state. The UI is world-anchored (never head-follows) and is
  // moved only by grabbing it; it just fades out after a spell of no input.
  private uiOpacity = 1;
  private lastActivity = 0;
  private placed = false;

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
    this.debug = readVrDebug();
    if (this.debug.size) {
      // eslint-disable-next-line no-console
      console.info("[VR debug] flags:", [...this.debug].join(", "));
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.debug.has("noaa"),
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

    // The control bar is now the single consolidated UI surface: it carries the
    // performers carousel and the tag/chapter strips that used to be separate
    // side "monitor" panels.
    this.panel = new VRControlPanel();
    this.uiGroup.add(this.panel.object);
    this.drawInput = {
      state: opts.getState(),
      projection: this.projection,
      markers: opts.getMarkers(),
      chapterTitle: null,
      caption: null,
      handyOpen: false,
      infoOpen: false,
    };

    // Handy (interactive) panel — a collapsible sub-panel, opened/closed by the
    // Handy toggle in the bar. Always created so the device can be connected from
    // the immersive view even for scenes without funscript data.
    const handy = new VRHandyPanel();
    this.handyPanel = handy;
    this.uiGroup.add(handy.object);
    this.layoutHandyPanel(handy);
    handy.setRenderState(0);

    // Scene-info panel (performers + tags + chapters) — toggled via the 'i'
    // button, placed to the LEFT of the main bar and angled toward the viewer.
    const infoPane = new VRInfoPanel(opts.info);
    this.infoPanel = infoPane;
    this.uiGroup.add(infoPane.object);
    this.layoutInfoPanel(infoPane);
    infoPane.setRenderState(0);

    this.input = new VRControllerInput(this.renderer, this.scene, {
      onHover: (hit) => this.routeHover(hit),
      onSelect: (hit) => this.routeSelect(hit),
      onScrub: (seconds) =>
        this.opts.onAction({ type: "seekRelative", seconds }),
      onRecenter: () => this.recenter(),
      onClap: () => {
        // Clap gesture: show the UI panels immediately.  This is the primary
        // way users bring the controls back up during playback — unlike hand
        // movement (which is constant during VR playback), a deliberate two-
        // hand-together gesture is unambiguous.
        this.lastActivity = performance.now();
        this.uiOpacity = 1;
      },
    });

    // Hit-routing table: the control bar plus the (visibility-gated) Handy panel.
    this.hittables = [
      {
        target: this.panel.hitTarget,
        hover: (uv) => this.panel.setHovered(uv),
        select: (uv) => this.panel.activate(uv),
      },
    ];
    if (this.handyPanel) {
      const hp = this.handyPanel;
      this.hittables.push({
        target: hp.hitTarget,
        hover: (uv: THREE.Vector2 | null) => hp.setHovered(uv),
        select: (uv: THREE.Vector2) => hp.activate(uv),
      });
    }
    if (this.infoPanel) {
      const ip = this.infoPanel;
      this.hittables.push({
        target: ip.hitTarget,
        hover: (uv: THREE.Vector2 | null) => ip.setHovered(uv),
        select: (uv: THREE.Vector2) => ip.activate(uv),
      });
    }
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
    this.thumbPreview.frustumCulled = false;
    this.thumbPreview.visible = false;
    this.uiGroup.add(this.thumbPreview);

    this.buildDome();
  }

  /**
   * Place the Handy panel to the right of the main control bar, vertically
   * centred, and angled ~40° inward so it faces the viewer rather than being
   * a flat wall at the side.
   */
  private layoutHandyPanel(panel: VRHandyPanel) {
    const barRight = this.panel.widthMeters / 2;
    const gapM = 0.06;
    panel.object.position.set(barRight + gapM + panel.widthMeters / 2, 0, 0.02);
    // Negative Y rotation turns the right-side panel to face left (toward viewer).
    panel.object.rotation.set(0, -Math.PI / 4.5, 0);
  }

  /**
   * Place the Info panel to the left of the main control bar, vertically
   * centred, and angled ~40° inward so it faces the viewer.
   */
  private layoutInfoPanel(panel: VRInfoPanel) {
    const barLeft = this.panel.widthMeters / 2;
    const gapM = 0.06;
    panel.object.position.set(-(barLeft + gapM + panel.widthMeters / 2), 0, 0.02);
    // Positive Y rotation turns the left-side panel to face right (toward viewer).
    panel.object.rotation.set(0, Math.PI / 4.5, 0);
  }

  /** Attach an already-requested immersive session and start rendering. */
  async init(session: XRSession): Promise<void> {
    this.session = session;
    session.addEventListener("end", this.onSessionEnd);
    await this.renderer.xr.setSession(session);
    this.input.setSession(session);
    try {
      this.renderer.xr.setFoveation(this.debug.has("nofov") ? 0 : 0.5);
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

  end() {
    this.session?.end().catch(() => undefined);
  }

  // --- hit routing ----------------------------------------------------------

  private routeHover(hit: IPanelHit | null) {
    for (const h of this.hittables) {
      h.hover(hit && hit.object === h.target ? hit.uv : null);
    }
  }

  private routeSelect(hit: IPanelHit) {
    const h = this.hittables.find((x) => x.target === hit.object);
    if (!h) return;
    const action = h.select(hit.uv);
    if (!action) return;
    // The Handy toggle is owned by the manager (it shows/hides the sub-panel),
    // so it's handled here rather than forwarded to the React action handler.
    if (action.type === "handyPanelToggle") {
      this.handyPanelOpen = !this.handyPanelOpen;
      this.lastActivity = performance.now();
      return;
    }
    if (action.type === "infoPanelToggle") {
      this.infoPanelOpen = !this.infoPanelOpen;
      this.lastActivity = performance.now();
      return;
    }
    this.opts.onAction(action);
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
    } else if (isStereo(p) && !this.debug.has("mono")) {
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

    const material = this.debug.has("solid")
      ? new THREE.MeshBasicMaterial({ color: 0x224466 })
      : new THREE.MeshBasicMaterial({ map: this.videoTexture });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = -Math.PI / 2;
    mesh.layers.set(layer);
    // Never frustum-cull: the viewer is inside this dome, so a marginal
    // bounding-sphere test must never blank the whole video as the head turns.
    mesh.frustumCulled = false;
    return mesh;
  }

  private makeFlatScreen(zoom: number): THREE.Mesh {
    const w = 4 * zoom;
    const h = 2.25 * zoom; // 16:9
    const geometry = new THREE.PlaneGeometry(w, h);
    const material = this.debug.has("solid")
      ? new THREE.MeshBasicMaterial({ color: 0x224466 })
      : new THREE.MeshBasicMaterial({ map: this.videoTexture });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 1.4, -3.2);
    mesh.layers.set(0);
    mesh.frustumCulled = false;
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
    // CRITICAL: force the video texture to upload the latest decoded video
    // frame to the GPU every XR render cycle.  Without this, Three.js's
    // internal VideoTexture update timer can desync from the XR compositor's
    // frame pacing (especially on Quest's mobile GPU), causing intermittent
    // black frames when the compositor samples a stale/uninitialized texture.
    // This is a well-known cause of the "black flicker every few seconds"
    // issue with stereo WebXR video playback.
    this.videoTexture.needsUpdate = true;

    // Ensure the XR sub-cameras see their stereo eye layers.
    const xrCam = this.renderer.xr.getCamera() as THREE.ArrayCamera;
    if (xrCam.cameras && xrCam.cameras.length >= 2) {
      xrCam.cameras[0].layers.enable(1);
      xrCam.cameras[1].layers.enable(2);
    }

    // Snap the UI in front of the viewer once on entry, then leave it world-
    // anchored — it never head-follows; the user repositions it by grabbing it
    // with the grip. Wait for a valid viewer pose first — on the very first
    // frame(s) the headset pose may not be acquired yet (camera at the origin)
    // and we'd place it off to a side.
    if (!this.placed) {
      this.tmpVec.setFromMatrixPosition(xrCam.matrixWorld);
      if (this.tmpVec.lengthSq() > 0.01) {
        this.placeUiInstant(xrCam);
        this.placed = true;
        this.lastActivity = time;
      }
    }

    // Drive controllers (hover/scrub/drag) and gather this-frame activity.
    // Auto-hide is driven purely by hand/controller activity (movement, stick,
    // buttons) — never by head direction or where the laser happens to point.
    this.input.update();
    if (this.input.consumeActivity()) {
      this.lastActivity = time;
    }
    // A controller actively pointing at a panel counts as interaction: keep the
    // UI visible for as long as the user is aiming at it (without requiring a
    // press), so they have time to read and target elements.
    if (this.input.isHoveringPanel) {
      this.lastActivity = time;
    }

    // Auto-hide: fade the whole UI group toward visible/hidden. Debug flags can
    // pin it fully hidden or fully shown to isolate UI rendering vs the dome.
    if (this.debug.has("hideui")) {
      this.uiOpacity = 0;
    } else if (this.debug.has("noautohide")) {
      this.uiOpacity = 1;
    } else {
      const idle = time - this.lastActivity > AUTO_HIDE_MS;
      this.uiOpacity += ((idle ? 0 : 1) - this.uiOpacity) * FADE_LERP;
    }
    const op = this.uiOpacity;
    this.panel.setRenderState(op);
    // Show laser rays only when the UI is visible — no point beaming through
    // an invisible panel, and it avoids visual clutter during immersive play.
    this.input.setRaysVisible(op > 0.05);
    // Side panels only render (and are only interactable) while open.
    this.handyPanel?.setRenderState(this.handyPanelOpen ? op : 0);
    this.infoPanel?.setRenderState(this.infoPanelOpen ? op : 0);

    const state = this.opts.getState();
    if (op > 0.02) {
      const d = this.drawInput;
      d.state = state;
      d.projection = this.projection;
      d.markers = this.opts.getMarkers();
      d.chapterTitle = this.opts.getChapterTitle();
      d.caption = this.opts.getCaption();
      d.handyOpen = this.handyPanelOpen;
      d.infoOpen = this.infoPanelOpen;
      this.panel.sync(d);
      // Push the latest Handy connection state to the VR panel each frame.
      if (this.handyPanelOpen && this.handyPanel) {
        if (this.opts.getHandyState) {
          this.handyPanel.setHandyState(this.opts.getHandyState());
        }
        this.handyPanel.update();
      }
      // Drive dirty-checked redraws for the info panel (performer images loading).
      if (this.infoPanelOpen && this.infoPanel) {
        this.infoPanel.update();
      }
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

  /** Title of the marker/chapter whose span contains `time`, or null. */
  private markerTitleAt(time: number): string | null {
    const markers = this.opts.getMarkers();
    for (let i = markers.length - 1; i >= 0; i--) {
      if (time >= markers[i].seconds) {
        const end = markers[i].endSeconds;
        if (end != null && time > end) return null;
        return markers[i].title || null;
      }
    }
    return null;
  }

  /** Draw a bottom-anchored marker-name caption onto the preview canvas. */
  private drawThumbCaption(title: string) {
    const ctx = this.thumbCtx;
    if (!ctx) return;
    const barH = 46;
    const grad = ctx.createLinearGradient(
      0,
      THUMB_CANVAS_H - barH,
      0,
      THUMB_CANVAS_H
    );
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.88)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, THUMB_CANVAS_H - barH, THUMB_CANVAS_W, barH);

    ctx.font = "600 24px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    let label = title;
    const maxW = THUMB_CANVAS_W - 28;
    if (ctx.measureText(label).width > maxW) {
      while (label.length > 1 && ctx.measureText(`${label}…`).width > maxW) {
        label = label.slice(0, -1);
      }
      label = `${label}…`;
    }
    ctx.fillText(label, THUMB_CANVAS_W / 2, THUMB_CANVAS_H - 14);
  }

  /**
   * Float a preview above the scrubber while it's being hovered: the VTT
   * thumbnail when available, plus the name of the marker the hovered position
   * sits within. When there's no thumbnail but the position is inside a marker,
   * a name-only plate is shown so hovering still previews the marker.
   */
  private updateThumbnailPreview(duration: number, uiOpacity: number) {
    const frac = this.panel.scrubberHoverFraction;
    if (
      uiOpacity < 0.5 ||
      frac == null ||
      !this.thumbCtx ||
      !duration ||
      !isFinite(duration)
    ) {
      this.thumbPreview.visible = false;
      return;
    }
    const time = frac * duration;
    const title = this.markerTitleAt(time);
    const crop = this.getThumb ? this.getThumb(time) : null;
    if (!crop && !title) {
      this.thumbPreview.visible = false;
      return;
    }

    // Only redraw the preview canvas when the sprite crop or marker name
    // actually changes — holding still costs no texture upload.
    const img = crop ? (crop.image as HTMLImageElement) : null;
    const key = crop
      ? `${img?.src ?? ""}#${crop.sx},${crop.sy},${crop.sw},${crop.sh}#${title ?? ""}`
      : `nothumb#${title ?? ""}`;
    if (key !== this.lastThumbKey) {
      this.thumbCtx.clearRect(0, 0, THUMB_CANVAS_W, THUMB_CANVAS_H);
      if (crop) {
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
      } else {
        // No thumbnail — solid plate behind the marker name.
        this.thumbCtx.fillStyle = "rgba(12,16,32,0.92)";
        this.thumbCtx.fillRect(0, 0, THUMB_CANVAS_W, THUMB_CANVAS_H);
      }
      this.thumbCtx.strokeStyle = "rgba(255,255,255,0.6)";
      this.thumbCtx.lineWidth = 4;
      this.thumbCtx.strokeRect(0, 0, THUMB_CANVAS_W, THUMB_CANVAS_H);
      if (title) this.drawThumbCaption(title);
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
    this.handyPanel?.dispose();
    this.infoPanel?.dispose();
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
