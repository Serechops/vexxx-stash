/**
 * VRControllerInput — Quest Touch controller handling.
 *
 * Builds a laser pointer per controller, raycasts against the control panel for
 * hover/select, and reads gamepad axes for thumbstick scrubbing. The grip
 * (squeeze) button either grabs-and-drags the control panel (when it's
 * unpinned and being pointed at) or recenters the view.
 *
 * All resolved interactions are surfaced through callbacks; this class owns no
 * playback state.
 */
import * as THREE from "three";

export interface IControllerInputCallbacks {
  onHover: (uv: THREE.Vector2 | null) => void;
  onSelect: (uv: THREE.Vector2) => void;
  /** Thumbstick nudge, in (signed) seconds. */
  onScrub: (deltaSeconds: number) => void;
  onRecenter: () => void;
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

export class VRControllerInput {
  private controllers: THREE.Group[] = [];
  private lasers: THREE.Line[] = [];
  private raycaster = new THREE.Raycaster();
  private rotMatrix = new THREE.Matrix4();
  private target: THREE.Object3D | null = null;
  private session: XRSession | null = null;
  private disposers: Array<() => void> = [];

  // Edge-trigger state for thumbstick scrubbing.
  private scrubArmed = true;

  // Grip-drag state (moving the control panel around).
  private draggable: THREE.Object3D | null = null;
  private dragEnabled = false;
  private draggingController: THREE.Group | null = null;
  private grabDistance = 2.4;

  private tmpV1 = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
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
        const uv = this.intersect(controller);
        if (uv) this.cb.onSelect(uv);
      };
      const onSqueezeStart = () => this.beginGrabOrRecenter(controller);
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

  setTarget(target: THREE.Object3D | null) {
    this.target = target;
  }

  /**
   * Mark an object as grip-draggable. When enabled, squeezing while pointing at
   * the panel grabs it; otherwise squeeze recenters. Disabling cancels any
   * in-progress drag.
   */
  setDraggable(object: THREE.Object3D | null, enabled: boolean) {
    this.draggable = object;
    this.dragEnabled = enabled;
    if (!enabled) this.draggingController = null;
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

  private intersect(controller: THREE.Group): THREE.Vector2 | null {
    if (!this.target) return null;
    controller.updateMatrixWorld(true);
    this.rotMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction
      .set(0, 0, -1)
      .applyMatrix4(this.rotMatrix)
      .normalize();
    const hits = this.raycaster.intersectObject(this.target, false);
    if (!hits.length) return null;
    return hits[0].uv ?? null;
  }

  update() {
    // Hover: first controller pointing at the panel wins. Also lengthen the
    // laser to the hit point for nicer feedback.
    let hoverUv: THREE.Vector2 | null = null;
    for (let i = 0; i < this.controllers.length; i++) {
      const controller = this.controllers[i];
      if (!this.target) {
        this.lasers[i].scale.z = LASER_LENGTH;
        continue;
      }
      controller.updateMatrixWorld(true);
      this.rotMatrix.identity().extractRotation(controller.matrixWorld);
      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      this.raycaster.ray.direction
        .set(0, 0, -1)
        .applyMatrix4(this.rotMatrix)
        .normalize();
      const hits = this.raycaster.intersectObject(this.target, false);
      if (hits.length) {
        this.lasers[i].scale.z = hits[0].distance;
        if (!hoverUv && hits[0].uv) hoverUv = hits[0].uv;
      } else {
        this.lasers[i].scale.z = LASER_LENGTH;
      }
    }
    this.cb.onHover(hoverUv);

    // While grabbing the panel, the thumbstick push/pulls it instead of
    // scrubbing; the panel rides the controller ray and faces the viewer.
    if (this.draggingController && this.draggable) {
      this.updateDrag();
      return;
    }

    this.updateScrub();
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
    this.draggable = null;
    this.draggingController = null;
  }
}
