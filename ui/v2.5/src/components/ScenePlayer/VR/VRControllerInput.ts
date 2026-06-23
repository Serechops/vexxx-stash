/**
 * VRControllerInput — Quest Touch controller handling.
 *
 * Builds a laser pointer per controller, raycasts against any number of control
 * panels for hover/select (reporting *which* panel was hit so the session
 * manager can route the interaction), and reads gamepad axes for thumbstick
 * scrubbing. The grip (squeeze) button either grabs-and-drags the panel group
 * (when it's unpinned-into-drag-mode and being pointed at) or recenters.
 *
 * It also surfaces a per-frame "activity" signal (any deliberate controller
 * movement, thumbstick deflection or button press) so the manager can auto-hide
 * the UI after a period of inactivity and reveal it again on the next input.
 *
 * All resolved interactions are surfaced through callbacks; this class owns no
 * playback state.
 */
import * as THREE from "three";

/** A raycast hit on one of the registered panels. */
export interface IPanelHit {
  object: THREE.Object3D;
  uv: THREE.Vector2;
}

export interface IControllerInputCallbacks {
  onHover: (hit: IPanelHit | null) => void;
  onSelect: (hit: IPanelHit) => void;
  /** Trigger held and dragged across a panel (drag-to-scroll carousels). */
  onSelectMove: (hit: IPanelHit) => void;
  /** Trigger released; hit is the panel under the ray at release, or null. */
  onSelectEnd: (hit: IPanelHit | null) => void;
  /** Thumbstick nudge, in (signed) seconds. */
  onScrub: (deltaSeconds: number) => void;
  onRecenter: () => void;
  /**
   * Clap gesture detected: both controllers are within CLAP_DISTANCE of each
   * other (i.e. the user brought their hands together), which should show
   * the UI panels.  Fires once per clap.
   */
  onClap: () => void;
}

const LASER_LENGTH = 5;
// Thumbstick scrub is edge-triggered: it fires once per deflection past
// SCRUB_FIRE, then must return below SCRUB_REARM before it can fire again.
// This stops a held/feathered stick from rapidly re-seeking ("too sensitive").
const SCRUB_FIRE = 0.7;
const SCRUB_REARM = 0.3;
const SCRUB_SECONDS = 10;
// Grip-drag push/pull (thumbstick Y) bounds + per-frame step, metres.
const DRAG_MIN = 0.6;
const DRAG_MAX = 6;
const DRAG_STEP = 0.04;
// Clap gesture: both controller grip positions must be within this distance
// (metres) of each other. On Quest controllers the resting "arms down" pose
// is ~0.5–0.7 m apart; hands brought together for a clap are ~0.15–0.25 m.
const CLAP_DISTANCE = 0.32;
// Activity thresholds: deliberate input past these counts as "user is
// interacting" and wakes / keeps-awake the auto-hiding UI.
// NOTE: only buttons, thumbsticks, and the squeeze trigger wake the UI.
// Controller *movement* alone does NOT — that would make the panels pop
// back up during playback every time the user shifts their hands (which
// happens constantly in VR).  The user must either press a button, touch
// the thumbstick, squeeze (grab), or clap both hands together.
const WAKE_STICK = 0.2; // thumbstick magnitude

export class VRControllerInput {
  private controllers: THREE.Group[] = [];
  private lasers: THREE.Line[] = [];
  private raycaster = new THREE.Raycaster();
  private rotMatrix = new THREE.Matrix4();
  private targets: THREE.Object3D[] = [];
  // Reused intersection buffer so per-frame raycasts allocate no arrays.
  private rayResults: THREE.Intersection[] = [];
  private session: XRSession | null = null;
  private disposers: Array<() => void> = [];

  // Edge-trigger state for thumbstick scrubbing.
  private scrubArmed = true;

  // Trigger-press tracking for drag-to-scroll + tap-to-select on panels. While
  // the trigger is held, drag moves are streamed to the pressed panel; the panel
  // resolves tap-vs-drag itself on release.
  private pressController: THREE.Group | null = null;
  private pressObject: THREE.Object3D | null = null;

