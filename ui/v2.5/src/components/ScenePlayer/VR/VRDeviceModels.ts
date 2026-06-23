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

// Subtle white silhouette edge, matching the native Quest system hands/
// controllers. A fresnel term lights up where the surface curves away from the
// eye, so it traces the outline regardless of scene lighting (these PBR meshes
// otherwise read as flat black because the immersive lobby has almost no light).
const RIM_COLOR = "vec3(1.0, 1.0, 1.0)";
const RIM_POWER = "2.8"; // higher = thinner edge
const RIM_STRENGTH = "0.65"; // additive intensity of the edge

export class VRDeviceModels {
  private grips: THREE.Group[] = [];
  private hands: THREE.Group[] = [];
  private scene: THREE.Scene;
  // Materials we've already injected the rim shader into. WeakSet so swapped-out
  // device meshes (controller <-> hand) get GC'd without us leaking refs.
  private rimmed = new WeakSet<THREE.Material>();

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

  /**
   * Per-frame: pick up any newly-loaded device meshes and give them the white
   * rim. Both factories load their glTF asynchronously and swap models on
   * connect/disconnect, so there's no single "loaded" hook — we lazily patch
   * each material the first time we see it (cheap: the WeakSet skips the rest).
   */
  update() {
    for (const g of this.grips) this.applyRim(g);
    for (const h of this.hands) this.applyRim(h);
  }

  private applyRim(root: THREE.Object3D) {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const mat of mats) {
        // Only PBR materials expose vViewPosition/normal for the fresnel; the
        // controller + hand glTFs are all MeshStandardMaterial.
        if (
          !mat ||
          !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
          this.rimmed.has(mat)
        ) {
          continue;
        }
        this.rimmed.add(mat);
        this.injectRim(mat as THREE.MeshStandardMaterial);
      }
    });
  }

  private injectRim(mat: THREE.MeshStandardMaterial) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      prev?.call(mat, shader, renderer);
      // Add the rim to the final colour, after lighting/tonemapping, so it shows
      // even with no lights. `normal` and `vViewPosition` are already in scope
      // here (set by the standard material's normal_fragment_begin).
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `
        {
          float rimDot = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
          float rim = pow(rimDot, ${RIM_POWER}) * ${RIM_STRENGTH};
          gl_FragColor.rgb += ${RIM_COLOR} * rim;
        }
        #include <dithering_fragment>`
      );
    };
    // Force a recompile so the swapped onBeforeCompile takes effect, and keep
    // rimmed materials in their own program cache bucket.
    mat.customProgramCacheKey = () => "vr-device-rim";
    mat.needsUpdate = true;
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
