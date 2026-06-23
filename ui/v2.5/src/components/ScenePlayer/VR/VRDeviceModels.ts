/**
 * VRDeviceModels — visible Touch controllers and tracked hands.
 *
 * Renders a real device mesh for each input source so the user sees their
 * controllers / hands in the scene rather than just a floating laser:
 *
 *  - **Controllers**: three's [XRControllerModelFactory] loads the correct glTF
 *    per WebXR input profile on the *grip* space. On Quest it resolves
 *    `meta-quest-touch-pro` (Touch Pro) with the documented `oculus-touch-v2`
 *    fallback automatically — no per-device asset wiring on our side.
 *  - **Hands**: [XRHandModelFactory] renders the 25-joint `generic-hand`
 *    skeleton mesh on the hand space, driven by three's WebXRController joint
 *    poses every frame. Pinch already arrives through the existing
 *    `getController(i)` select pipeline (Meta emulates a target ray + maps pinch
 *    to a gamepad button), so this class is purely the *visual* layer.
 *
 * three swaps a controller's model in/out on the input source's connect /
 * disconnect events, so controllers and hands never render at once for the same
 * slot — when the user sets a controller down and raises a hand, the controller
 * mesh disappears and the hand mesh takes over, and vice-versa.
 *
 * Asset hosting: both factories fetch glTF from a CDN by default. For headsets
 * with no internet, pass `assetBasePath` pointing at a self-hosted copy of the
 * `@webxr-input-profiles/assets` `dist` directory.
 */
import * as THREE from "three";
// three's addons are published as ESM that requires the explicit ".js"
// extension; the import/extensions rule doesn't know that, so suppress it here.
/* eslint-disable import/extensions */
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js";
/* eslint-enable import/extensions */

export interface IVRDeviceModelsOptions {
  /**
   * Override base URL for the `@webxr-input-profiles/assets` `dist` directory
   * (controller + hand glTF). Omit to use three's CDN default. Point at a
   * self-hosted copy for offline / LAN-only headsets, e.g. "/webxr-assets/dist".
   */
  assetBasePath?: string;
}

export class VRDeviceModels {
  private grips: THREE.Group[] = [];
  private hands: THREE.Group[] = [];
  private scene: THREE.Scene;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    opts: IVRDeviceModelsOptions = {}
  ) {
    this.scene = scene;

    const controllerFactory = new XRControllerModelFactory();
    const handFactory = new XRHandModelFactory();
    if (opts.assetBasePath) {
      const base = opts.assetBasePath.replace(/\/$/, "");
      controllerFactory.setPath(`${base}/profiles`);
      handFactory.setPath(`${base}/profiles/generic-hand/`);
    }

    for (let i = 0; i < 2; i++) {
      // Controller mesh rides the grip pose (the physical device), not the
      // target-ray pose the laser uses.
      const grip = renderer.xr.getControllerGrip(i);
      grip.add(controllerFactory.createControllerModel(grip));
      scene.add(grip);
      this.grips.push(grip);

      // Hand mesh rides the hand/joint space; three updates the joints each
      // frame from the tracking data while the model is in the scene graph.
      const hand = renderer.xr.getHand(i);
      hand.add(handFactory.createHandModel(hand, "mesh"));
      scene.add(hand);
      this.hands.push(hand);
    }
  }

  /** Show or hide all device meshes (e.g. while the UI is faded out). */
  setVisible(visible: boolean) {
    for (const g of this.grips) g.visible = visible;
    for (const h of this.hands) h.visible = visible;
  }

  dispose() {
    for (const g of this.grips) {
      g.clear();
      this.scene.remove(g);
    }
    for (const h of this.hands) {
      h.clear();
      this.scene.remove(h);
    }
    this.grips = [];
    this.hands = [];
  }
}