  // Clap detection: count how many frames both controllers are within
  // CLAP_DISTANCE. Only fires the callback once per sustained clap (when
  // frames-clapped transitions from < threshold to ≥ threshold).
  private clapFrameCount = 0;
  private clapFired = false;
  private readonly CLAP_FRAMES_MIN = 3; // frames both hands must be close
  private tmpPositions: THREE.Vector3[] = [
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  // Grip-drag state (moving the control panel around).
  private draggable: THREE.Object3D | null = null;
  private dragEnabled = false;
  private draggingController: THREE.Group | null = null;
  private grabDistance = 2.4;

  // Activity tracking for auto-hide.
  private activity = false;

  // Whether any controller is currently pointing at a registered panel.
  private hoveringPanel = false;

  private tmpV1 = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private camPos = new THREE.Vector3();

  // ── Ray stabilisation ──────────────────────────────────────────────────────
  // Quest controllers jitter a few tenths of a degree at rest, and pulling the
  // trigger torques the controller — both kick the laser off the intended
  // target right as the user clicks, turning a tap into a drag. A One-Euro
  // adaptive low-pass steadies a held ray without lagging deliberate sweeps: the
  // cutoff rises with angular speed, so fast intentional motion stays ~1:1 while
  // a near-stationary ray is heavily smoothed. Tune on-device.
  private readonly RAY_MIN_CUTOFF = 1.6; // Hz — lower = steadier when still
  private readonly RAY_BETA = 0.05; // speed coupling — higher = snappier
  private smoothDir: THREE.Vector3[] = [
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  private smoothOrigin: THREE.Vector3[] = [
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  private rayInit = [false, false];
  private lastRayTime = 0;
  private rawDir = new THREE.Vector3();
  private rawOrigin = new THREE.Vector3();
  private readonly FORWARD = new THREE.Vector3(0, 0, -1);

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private cb: IControllerInputCallbacks
  ) {
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);

      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1),
      ]);
      const laser = new THREE.Line(
        geom,
        new THREE.LineBasicMaterial({
          color: 0x60a5fa,
          transparent: true,
          opacity: 0.65,
        })
      );
      laser.scale.z = LASER_LENGTH;
      laser.renderOrder = 11;
      // The laser is parented to the SCENE (not the controller) so it can be
      // driven from the *filtered* ray each frame — the visible dot then lands
      // exactly where the raycast hits, even though the filtered ray lags the
      // raw controller pose slightly. (See refreshRays / the ray-stabilisation
      // fields below.)
      scene.add(laser);

      const onSelectStart = () => {
        this.activity = true;
        const hit = this.intersect(controller);
        if (hit) {
          this.pressController = controller;
          this.pressObject = hit.object;
          this.cb.onSelect(hit);
        }
      };
      const onSelectEnd = () => {
        if (this.pressController !== controller) return;
        const obj = this.pressObject;
        const uv = obj ? this.uvOnObject(controller, obj) : null;
        this.cb.onSelectEnd(obj && uv ? { object: obj, uv } : null);
        this.pressController = null;
        this.pressObject = null;
      };
      const onSqueezeStart = () => {
        this.activity = true;
        this.beginGrabOrRecenter(controller);
      };
      const onSqueezeEnd = () => this.endGrab(controller);
      controller.addEventListener("selectstart", onSelectStart);
      controller.addEventListener("selectend", onSelectEnd);
      controller.addEventListener("squeezestart", onSqueezeStart);
      controller.addEventListener("squeezeend", onSqueezeEnd);
      this.disposers.push(() => {
        controller.removeEventListener("selectstart", onSelectStart);
        controller.removeEventListener("selectend", onSelectEnd);
        controller.removeEventListener("squeezestart", onSqueezeStart);
        controller.removeEventListener("squeezeend", onSqueezeEnd);
      });

      scene.add(controller);
      this.controllers.push(controller);
      this.lasers.push(laser);
    }
  }

  setSession(session: XRSession | null) {
    this.session = session;
  }

  /** The set of panel meshes to raycast against (hover/select). */
  setTargets(targets: THREE.Object3D[]) {
    this.targets = targets;
  }

  /**
   * Mark an object as grip-draggable. When enabled, squeezing while pointing at
   * a panel grabs it; otherwise squeeze recenters. Disabling cancels any
   * in-progress drag.
   */
  setDraggable(object: THREE.Object3D | null, enabled: boolean) {
    this.draggable = object;
    this.dragEnabled = enabled;
    if (!enabled) this.draggingController = null;
  }

  /** Returns (and clears) whether deliberate input happened since last call. */
  consumeActivity(): boolean {
    const a = this.activity;
    this.activity = false;
    return a;
  }

  /** True while any controller ray is actively pointing at a registered panel. */
  get isHoveringPanel(): boolean {
    return this.hoveringPanel;
  }

  /** Show or hide all controller laser rays (e.g. suppress when UI is hidden). */
  setRaysVisible(visible: boolean) {
    for (const laser of this.lasers) laser.visible = visible;
  }

  private beginGrabOrRecenter(controller: THREE.Group) {
    if (this.dragEnabled && this.draggable && this.intersect(controller)) {
      this.draggingController = controller;
      controller.updateMatrixWorld(true);
      const origin = this.tmpV1.setFromMatrixPosition(controller.matrixWorld);
      const panelPos = this.draggable.getWorldPosition(this.tmpV2);
      this.grabDistance = Math.min(
        DRAG_MAX,
        Math.max(DRAG_MIN, origin.distanceTo(panelPos))
      );
    } else {
      this.cb.onRecenter();
    }
  }

  private endGrab(controller: THREE.Group) {
    if (this.draggingController === controller) this.draggingController = null;
  }

  /**
   * Recompute the filtered (One-Euro) pointing ray for each controller once per
   * frame and drive the scene-parented laser from it. setupRay reads this cache
   * so every raycast in the frame — and event-driven select/squeeze handlers
   * that fire between frames — share one stable ray.
   */
  private refreshRays() {
    const now = performance.now();
    let dt = (now - this.lastRayTime) / 1000;
    this.lastRayTime = now;
    // First frame or a hitch → fall back to a nominal 72 Hz step so the filter
    // alpha stays sane instead of snapping to the raw (jittery) pose.
    if (!(dt > 0) || dt > 0.1) dt = 1 / 72;

    for (let i = 0; i < this.controllers.length; i++) {
      const c = this.controllers[i];
      c.updateMatrixWorld(true);
      this.rawOrigin.setFromMatrixPosition(c.matrixWorld);
      this.rotMatrix.identity().extractRotation(c.matrixWorld);
      this.rawDir.set(0, 0, -1).applyMatrix4(this.rotMatrix).normalize();

      if (!this.rayInit[i]) {
        this.smoothOrigin[i].copy(this.rawOrigin);
        this.smoothDir[i].copy(this.rawDir);
        this.rayInit[i] = true;
      } else {
        // One-Euro on the direction: cutoff grows with angular speed.
        const angle = this.smoothDir[i].angleTo(this.rawDir); // radians
        const cutoff = this.RAY_MIN_CUTOFF + this.RAY_BETA * (angle / dt);
        const tau = 1 / (2 * Math.PI * cutoff);
        const aDir = 1 / (1 + tau / dt);
        this.smoothDir[i].lerp(this.rawDir, aDir).normalize();
        // Translational jitter is far smaller; a light fixed low-pass on the
        // origin avoids the ray's start point shimmering.
        this.smoothOrigin[i].lerp(this.rawOrigin, 0.5);
      }

      const laser = this.lasers[i];
      if (laser) {
        laser.position.copy(this.smoothOrigin[i]);
        laser.quaternion.setFromUnitVectors(this.FORWARD, this.smoothDir[i]);
      }
    }
  }

  private setupRay(controller: THREE.Group) {
    const i = this.controllers.indexOf(controller);
    if (i >= 0 && this.rayInit[i]) {
      this.raycaster.ray.origin.copy(this.smoothOrigin[i]);
      this.raycaster.ray.direction.copy(this.smoothDir[i]);
      return;
    }
    // Fallback before the first refreshRays(): raw controller pose.
    controller.updateMatrixWorld(true);
    this.rotMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction
      .set(0, 0, -1)
      .applyMatrix4(this.rotMatrix)
      .normalize();
  }

  /** Nearest panel hit for a controller (skips hidden panels), or null. */
  private raycastNearest(
    controller: THREE.Group
  ): { object: THREE.Object3D; uv: THREE.Vector2; distance: number } | null {
    this.setupRay(controller);
    let best: {
      object: THREE.Object3D;
      uv: THREE.Vector2;
      distance: number;
    } | null = null;
    const hits = this.rayResults;
    for (const t of this.targets) {
      // Raycaster.intersectObject ignores `.visible`; gate it ourselves so a
      // hidden (auto-hidden) panel isn't interactable.
      if (!t.visible) continue;
      hits.length = 0;
      this.raycaster.intersectObject(t, false, hits);
      if (
        hits.length &&
        hits[0].uv &&
        (!best || hits[0].distance < best.distance)
      ) {
        best = { object: t, uv: hits[0].uv, distance: hits[0].distance };
      }
    }
    return best;
  }

  private intersect(controller: THREE.Group): IPanelHit | null {
    const hit = this.raycastNearest(controller);
    return hit ? { object: hit.object, uv: hit.uv } : null;
  }

  /** UV of the ray hit on a specific object, or null if the ray misses it. */
  private uvOnObject(
    controller: THREE.Group,
    object: THREE.Object3D
  ): THREE.Vector2 | null {
    if (!object.visible) return null;
    this.setupRay(controller);
    const hits = this.rayResults;
    hits.length = 0;
    this.raycaster.intersectObject(object, false, hits);
    return hits.length && hits[0].uv ? hits[0].uv : null;
  }

  update() {
    // Stabilise both pointing rays for this frame before any raycast reads them.
    this.refreshRays();

    // Hover: first controller pointing at a panel wins. Also lengthen each
    // laser to its hit point for nicer feedback.
    let hover: IPanelHit | null = null;
    for (let i = 0; i < this.controllers.length; i++) {
      const hit = this.raycastNearest(this.controllers[i]);
      this.lasers[i].scale.z = hit ? hit.distance : LASER_LENGTH;
      if (hit && !hover) hover = { object: hit.object, uv: hit.uv };
    }
    this.hoveringPanel = hover !== null;
    this.cb.onHover(hover);

    // While the trigger is held on a panel, stream drag moves to it (carousels
    // use this for drag-to-scroll; tap-vs-drag is resolved on release).
    if (this.pressController && this.pressObject) {
      const uv = this.uvOnObject(this.pressController, this.pressObject);
      if (uv) this.cb.onSelectMove({ object: this.pressObject, uv });
    }

    this.detectClap();
    this.detectStick();

    // While grabbing a panel, the thumbstick push/pulls it instead of
    // scrubbing; the panel rides the controller ray and faces the viewer.
    if (this.draggingController && this.draggable) {
      this.updateDrag();
      return;
    }

    this.updateScrub();
  }

  /** Detect clap gesture (both controllers near each other). */
  private detectClap() {
    // Get world positions of both controllers
    for (let i = 0; i < this.controllers.length && i < 2; i++) {
      this.controllers[i].getWorldPosition(this.tmpPositions[i]);
    }
    if (this.controllers.length >= 2) {
      const dist = this.tmpPositions[0].distanceTo(this.tmpPositions[1]);
      if (dist < CLAP_DISTANCE) {
        this.clapFrameCount++;
        // Fire once when we've held the clap long enough
        if (this.clapFrameCount >= this.CLAP_FRAMES_MIN && !this.clapFired) {
          this.clapFired = true;
          this.activity = true;
          this.cb.onClap();
        }
      } else {
        this.clapFrameCount = 0;
        this.clapFired = false;
      }
    }
  }

  /** Flag activity on any meaningful thumbstick deflection or button press. */
  private detectStick() {
    if (!this.session) return;
    for (const src of this.session.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;
      for (const ax of gp.axes) {
        if (Math.abs(ax) > WAKE_STICK) {
          this.activity = true;
          return;
        }
      }
    }
  }

  private updateDrag() {
    const controller = this.draggingController!;
    controller.updateMatrixWorld(true);
    this.rotMatrix.identity().extractRotation(controller.matrixWorld);
    const origin = this.tmpV1.setFromMatrixPosition(controller.matrixWorld);
    const dir = this.tmpV2
      .set(0, 0, -1)
      .applyMatrix4(this.rotMatrix)
      .normalize();

    // Thumbstick Y push/pull to set distance (Quest: axes[3], up = negative).
    const yAxis = this.maxAxis(3);
    if (Math.abs(yAxis) > SCRUB_REARM) {
      this.grabDistance = Math.min(
        DRAG_MAX,
        Math.max(DRAG_MIN, this.grabDistance - Math.sign(yAxis) * DRAG_STEP)
      );
    }

    this.draggable!.position.copy(origin).addScaledVector(
      dir,
      this.grabDistance
    );
    const cam = this.renderer.xr.getCamera();
    this.camPos.setFromMatrixPosition(cam.matrixWorld);
    this.draggable!.lookAt(this.camPos);
  }

  private updateScrub() {
    if (!this.session) return;
    // Find the most-deflected horizontal thumbstick across both controllers.
    let signed = 0;
    let maxAbs = 0;
    for (const src of this.session.inputSources) {
      const gp = src.gamepad;
      if (!gp || gp.axes.length < 4) continue;
      const x = gp.axes[2];
      if (Math.abs(x) > maxAbs) {
        maxAbs = Math.abs(x);
        signed = x;
      }
    }
    if (maxAbs < SCRUB_REARM) {
      this.scrubArmed = true;
    } else if (maxAbs > SCRUB_FIRE && this.scrubArmed) {
      this.scrubArmed = false;
      this.cb.onScrub(Math.sign(signed) * SCRUB_SECONDS);
    }
  }

  /**
   * Returns the dominant horizontal (x = axes[2]) and vertical (y = axes[3])
   * thumbstick deflection across both controllers. Used in lobby mode for grid
   * and rail navigation instead of the scrub edge-trigger.
   */
  getLobbyAxes(): { h: number; v: number } {
    if (!this.session) return { h: 0, v: 0 };
    let h = 0,
      v = 0,
      maxH = 0,
      maxV = 0;
    for (const src of this.session.inputSources) {
      const gp = src.gamepad;
      if (!gp || gp.axes.length < 4) continue;
      if (Math.abs(gp.axes[2]) > maxH) {
        maxH = Math.abs(gp.axes[2]);
        h = gp.axes[2];
      }
      if (Math.abs(gp.axes[3]) > maxV) {
        maxV = Math.abs(gp.axes[3]);
        v = gp.axes[3];
      }
    }
    return { h, v };
  }

  /** Largest-magnitude value of the given axis across both controllers. */
  private maxAxis(index: number): number {
    if (!this.session) return 0;
    let signed = 0;
    let maxAbs = 0;
    for (const src of this.session.inputSources) {
      const gp = src.gamepad;
      if (!gp || gp.axes.length <= index) continue;
      const v = gp.axes[index];
      if (Math.abs(v) > maxAbs) {
        maxAbs = Math.abs(v);
        signed = v;
      }
    }
    return signed;
  }

  dispose() {
    this.disposers.forEach((d) => d());
    this.disposers = [];
    for (const laser of this.lasers) {
      laser.geometry.dispose();
      (laser.material as THREE.Material).dispose();
      laser.parent?.remove(laser);
    }
    this.lasers = [];
    this.controllers = [];
    this.targets = [];
    this.draggable = null;
    this.draggingController = null;
    this.pressController = null;
    this.pressObject = null;
  }
}
