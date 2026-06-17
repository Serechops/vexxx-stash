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

  // Clap detection: count how many frames both controllers are within
  // CLAP_DISTANCE. Only fires the callback once per sustained clap (when
  // frames-clapped transitions from < threshold to ≥ threshold).
  private clapFrameCount = 0;
  private clapFired = false;
  private readonly CLAP_FRAMES_MIN = 3; // frames both hands must be close
  private tmpPositions: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()];
  // Grip-drag state (moving the control panel around).
  private draggable: THREE.Object3D | null = null;
  private dragEnabled = false;
  private draggingController: THREE.Group | null = null;
  private grabDistance = 2.4;

  // Activity tracking for auto-hide.
  private activity = false;

  private tmpV1 = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private camPos = new THREE.Vector3();

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
      controller.add(laser);

      const onSelectStart = () => {
        this.activity = true;
        const hit = this.intersect(controller);
        if (hit) this.cb.onSelect(hit);
      };
      const onSqueezeStart = () => {
        this.activity = true;
        this.beginGrabOrRecenter(controller);
      };
      const onSqueezeEnd = () => this.endGrab(controller);
      controller.addEventListener("selectstart", onSelectStart);
      controller.addEventListener("squeezestart", onSqueezeStart);
      controller.addEventListener("squeezeend", onSqueezeEnd);
      this.disposers.push(() => {
        controller.removeEventListener("selectstart", onSelectStart);
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

  private setupRay(controller: THREE.Group) {
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

  update() {
    // Hover: first controller pointing at a panel wins. Also lengthen each
    // laser to its hit point for nicer feedback.
    let hover: IPanelHit | null = null;
    for (let i = 0; i < this.controllers.length; i++) {
      const hit = this.raycastNearest(this.controllers[i]);
      this.lasers[i].scale.z = hit ? hit.distance : LASER_LENGTH;
      if (hit && !hover) hover = { object: hit.object, uv: hit.uv };
    }
    this.cb.onHover(hover);

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
  }
}
