/**
 * VRControllerInput — Quest Touch controller handling.
 *
 * Builds a laser pointer per controller, raycasts against any number of control
 * panels for hover/select (reporting *which* panel was hit so the session
 * manager can route the interaction), and reads gamepad axes for thumbstick
 * scrubbing. The grip (squeeze) button grabs-and-drags whichever registered
 * draggable the ray hits; an empty squeeze grabs the video dome itself (when
 * dome dragging is enabled — the drag rotates the video to follow the ray) or
 * recenters (always on a quick squeeze that barely moves).
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
  /** Slot (0 or 1) of the controller that produced this hit — lets callers
   *  target haptics at the hand that's actually pointing at the panel. */
  controllerIndex: number;
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
   * Grip-drag on the video dome itself (a squeeze that hit no draggable while
   * dome dragging is enabled). Reports the smoothed ray's angular movement
   * this frame; positive yaw = ray swept right, positive pitch = ray swept up.
   * The video should follow the ray — "grab the sky and pull it".
   */
  onDomeDrag: (deltaYaw: number, deltaPitch: number) => void;
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
// Dome-drag tap threshold (radians of total angular ray movement). A squeeze
// released with less movement than this was a deliberate "quick squeeze" —
// the classic empty-squeeze recenter — not a drag. ~2.3 degrees.
const DOME_DRAG_TAP_RAD = 0.04;
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
  // Grip-drag state. Several objects can be registered grip-draggable at once
  // (e.g. the control bar and the flat media screen); a squeeze grabs whichever
  // one the ray is pointing at. `dragTarget` is the object the active drag moves.
  private draggables: THREE.Object3D[] = [];
  private draggingController: THREE.Group | null = null;
  private dragTarget: THREE.Object3D | null = null;
  private grabDistance = 2.4;

  // Dome-rotation drag: while enabled (dome projections during playback), a
  // squeeze that hits no draggable grabs the video sphere itself and rotates
  // it to follow the ray. The grab is tentative — if the ray barely moves
  // before release it counts as the classic quick-squeeze recenter instead.
  private domeDragEnabled = false;
  private domeDragController: THREE.Group | null = null;
  private domeDragAz = 0;
  private domeDragEl = 0;
  private domeDragMoved = 0;

  // Activity tracking for auto-hide.
  private activity = false;

  // Whether any controller is currently pointing at a registered panel.
  private hoveringPanel = false;
  // A target that stays hoverable/selectable but must NOT keep the auto-hiding
  // UI awake on hover — the flat video screen, which the user points at almost
  // constantly. Without this, aiming at the screen would pin the control bar.
  private hoverWakeExcluded: THREE.Object3D | null = null;

  // Per-slot connection state. three's getController(i) groups are created
  // eagerly for both slots but only fire `connected` once a real input source
  // (controller or hand) binds to that slot. Without this, a disconnected slot's
  // laser would keep being drawn from its last/stale pose — a static ray from a
  // controller that isn't there. We gate the ray + raycast on this.
  private connected = [false, false];
  // The XRInputSource bound to each slot (set on the `connected` event, which
  // hands us the source directly — far more reliable than trying to line up
  // `session.inputSources` order with three's controller-group indices).
  // Used to reach that hand's `gamepad.hapticActuators` for pulse().
  private inputSourcesBySlot: (XRInputSource | null)[] = [null, null];
  // Tracks the global rays-visible state so a controller reconnecting mid-session
  // restores its laser to whatever setRaysVisible last requested.
  private raysVisible = true;

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
        this.cb.onSelectEnd(
          obj && uv ? { object: obj, uv, controllerIndex: i } : null
        );
        this.pressController = null;
        this.pressObject = null;
      };
      const onSqueezeStart = () => {
        this.activity = true;
        this.beginGrabOrRecenter(controller);
      };
      const onSqueezeEnd = () => this.endGrab(controller);
      // Connection lifecycle: only show/raycast a slot's ray while a real input
      // source is bound to it. On disconnect, hide the laser, drop the stale
      // filtered ray (so a reconnect re-seeds instead of snapping from old data),
      // and abandon any press/drag that controller owned.
      const onConnected = (event: { data: XRInputSource }) => {
        this.connected[i] = true;
        this.inputSourcesBySlot[i] = event.data;
        if (this.lasers[i]) this.lasers[i].visible = this.raysVisible;
      };
      const onDisconnected = () => {
        this.connected[i] = false;
        this.inputSourcesBySlot[i] = null;
        this.rayInit[i] = false;
        if (this.lasers[i]) this.lasers[i].visible = false;
        if (this.pressController === controller) {
          this.pressController = null;
          this.pressObject = null;
        }
        if (this.draggingController === controller) {
          this.draggingController = null;
        }
        // Abandon a dome grab silently — no recenter on a lost controller.
        if (this.domeDragController === controller) {
          this.domeDragController = null;
        }
      };
      controller.addEventListener("selectstart", onSelectStart);
      controller.addEventListener("selectend", onSelectEnd);
      controller.addEventListener("squeezestart", onSqueezeStart);
      controller.addEventListener("squeezeend", onSqueezeEnd);
      controller.addEventListener("connected", onConnected);
      controller.addEventListener("disconnected", onDisconnected);
      this.disposers.push(() => {
        controller.removeEventListener("selectstart", onSelectStart);
        controller.removeEventListener("selectend", onSelectEnd);
        controller.removeEventListener("squeezestart", onSqueezeStart);
        controller.removeEventListener("squeezeend", onSqueezeEnd);
        controller.removeEventListener("connected", onConnected);
        controller.removeEventListener("disconnected", onDisconnected);
      });
      // Slots start disconnected — the laser stays hidden until a source binds.
      laser.visible = false;

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
   * Mark a target whose hover must NOT wake / keep-awake the auto-hiding UI
   * (the flat screen — pointed at constantly). It stays fully hoverable and
   * selectable; only the `hoveringPanel` keep-awake signal ignores it. Pass
   * null to clear (e.g. when leaving flat projection).
   */
  setHoverWakeExcluded(object: THREE.Object3D | null) {
    this.hoverWakeExcluded = object;
  }

  /** Signed, most-deflected thumbstick Y across both controllers (Quest:
   *  axes[3], up = negative). No dead-zone — callers gate it. Drives flat-screen
   *  tilt while repositioning, mirroring the grip-drag push/pull convention. */
  getStickY(): number {
    return this.maxAxis(3);
  }

  /**
   * Register (or unregister) an object as grip-draggable. Several objects can be
   * draggable at once — squeezing while pointing at one grabs that object; a
   * squeeze that hits no draggable recenters instead. Unregistering an object
   * cancels any in-progress drag of it. Passing a null object clears the set.
   */
  setDraggable(object: THREE.Object3D | null, enabled: boolean) {
    if (!object) {
      this.draggables = [];
      this.draggingController = null;
      this.dragTarget = null;
      return;
    }
    const i = this.draggables.indexOf(object);
    if (enabled) {
      if (i < 0) this.draggables.push(object);
    } else if (i >= 0) {
      this.draggables.splice(i, 1);
      if (this.dragTarget === object) {
        this.draggingController = null;
        this.dragTarget = null;
      }
    }
  }

  /**
   * Enable/disable grabbing the video dome itself with an empty squeeze (one
   * that hits no panel/draggable). While disabled — flat projection, lobby —
   * an empty squeeze recenters immediately, exactly as before.
   */
  setDomeDragEnabled(enabled: boolean) {
    this.domeDragEnabled = enabled;
    if (!enabled) this.domeDragController = null;
  }

  /** The registered draggable that `obj` belongs to (itself or an ancestor). */
  private draggableFor(obj: THREE.Object3D | null): THREE.Object3D | null {
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
      if (this.draggables.includes(o)) return o;
    }
    return null;
  }

  /** One-Euro-filtered ray for the currently-pressing controller, or null when
   *  no trigger press is active. Lets callers track the drag direction while a
   *  panel interaction is in progress without coupling to internal state. */
  getPressRay(): { origin: THREE.Vector3; dir: THREE.Vector3 } | null {
    if (!this.pressController) return null;
    const i = this.controllers.indexOf(this.pressController);
    if (i < 0 || !this.rayInit[i]) return null;
    return {
      origin: this.smoothOrigin[i].clone(),
      dir: this.smoothDir[i].clone(),
    };
  }

  /** Smoothed ray for the given controller slot regardless of trigger state,
   *  or null if that slot is not connected / not yet initialised. */
  getRay(index: number): { origin: THREE.Vector3; dir: THREE.Vector3 } | null {
    if (index < 0 || index >= this.controllers.length) return null;
    if (!this.connected[index] || !this.rayInit[index]) return null;
    return {
      origin: this.smoothOrigin[index].clone(),
      dir: this.smoothDir[index].clone(),
    };
  }

  /** Index (0 or 1) of the controller currently holding the trigger, or -1. */
  getPressControllerIndex(): number {
    if (!this.pressController) return -1;
    return this.controllers.indexOf(this.pressController);
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

  /**
   * Fire a short haptic pulse on the given controller slot (0 or 1), if that
   * hand's gamepad exposes the (still-experimental, not in lib.dom) Gamepad
   * Haptics Actuator API. Silently no-ops on hands/controllers that don't
   * support it — this is a feel enhancement, never load-bearing.
   */
  pulse(index: number, intensity: number, durationMs: number) {
    const src = this.inputSourcesBySlot[index];
    const actuator = (
      src?.gamepad as unknown as {
        hapticActuators?: Array<{
          pulse: (value: number, duration: number) => Promise<boolean>;
        }>;
      }
    )?.hapticActuators?.[0];
    if (!actuator) return;
    actuator.pulse(intensity, durationMs).catch(() => undefined);
  }

  /** Show or hide all controller laser rays (e.g. suppress when UI is hidden). */
  setRaysVisible(visible: boolean) {
    this.raysVisible = visible;
    // Only connected slots get a visible ray; a disconnected slot stays hidden.
    for (let i = 0; i < this.lasers.length; i++) {
      this.lasers[i].visible = visible && this.connected[i];
    }
  }

  private beginGrabOrRecenter(controller: THREE.Group) {
    const hit = this.draggables.length ? this.raycastNearest(controller) : null;
    const target = hit ? this.draggableFor(hit.object) : null;
    if (target) {
      this.draggingController = controller;
      this.dragTarget = target;
      controller.updateMatrixWorld(true);
      const origin = this.tmpV1.setFromMatrixPosition(controller.matrixWorld);
      const panelPos = target.getWorldPosition(this.tmpV2);
      this.grabDistance = Math.min(
        DRAG_MAX,
        Math.max(DRAG_MIN, origin.distanceTo(panelPos))
      );
    } else if (this.domeDragEnabled) {
      // Grab the dome: rotate the video to follow the ray. Recenter still
      // fires on release if the ray barely moved (quick empty squeeze).
      const i = this.controllers.indexOf(controller);
      if (i < 0 || !this.rayInit[i]) {
        this.cb.onRecenter();
        return;
      }
      const d = this.smoothDir[i];
      this.domeDragController = controller;
      this.domeDragAz = Math.atan2(-d.x, -d.z);
      this.domeDragEl = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
      this.domeDragMoved = 0;
    } else {
      this.cb.onRecenter();
    }
  }

  private endGrab(controller: THREE.Group) {
    if (this.draggingController === controller) this.draggingController = null;
    if (this.domeDragController === controller) {
      this.domeDragController = null;
      // Barely moved before release → this was the classic quick-squeeze
      // recenter, not a drag.
      if (this.domeDragMoved < DOME_DRAG_TAP_RAD) this.cb.onRecenter();
    }
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
      // Skip disconnected slots: no live source means no ray to draw or filter.
      if (!this.connected[i]) continue;
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
    return hit
      ? {
          object: hit.object,
          uv: hit.uv,
          controllerIndex: this.controllers.indexOf(controller),
        }
      : null;
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
      // A disconnected slot has no ray — don't raycast or stretch its laser.
      if (!this.connected[i]) continue;
      const hit = this.raycastNearest(this.controllers[i]);
      this.lasers[i].scale.z = hit ? hit.distance : LASER_LENGTH;
      if (hit && !hover) hover = { object: hit.object, uv: hit.uv, controllerIndex: i };
    }
    // The flat screen is hoverable/selectable but excluded from the keep-awake
    // signal so casually aiming at it doesn't pin the auto-hiding control bar.
    this.hoveringPanel =
      hover !== null && hover.object !== this.hoverWakeExcluded;
    this.cb.onHover(hover);

    // While the trigger is held on a panel, stream drag moves to it (carousels
    // use this for drag-to-scroll; tap-vs-drag is resolved on release).
    if (this.pressController && this.pressObject) {
      const uv = this.uvOnObject(this.pressController, this.pressObject);
      if (uv)
        this.cb.onSelectMove({
          object: this.pressObject,
          uv,
          controllerIndex: this.controllers.indexOf(this.pressController),
        });
    }

    this.detectClap();
    this.detectStick();

    // While grabbing a panel, the thumbstick push/pulls it instead of
    // scrubbing; the panel rides the controller ray and faces the viewer.
    if (this.draggingController && this.dragTarget) {
      this.updateDrag();
      return;
    }

    // While grabbing the dome, angular ray movement rotates the video; the
    // early return keeps the thumbstick scrub from firing mid-adjustment.
    if (this.domeDragController) {
      this.updateDomeDrag();
      return;
    }

    this.updateScrub();
  }

  /**
   * Stream this frame's angular ray movement to the dome-drag callback as
   * yaw/pitch deltas (azimuth/elevation of the smoothed ray). The consumer
   * adds them to the video orientation so the content follows the ray.
   */
  private updateDomeDrag() {
    const i = this.controllers.indexOf(this.domeDragController!);
    if (i < 0 || !this.connected[i] || !this.rayInit[i]) return;
    const d = this.smoothDir[i];
    const az = Math.atan2(-d.x, -d.z);
    const el = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    // Shortest-path wrap for the azimuth delta — sweeping across the ±π seam
    // behind the viewer must not register as a ~2π spin.
    let dAz = az - this.domeDragAz;
    if (dAz > Math.PI) dAz -= 2 * Math.PI;
    else if (dAz < -Math.PI) dAz += 2 * Math.PI;
    const dEl = el - this.domeDragEl;
    this.domeDragAz = az;
    this.domeDragEl = el;
    this.domeDragMoved += Math.abs(dAz) + Math.abs(dEl);
    if (dAz !== 0 || dEl !== 0) this.cb.onDomeDrag(dAz, dEl);
  }

  /** Detect clap gesture (both controllers near each other). */
  private detectClap() {
    // A clap needs both controllers tracked; a disconnected slot's stale world
    // position could otherwise sit close to the live one and false-trigger.
    if (!this.connected[0] || !this.connected[1]) {
      this.clapFrameCount = 0;
      this.clapFired = false;
      return;
    }
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

    this.dragTarget!.position.copy(origin).addScaledVector(
      dir,
      this.grabDistance
    );
    const cam = this.renderer.xr.getCamera();
    this.camPos.setFromMatrixPosition(cam.matrixWorld);
    this.dragTarget!.lookAt(this.camPos);
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
    this.draggables = [];
    this.dragTarget = null;
    this.draggingController = null;
    this.pressController = null;
    this.pressObject = null;
  }
}
