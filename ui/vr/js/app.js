/**
 * app.js – Babylon.js VR Theater for Vexxx
 * 
 * UPGRADED VERSION with:
 * - Better performance and memory management
 * - Enhanced VR interaction and comfort
 * - Advanced video controls (speed, quality)
 * - Gesture support in VR
 * - Smooth animations and transitions
 * - Robust error handling and recovery
 * - Network state management
 * - Performance monitoring
 */

import { session, patchSession, apiUrl, streamUrl, thumbUrl } from './session.js';
import { VideoController } from './video.js';
import { LibraryBrowser } from './library.js';
import { LibraryBrowser3D } from './library3d.js';

// Toggle for testing GUI3D enhancements
const USE_GUI3D = true;
import { CONFIG } from './config.js';
import { VRControllerManager } from './vr-controller.js';
import { VideoFeatures } from './video-features.js';
import { ControlPanel, FORMAT_CYCLE } from './control-panel.js';
import { VideoDisplay } from './video-display.js';
/* ═══════════════════════════════════════════════════════════════════════
   0. DEBUG HELPER
   ═══════════════════════════════════════════════════════════════════════ */

const dbg = (...args) => {
  if (CONFIG.DEBUG) {
    const msg = args.map(a =>
      a instanceof Error ? `${a.message}\n${a.stack || ''}` :
        (typeof a === 'object' ? JSON.stringify(a) : String(a))
    ).join(' ');
    try { fetch('/vr/debug', { method: 'POST', body: msg }); } catch (_) { }
    console.log('[VR]', ...args);
  }
};

/* ═══════════════════════════════════════════════════════════════════════
   1. BABYLON ENGINE + SCENE
   ═══════════════════════════════════════════════════════════════════════ */

const canvas = document.getElementById('renderCanvas');
const engine = new BABYLON.Engine(canvas, true, {
  preserveDrawingBuffer: false, // Quest 3: false allows Adreno 740 tile-based deferred rendering
  stencil: true,
  xrCompatible: true,
  disableWebGL2Support: false, // Allow WebGL2 if available
});

const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);
scene.performancePriority = BABYLON.Scene.PERFORMANCE_PRIORITY_AGGRESSIVE;

// Camera – universal for flat + VR
const camera = new BABYLON.UniversalCamera('cam', new BABYLON.Vector3(0, 1.7, 0), scene);
camera.attachControl(canvas, true);
camera.minZ = 0.1;
camera.maxZ = 10000;
camera.fov = CONFIG.VIDEO.DEFAULT_FOV;
camera.inertia = 0.1; // Smooth camera movement
camera.angularSensibility = 2000;

// Lighting
const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = 0;  // FULL BLACK - disable hemispheric lighting which was washing out the floor
hemi.groundColor = new BABYLON.Color3(0, 0, 0);
hemi.diffuse = new BABYLON.Color3(0, 0, 0);

const backLight = new BABYLON.DirectionalLight('backLight', new BABYLON.Vector3(0, -0.5, 1), scene);
backLight.intensity = 0;  // Disabled – was creating a visible glowing rectangle behind the UI

/* ═══════════════════════════════════════════════════════════════════════
   1.5 POST-PROCESSING (Visual Polish)
   ═══════════════════════════════════════════════════════════════════════ */

const pipeline = new BABYLON.DefaultRenderingPipeline(
  "defaultPipeline",
  true, // is HDR?
  scene,
  [camera]
);

// Anti-Aliasing
pipeline.samples = 4; // MSAA
pipeline.fxaaEnabled = true;

// Bloom for emissives (UI, TV glow, pointers)
pipeline.bloomEnabled = true;
pipeline.bloomThreshold = 0.8;
pipeline.bloomWeight = 0.3;

// Color adjustment for "pop"
pipeline.imageProcessingEnabled = true;
pipeline.imageProcessing.contrast = 1.05;
pipeline.imageProcessing.exposure = 1.0;


/* ═══════════════════════════════════════════════════════════════════════
   2. VIDEO CONTROLLER
   ═══════════════════════════════════════════════════════════════════════ */

const videoEl = document.getElementById('vr-vid');
const vc = new VideoController(videoEl);

// Video element optimizations
videoEl.preload = 'metadata';
videoEl.crossOrigin = 'anonymous';

/* ═══════════════════════════════════════════════════════════════════════
   3. STATE MANAGEMENT
   ═══════════════════════════════════════════════════════════════════════ */

class AppState {
  constructor() {
    this._state = 'init';
    this._listeners = new Set();
  }

  get current() { return this._state; }

  set(newState) {
    const oldState = this._state;
    this._state = newState;
    dbg(`[state] ${oldState} → ${newState}`);
    this._notify(oldState, newState);
  }

  onChange(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  _notify(oldState, newState) {
    this._listeners.forEach(cb => cb(oldState, newState));
  }
}

const appState = new AppState();

/* ═══════════════════════════════════════════════════════════════════════
   4. LOBBY ENVIRONMENT
   ═══════════════════════════════════════════════════════════════════════ */

// Ground disc – permanently hidden, use setEnabled(false) to exclude from scene evaluation
const ground = BABYLON.MeshBuilder.CreateDisc('ground', { radius: 12, tessellation: 64 }, scene);
ground.rotation.x = Math.PI / 2;
ground.position.y = -0.01;
ground.setEnabled(false); // Quest 3 opt: setEnabled removes from scene graph entirely

const groundMat = new BABYLON.PBRMaterial('groundMat', scene);
groundMat.albedoColor = new BABYLON.Color3(0, 0, 0);
groundMat.emissiveColor = new BABYLON.Color3(0, 0, 0);
groundMat.roughness = 1.0;
groundMat.metallic = 0;
groundMat.freeze(); // Quest 3 opt: freeze static materials
ground.material = groundMat;

// Directional light — very dim to softly illuminate the ground and card geometry
const sunLight = new BABYLON.DirectionalLight('sun',
  new BABYLON.Vector3(0.3, -0.5, -1).normalize(), scene);
sunLight.intensity = 0.02; // Reduced further to prevent highlights on floors/backings
sunLight.diffuse = new BABYLON.Color3(0.3, 0.3, 0.4);   // Fainter cool fill

// ── Pure black skybox sphere ──
const skybox = BABYLON.MeshBuilder.CreateSphere('skybox',
  { diameter: 100, segments: 16, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
skybox.isPickable = false;
skybox.infiniteDistance = true;
skybox.renderingGroupId = 0; // Keep default — skybox is pure black, overdraw cost is negligible

const skyMat = new BABYLON.StandardMaterial('skyMat', scene);
skyMat.backFaceCulling = false;
skyMat.disableLighting = true;
skyMat.emissiveColor = new BABYLON.Color3(0, 0, 0);
skyMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
skyMat.specularColor = new BABYLON.Color3(0, 0, 0);
skyMat.freeze(); // Quest 3 opt: freeze static materials
skybox.material = skyMat;
// Note: do NOT freezeWorldMatrix — infiniteDistance requires per-frame matrix updates

// TV back-glow — permanently hidden, use setEnabled(false) to exclude from scene evaluation
const tvGlowPlane = BABYLON.MeshBuilder.CreatePlane('tvGlow', { width: 11.5, height: 5.4 }, scene);
tvGlowPlane.position = new BABYLON.Vector3(0.4, 2.0, 5.35);
tvGlowPlane.setEnabled(false); // Quest 3 opt: removed from scene graph

// Underglow disc — permanently hidden, use setEnabled(false) to exclude from scene evaluation
const glowDisc = BABYLON.MeshBuilder.CreateDisc('underglow', { radius: 3, tessellation: 48 }, scene);
glowDisc.rotation.x = Math.PI / 2;
glowDisc.position.y = 0.002;
glowDisc.setEnabled(false); // Quest 3 opt: removed from scene graph

// Lobby meshes collection — skybox is the only one we might want to keep (it's pure black anyway)
const lobbyMeshes = [skybox]; // ground, tvGlowPlane, glowDisc removed to stay hidden

function setLobbyVisible(visible) {
  lobbyMeshes.forEach(m => m.isVisible = visible);
  // ground, tvGlowPlane, glowDisc are setEnabled(false) — no need to touch them

  // Toggle sun light so it doesn't affect video playback lighting
  sunLight.setEnabled(visible);
  if (libraryBrowser) libraryBrowser.setVisible(visible);
}

/* ═══════════════════════════════════════════════════════════════════════
   5. LIBRARY BROWSER
   ═══════════════════════════════════════════════════════════════════════ */

let libraryBrowser;
let videoFeatures;
if (USE_GUI3D) {
  libraryBrowser = new LibraryBrowser3D(scene, (media) => {
    enterPlaying(media);
  });
} else {
  libraryBrowser = new LibraryBrowser(scene, (media) => {
    enterPlaying(media);
  }, {
    enableSounds: true,
    lazyLoadThumbnails: true,
    animateCards: true
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   6. VIDEO MODE DETECTION (Enhanced)
   ═══════════════════════════════════════════════════════════════════════ */

function guessMode(media) {
  const title = (media.title || '').toLowerCase();
  const tags = (media.tags || []).map(s => s.toLowerCase());
  const filename = (media.filename || '').toLowerCase();
  const studio = (media.studio || '').toLowerCase();

  const all = [title, filename, ...tags, studio].join(' ');

  // Default to 180° mono — majority of VR content is this format.
  // Explicit 2D markers override below.
  let mode = '180';
  let stereo = 'none';

  // 360 detection (must come first — overrides default 180)
  if (all.includes('360') || all.includes('360°') || all.includes('360vr')) {
    mode = '360';
  }

  // Explicit 2D detection
  if (all.includes('2d') || all.includes('flat') || all.includes('pov 2d')) {
    mode = '2d';
    stereo = 'none';
  }

  // Stereo detection
  if (all.includes('sbs') || all.includes('side by side') || all.includes('side-by-side')) {
    stereo = 'sbs';
  } else if (all.includes('tb') || all.includes('top.bottom') || all.includes('over.under') || all.includes('top-bottom')) {
    stereo = 'tb';
  }

  // Explicit mono override
  if (all.includes('mono')) {
    stereo = 'none';
  }

  return { mode, stereo };
}

// Create control panel instance
let controlPanel;
// Video display instance (VideoDisplay manages VideoDome + flat screen)
let videoDisplay;
/* ═══════════════════════════════════════════════════════════════════════
   9. WEBXR SETUP (Enhanced)
   ═══════════════════════════════════════════════════════════════════════ */

let xrHelper = null;

/* ── Haptic Feedback Utility ─────────────────────────────────────────────────
 * Triggers controller vibration using the WebXR Gamepad API.
 * 
 * @param {number} intensity - Vibration strength (0.0 to 1.0)
 * @param {number} duration  - Duration in milliseconds
 * @param {string} hand      - Target controller ('left', 'right', or 'any')
 */
window.triggerHaptic = function (intensity = 0.5, duration = 20, hand = 'any') {
  if (!xrHelper?.input?.controllers) return;
  intensity = Math.max(0, Math.min(1, intensity));
  const controllers = xrHelper.input.controllers;
  for (const c of controllers) {
    if (hand === 'any' || c.inputSource.handedness === hand) {
      if (c.inputSource?.gamepad?.hapticActuators?.length > 0) {
        try {
          // Play haptic effect if supported
          c.inputSource.gamepad.hapticActuators[0]
            .pulse(intensity, duration)
            .catch(() => { }); // Explicitly ignore pulse promises rejected on overlap or unavailable hardware
        } catch (_) { }
      }
    }
  }
};

/* ── Persistent Exit-VR button (always visible inside headset) ─────────────
 * A small plane parented to the XR camera so it tracks the user's
 * head position and stays pinned at the bottom of their field of view.
 * Created lazily on first XR entry; shown/hidden via state observable.
 */
// Exit VR is handled by the ControlPanel 'Exit' button — no floating button needed.

async function initXR() {
  try {
    // Diagnostic logs: surface security and XR capability for headset debugging
    try {
      dbg('[xr] secureContext=' + (window.isSecureContext ? 'true' : 'false') + ', location=' + window.location.href);
      dbg('[xr] navigator.xr=' + (navigator.xr ? 'present' : 'absent'));
      if (navigator.xr && typeof navigator.xr.isSessionSupported === 'function') {
        navigator.xr.isSessionSupported('immersive-vr').then(s => dbg('[xr] isSessionSupported(immersive-vr)=' + s)).catch(e => dbg('[xr] isSessionSupported error: ' + (e && e.message)));
      }
    } catch (e) {
      dbg('[xr] diagnostic logging failed: ' + (e && e.message));
    }
    const xr = await scene.createDefaultXRExperienceAsync({
      floorMeshes: [], // EXPLICITLY EMPTY - prevents Babylon from creating a default grey floor
      disableTeleportation: true,          // docs: WebXRDefaultExperienceOptions field
      uiOptions: {
        sessionMode: CONFIG.VR.SESSION_MODE,
        referenceSpaceType: CONFIG.VR.REFERENCE_SPACE
      },
      optionalFeatures: [
        // !! Keep this list minimal — BabylonJS promotes entries to native
        // !! requiredFeatures, which causes NotSupportedError on Quest if any
        // !! entry is unsupported. Only list truly optional spatial features.
        'local-floor',   // Floor detection when guardian is set up; gracefully absent otherwise
      ],
      pointerSelectionOptions: {
        enablePointerSelectionOnAllControllers: true,
        displayLazerPointer: false,  // Hide the ray line — reticle dot is enough
      }
    });

    xrHelper = xr;

    // ── Diagnostic intercepts: capture exact requestSession error ──
    // Also strip requiredFeatures → optionalFeatures right before the native
    // call. BabylonJS promotes hand-tracking, layers, and light-estimation to
    // requiredFeatures internally; Quest Browser rejects unsupported required
    // features with NotSupportedError. Moving them to optional means the session
    // succeeds even when the browser doesn't support a feature.
    try {
      if (navigator.xr?.requestSession) {
        const _origReqSession = navigator.xr.requestSession.bind(navigator.xr);
        navigator.xr.requestSession = function (mode, opts) {
          if (opts && opts.requiredFeatures?.length) {
            opts = { ...opts };
            opts.optionalFeatures = [...(opts.optionalFeatures || []), ...opts.requiredFeatures];
            opts.requiredFeatures = [];
            dbg('[xr] requestSession: moved requiredFeatures→optional: ' + opts.optionalFeatures.join(', '));
          }
          dbg('[xr] requestSession(' + mode + ') opts=' + JSON.stringify(opts));
          return _origReqSession(mode, opts).catch(e => {
            dbg('[xr] requestSession REJECTED: ' + (e?.name || '') + ' ' + (e?.message || String(e)));
            throw e;
          });
        };
      }
    } catch (_) { }

    if (xrHelper.baseExperience) {
      // Wrap enterXRAsync to capture the specific session initialization error
      try {
        const _origEnterXR = xrHelper.baseExperience.enterXRAsync.bind(xrHelper.baseExperience);
        xrHelper.baseExperience.enterXRAsync = async function (...args) {
          dbg('[xr] enterXRAsync: sessionMode=' + args[0] + ' refSpace=' + args[1]);
          try {
            return await _origEnterXR(...args);
          } catch (e) {
            dbg('[xr] enterXRAsync FAILED: ' + (e?.name || '') + ' ' + (e?.message || String(e)));
            throw e;
          }
        };
      } catch (_) { }

      // Disable post-processing BEFORE the first XR frame.
      // DefaultRenderingPipeline is incompatible with the WebXR multi-view frame
      // loop. If it is still active when the first XR frame is submitted, Quest
      // aborts the session and goes straight back to NOT_IN_XR without ever
      // reaching IN_XR. onBeforeEnterXRObservable fires synchronously before
      // requestSession so it is the earliest safe hook.
      xrHelper.baseExperience.onBeforeEnterXRObservable?.add(() => {
        dbg('[xr] onBeforeEnterXR: disabling post-processing pipeline');
        pipeline.fxaaEnabled = false;
        pipeline.bloomEnabled = false;
        pipeline.imageProcessingEnabled = false;
        pipeline.samples = 2;
      });

      // Handle XR state changes
      xrHelper.baseExperience.onStateChangedObservable.add((state) => {
        dbg(`[xr] state: ${BABYLON.WebXRState[state]}`);

        if (state === BABYLON.WebXRState.ENTERING_XR) {
          // Belt-and-suspenders: ensure pipeline is always off before first XR frame.
          // onBeforeEnterXRObservable handles the normal path; this catches any case
          // where the observable fires after the request is already in flight.
          pipeline.fxaaEnabled = false;
          pipeline.bloomEnabled = false;
          pipeline.imageProcessingEnabled = false;
          pipeline.samples = 2;
          dbg('[xr] ENTERING_XR: post-processing pre-disabled');
        }

        if (state === BABYLON.WebXRState.IN_XR) {
          // Entering VR — position panel after headset tracking stabilises
          setTimeout(() => controlPanel?.positionForCamera(), 500);
          controlPanel.currentZoom = 0.5;
          controlPanel.currentDepth = 1.0;

          // Pipeline already disabled in onBeforeEnterXRObservable / ENTERING_XR.
          // Log confirmation only.
          dbg('[xr] IN_XR: post-processing confirmed off for VR performance');

          // ── Quest 3 opt: Activate Fixed Foveated Rendering (FFR) ──
          try {
            const xrSession = xrHelper.baseExperience.sessionManager.session;
            const baseLayer = xrSession?.renderState?.baseLayer;
            if (baseLayer && baseLayer.fixedFoveation !== undefined) {
              // fixedFoveation: 0.0 (none) to 1.0 (max)
              baseLayer.fixedFoveation = Math.min(1, CONFIG.PERFORMANCE.FOVEATION_LEVEL / 3);
              dbg(`[xr] FFR set to ${baseLayer.fixedFoveation.toFixed(2)} (level ${CONFIG.PERFORMANCE.FOVEATION_LEVEL})`);
            }
          } catch (e) {
            dbg('[xr] FFR not available: ' + e.message);
          }

          // Re-create the video display to trigger native WebXR Composition Layers
          if (appState.current === 'playing') {
            try {
              const xrSession = xrHelper?.baseExperience?.sessionManager?.session;
              const mode = xrSession ? (xrSession.mode || 'immersive-vr') : (session?.mode || 'immersive-vr');
              const stereo = xrSession ? (xrSession.stereo || false) : (session?.stereo || false);
              dbg('[xr] creating video display (mode=' + mode + ', stereo=' + stereo + ')');
              videoDisplay.create(mode, stereo);
            } catch (e) {
              dbg('[xr] videoDisplay.create failed: ' + (e && e.message));
            }
          }

          // Note: camera.fov has no effect in XR (HMD optics govern FOV).
          // Apply fovMultiplier to the dome instead if one is active.
          if (videoDisplay?.dome) videoDisplay.dome.fovMultiplier = 0.5;
        }

        if (state === BABYLON.WebXRState.NOT_IN_XR) {
          // Returning to 2D — restore the non-XR camera FOV.
          const activeCam = scene.activeCamera || camera;
          activeCam.fov = CONFIG.VIDEO.DEFAULT_FOV;
          controlPanel.currentZoom = 0.5;
          controlPanel.currentDepth = 1.0;
          if (controlPanel.passthroughActive) {
            controlPanel.togglePassthrough();
          }

          // ── Quest 3 opt: Re-enable post-processing for desktop view ──
          pipeline.fxaaEnabled = true;
          pipeline.bloomEnabled = true;
          pipeline.imageProcessingEnabled = true;
          pipeline.samples = 4;
          // Re-apply vignette if the user had it enabled before entering XR
          if (controlPanel?._vignetteEnabled) {
            pipeline.imageProcessing.vignetteEnabled = true;
            pipeline.imageProcessing.vignetteWeight = 0.8;
            pipeline.imageProcessing.vignetteBlendMode = 1;
          }
          dbg('[xr] post-processing re-enabled for desktop');

          // Re-create the video display to fall back to WebGL meshes for the desktop view
          if (appState.current === 'playing') {
            try {
              const xrSession = xrHelper?.baseExperience?.sessionManager?.session;
              const mode = xrSession ? (xrSession.mode || 'inline') : (session?.mode || 'inline');
              const stereo = xrSession ? (xrSession.stereo || false) : (session?.stereo || false);
              dbg('[xr] creating desktop video display (mode=' + mode + ', stereo=' + stereo + ')');
              videoDisplay.create(mode, stereo);
            } catch (e) {
              dbg('[xr] videoDisplay.create (desktop) failed: ' + (e && e.message));
            }
          }

          // Save position so user can resume
          if (appState.current === 'playing' && vc.currentTime > 0) {
            patchSession({ startTime: vc.currentTime });
            dbg('[xr] saved position on XR exit: ' + vc.currentTime.toFixed(1) + 's');
          }
          // Final sweep for any lingering line meshes after session ends
          setTimeout(_sweepLineMeshes, 200);
        }
      });

      /* ── Initial XR pose — position cinema relative to user's real height ── */
      xrHelper.baseExperience.onInitialXRPoseSetObservable.add((xrCam) => {
        const userH = xrCam.realWorldHeight || CONFIG.VR.DEFAULT_HEIGHT;
        dbg(`[xr] initial pose set — realWorldHeight=${userH.toFixed(2)}m`);

        // Position flat screen centre slightly above user's eye line
        if (videoDisplay?.flatScreen) {
          videoDisplay.flatScreen.position.y = userH + 0.5;
          dbg(`[xr] flat screen Y adjusted to ${videoDisplay.flatScreen.position.y.toFixed(2)}`);
        }

        // Reposition controls relative to actual eye height
        if (controlPanel) {
          controlPanel.positionForCamera();
        }
      });

      // Teleportation is disabled via disableTeleportation:true in the constructor
      // options above (WebXRDefaultExperienceOptions). Belt-and-suspenders: also
      // detach it here in case an older Babylon version doesn't honour the flag.
      try {
        if (xrHelper.teleportation) xrHelper.teleportation.detach();
      } catch (_) { }

      // Polish the pointer selection reticle; hide the laser ray line
      try {
        if (xrHelper.pointerSelection) {
          // Hide the ray line — only the reticle dot is shown.
          // Babylon has a typo in its API ("lazer"), set both spellings defensively.
          xrHelper.pointerSelection.displayLaserPointer = false;
          xrHelper.pointerSelection.displayLazerPointer = false;
          xrHelper.pointerSelection.displaySelectionMesh = true; // keep the reticle dot

          xrHelper.pointerSelection.onControllerAddedObservable.add((controller) => {
            if (controller.selectionMesh) {
              const reticle = controller.selectionMesh;

              // Custom reticle material (glowing blue ring)
              const retMat = new BABYLON.StandardMaterial('retMat', scene);
              retMat.emissiveColor = new BABYLON.Color3(0.1, 0.8, 1.0);
              retMat.disableLighting = true;
              retMat.alpha = 0.8;
              reticle.material = retMat;

              // Scale animation on hover — Quest 3 opt: throttled to every 3rd frame (~30Hz)
              let _reticleFrame = 0;
              const _reticleRay = new BABYLON.Ray(BABYLON.Vector3.Zero(), BABYLON.Vector3.Forward(), 50);
              const _pickPredicate = m => m.isPickable && m.actionManager;
              let _reticleTargetScale = 0.02;

              // Store the observer so it can be removed when the controller disconnects.
              // Without this the λ runs every frame forever, referencing disposed objects.
              const _reticleObs = scene.onBeforeRenderObservable.add(() => {
                if (!controller.pointer) return;

                // Only raycast every 3rd frame for perf (visual lerp still runs)
                if (++_reticleFrame % 3 === 0) {
                  _reticleRay.origin.copyFrom(controller.pointer.getAbsolutePosition());
                  _reticleRay.direction.copyFrom(controller.pointer.getDirection(BABYLON.Vector3.Forward()));
                  const pick = scene.pickWithRay(_reticleRay, _pickPredicate);
                  _reticleTargetScale = pick?.hit ? 0.05 : 0.02;
                }

                // Lerp runs every frame for smoothness
                reticle.scaling.x = BABYLON.Scalar.Lerp(reticle.scaling.x, _reticleTargetScale, 0.2);
                reticle.scaling.y = BABYLON.Scalar.Lerp(reticle.scaling.y, _reticleTargetScale, 0.2);
                reticle.scaling.z = BABYLON.Scalar.Lerp(reticle.scaling.z, _reticleTargetScale, 0.2);
              });

              // Clean up the per-frame observer and reticle material when this
              // controller is removed (e.g. user takes off headset, controller sleeps).
              controller.onDisposeObservable?.addOnce(() => {
                scene.onBeforeRenderObservable.remove(_reticleObs);
                retMat.dispose();
                dbg('[xr] reticle observer disposed for controller ' + (controller.uniqueId || '?'));
              });
            }
          });
        }
      } catch (_) { }

      // Sweep any Babylon-created laser line meshes that survive controller removal.
      // Babylon names its internal ray line meshes with the prefix "laserPointer" or
      // "xrPointer"; iterate the scene and dispose any that are still present.
      const _sweepLineMeshes = () => {
        scene.meshes
          .filter(m => /laserPointer|xrPointer|lazer/i.test(m.name))
          .forEach(m => { try { m.dispose(); } catch (_) { } });
      };

      // Run sweep when a controller is removed
      xrHelper.input.onControllerRemovedObservable?.add(() => {
        setTimeout(_sweepLineMeshes, 100); // slight delay so Babylon finishes its own cleanup first
      });

      // Handle controllers — component-based Quest bindings
      xrHelper.input.onControllerAddedObservable.add((controller) => {
        dbg('[xr] controller added: ' + (controller.uniqueId || 'unknown'));

        controller.onMotionControllerInitObservable.add((motionController) => {
          setupControllerBehaviors(controller, motionController);
          setupQuestControllerBindings(controller, motionController);
        });
      });

      // 6-C: Feature detection via Features Manager (graceful fallback)
      const featMgr = xrHelper.baseExperience.featuresManager;

      // Layers (Multiview for better text/UI clarity)
      try {
        if (BABYLON.WebXRFeatureName?.LAYERS) {
          appState.xrLayerManager = featMgr.enableFeature(BABYLON.WebXRFeatureName.LAYERS, 'latest', {
            preferMultiviewInOut: true
          });
          dbg('[xr] layers enabled');
        }
      } catch (_) {
        dbg('[xr] layers not available');
      }

      // Light Estimation
      try {
        if (BABYLON.WebXRFeatureName?.LIGHT_ESTIMATION) {
          const lightEstimation = featMgr.enableFeature(BABYLON.WebXRFeatureName.LIGHT_ESTIMATION, 'latest', {
            setPreferredColorSpace: true
          });

          lightEstimation.onDirectionalLightUpdatedObservable.add((dirLightInfo) => {
            // We can optionally use dirLightInfo.direction and dirLightInfo.color 
            // to tint our scene (e.g., matching the TV passthrough room lighting).
          });
          dbg('[xr] light estimation enabled');
        }
      } catch (_) {
        dbg('[xr] light estimation not available');
      }

      // Passthrough / Background Remover
      try {
        if (BABYLON.WebXRFeatureName?.BACKGROUND_REMOVER) {
          await featMgr.enableFeature(BABYLON.WebXRFeatureName.BACKGROUND_REMOVER);
          dbg('[xr] passthrough feature enabled');
        }
      } catch (_) {
        dbg('[xr] passthrough not available — hiding PT button');
        if (controlPanel && controlPanel.ptBtn) {
          controlPanel.ptBtn._label.text = 'PT: N/A';
          controlPanel.ptBtn.alpha = 0.3;
          controlPanel.ptBtn.isPointerBlocker = false;
        }
      }
      // Hand tracking
      try {
        if (BABYLON.WebXRFeatureName?.HAND_TRACKING) {
          featMgr.enableFeature(BABYLON.WebXRFeatureName.HAND_TRACKING, 'latest', {
            xrInput: xrHelper.input
          });
          dbg('[xr] hand tracking enabled');
        }
      } catch (_) {
        dbg('[xr] hand tracking not available');
      }
    }

    dbg('[xr] initialization complete');
  } catch (e) {
    dbg('[xr] init failed: ' + e.message);
  }
  return xrHelper;
}

function setupControllerBehaviors(controller, motionController) {
  // 6-C: Safe haptics — null-check before actuating
  const haptics = motionController.gamepad?.hapticActuators;

  controller.onMotionControllerInitObservable.add(() => {
    motionController.onButtonStateChange?.((buttonId, state) => {
      if (state.pressed && haptics?.length) {
        try { haptics[0].pulse(0.5, 10); } catch (_) { }
      }
    });
  });
}

/* ─── Quest controller component-based bindings ───────────────────── */

/**
 * Wire up Quest Touch controller components using the standard
 * WebXR component API (getComponent / getComponentOfType).
 * Works for Quest 2, Quest 3/3S, Quest Pro — all use the
 * WebXROculusTouchMotionController profile.
 *
 * Bindings:
 *   Trigger (select)     → play / pause toggle
 *   Grip (squeeze)       → recenter video + controls
 *   Thumbstick left/right→ seek ±10 s  (with haptic tick)
 *   Thumbstick up/down   → volume ±10 %
 *   A / X button         → cycle format
 *   B / Y button         → show / hide controls
 */
function setupQuestControllerBindings(controller, motionController) {
  // Only apply to Oculus Touch / Meta Quest controllers
  const profileId = (motionController.profileId || '').toLowerCase();
  const isQuest = profileId.includes('oculus') || profileId.includes('touch') || profileId.includes('meta');
  if (!isQuest) {
    dbg(`[quest] skipping non-Quest profile: ${profileId}`);
    return;
  }

  const hand = motionController.handedness;  // 'left' | 'right'
  dbg(`[quest] binding ${hand} controller (${profileId})`);

  // Safe haptic helper (uses motionController.pulse from the typedoc API)
  const pulse = (value = 0.4, ms = 40) => {
    try { motionController.pulse?.(value, ms); } catch (_) { }
  };

  // ── Trigger → click UI if pointer is over a panel, else play/pause ──
  // Babylon's built-in WebXR pointer selection fires onPointerUp on GUI
  // meshes automatically. We only do play/pause when the aim ray misses UI.
  const isAimingAtUI = () => {
    try {
      const aimMesh = controller.pointer;
      if (!aimMesh) return false;
      const origin = aimMesh.getAbsolutePosition();
      const forward = aimMesh.getDirection(BABYLON.Vector3.Forward());
      const ray = new BABYLON.Ray(origin, forward, 10);
      const pick = scene.pickWithRay(
        ray,
        m => m.name === 'controls' || m.name === 'progBar' || m.name === 'miniCtl',
        false
      );
      return pick?.hit === true;
    } catch (_) { return false; }
  };

  const trigger = motionController.getComponentOfType?.('trigger')
    || motionController.getComponent?.('xr-standard-trigger');
  if (trigger) {
    let triggerWasPressed = false;
    trigger.onButtonStateChangedObservable?.add((comp) => {
      if (comp.pressed && !triggerWasPressed) {
        if (isAimingAtUI()) {
          // Pointer selection handles the UI click — give a subtle haptic tick
          pulse(0.2, 15);
          dbg(`[quest:${hand}] trigger → UI click`);
        }
        // Transport (play/pause) is intentionally NOT bound to the trigger.
        // The ControlPanel buttons are the sole source of playback control so
        // accidental trigger presses during scene navigation don't interrupt playback.
      }
      triggerWasPressed = comp.pressed;
    });
  }

  // ── Grip → recenter or 6-DOF Screen Grab ──
  const grip = motionController.getComponentOfType?.('squeeze')
    || motionController.getComponent?.('xr-standard-squeeze');
  if (grip) {
    let gripWasPressed = false;
    let grabbedMesh = null;
    let grabbedOriginalParent = null;

    grip.onButtonStateChangedObservable?.add((comp) => {
      if (comp.pressed && !gripWasPressed) {
        let hitScreen = false;
        try {
          const aimMesh = controller.pointer;
          if (aimMesh) {
            const origin = aimMesh.getAbsolutePosition();
            const forward = aimMesh.getDirection(BABYLON.Vector3.Forward());
            const ray = new BABYLON.Ray(origin, forward, 100);

            const pickableMeshes = [];
            if (videoDisplay?.flatScreen) pickableMeshes.push(videoDisplay.flatScreen);
            if (videoDisplay?.dome?.mesh) pickableMeshes.push(videoDisplay.dome.mesh);

            const pick = scene.pickWithRay(ray, m => pickableMeshes.includes(m), false);

            if (pick?.hit && pick.pickedMesh) {
              hitScreen = true;
              grabbedMesh = pick.pickedMesh;
              grabbedOriginalParent = grabbedMesh.parent;
              grabbedMesh.setParent(aimMesh);
              pulse(0.6, 100);
              dbg(`[quest:${hand}] grip → grabbed screen ${grabbedMesh.name}`);
            }
          }
        } catch (_) { }

        if (!hitScreen) {
          videoDisplay?.recenter();
          controlPanel?.positionForCamera();
          pulse(0.5, 80);
          dbg(`[quest:${hand}] grip → recenter`);
        }
      } else if (!comp.pressed && gripWasPressed) {
        if (grabbedMesh) {
          grabbedMesh.setParent(grabbedOriginalParent);
          pulse(0.3, 30);
          dbg(`[quest:${hand}] grip release → dropped screen ${grabbedMesh.name}`);
          grabbedMesh = null;
          grabbedOriginalParent = null;
        }
      }
      gripWasPressed = comp.pressed;
    });
  }

  // ── Thumbstick → seek (X) + volume (Y) ──
  const thumbstick = motionController.getComponentOfType?.('thumbstick')
    || motionController.getComponent?.('xr-standard-thumbstick');
  if (thumbstick) {
    let seekCooldown = 0;   // debounce axis ticks (ms)
    let volCooldown = 0;
    const AXIS_THRESHOLD = 0.7;   // dead-zone to avoid accidental input
    const COOLDOWN_MS = 350;      // repeat rate limiter

    thumbstick.onAxisValueChangedObservable?.add((axes) => {
      if (appState.current !== 'playing') return;
      const now = Date.now();

      // X axis: seek
      if (Math.abs(axes.x) > AXIS_THRESHOLD && now - seekCooldown > COOLDOWN_MS) {
        const delta = axes.x > 0 ? CONFIG.VIDEO.SEEK_STEP : -CONFIG.VIDEO.SEEK_STEP;
        vc.seekDelta(delta);
        controlPanel?.resetAutoHide();
        pulse(0.25, 20);
        seekCooldown = now;
        dbg(`[quest:${hand}] stick-X → seek ${delta > 0 ? '+' : ''}${delta}s`);
      }

      // Y axis: volume (up is negative Y in WebXR)
      if (Math.abs(axes.y) > AXIS_THRESHOLD && now - volCooldown > COOLDOWN_MS) {
        const step = axes.y < 0 ? CONFIG.VIDEO.VOLUME_STEP : -CONFIG.VIDEO.VOLUME_STEP;
        const newVol = Math.max(0, Math.min(1, vc.volume + step));
        vc.setVolume(newVol);
        if (vc.muted && newVol > 0) { vc.setMuted(false); }
        controlPanel?.updateMuteButton();
        controlPanel?._updateVolBar();
        controlPanel?.resetAutoHide();
        pulse(0.15, 15);
        volCooldown = now;
        dbg(`[quest:${hand}] stick-Y → vol ${Math.round(newVol * 100)}%`);
      }
    });
  }

  // ── A/X button → cycle format ──
  const btnA = motionController.getComponent?.('a-button')
    || motionController.getComponent?.('x-button');
  if (btnA) {
    let aWasPressed = false;
    btnA.onButtonStateChangedObservable?.add((comp) => {
      if (comp.pressed && !aWasPressed && appState.current === 'playing') {
        controlPanel?.cycleFormat();
        pulse(0.4, 50);
        dbg(`[quest:${hand}] A/X → cycle format`);
      }
      aWasPressed = comp.pressed;
    });
  }

  // ── B/Y button → toggle controls visibility or Voice Search ──
  const btnB = motionController.getComponent?.('b-button')
    || motionController.getComponent?.('y-button');
  if (btnB) {
    let bWasPressed = false;
    btnB.onButtonStateChangedObservable?.add((comp) => {
      if (comp.pressed && !bWasPressed) {
        if (appState.current === 'playing') {
          if (controlPanel?._autoHidden) {
            controlPanel.showFromAutoHide();
          } else {
            controlPanel?.setMinimized(!controlPanel.isMinimized);
          }
          pulse(0.3, 30);
          dbg(`[quest:${hand}] B/Y → toggle controls`);
        } else if (appState.current === 'lobby' && libraryBrowser) {
          libraryBrowser.startVoiceSearch();
          pulse(0.4, 40);
          dbg(`[quest:${hand}] B/Y → initiate voice search`);
        }
      }
      bWasPressed = comp.pressed;
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   10. PERFORMANCE MONITORING
   ═══════════════════════════════════════════════════════════════════════ */

class PerformanceMonitor {
  constructor(scene, engine) {
    this.scene = scene;
    this.engine = engine;
    this.lastTime = performance.now();
    this.frames = 0;
    this.currentFPS = 60;
    this.qualityLevel = 1.0;
    // Quest 3 opt: Dynamic resolution scaling
    this._resScale = CONFIG.PERFORMANCE.RESOLUTION_SCALE_MAX;
    this._dynamicRes = CONFIG.PERFORMANCE.ENABLE_DYNAMIC_RESOLUTION;
  }

  update() {
    this.frames++;
    const now = performance.now();
    const delta = now - this.lastTime;

    if (delta >= 1000) {
      this.currentFPS = Math.round((this.frames * 1000) / delta);

      if (this.currentFPS < CONFIG.PERFORMANCE.LOW_FPS_THRESHOLD) {
        this.reduceQuality();
      } else if (this.currentFPS > CONFIG.PERFORMANCE.TARGET_FPS && this.qualityLevel < 1.0) {
        this.increaseQuality();
      }

      // Quest 3 opt: Dynamic resolution scaling based on frame budget
      if (this._dynamicRes) {
        const targetFPS = CONFIG.PERFORMANCE.TARGET_FPS;
        const minScale = CONFIG.PERFORMANCE.RESOLUTION_SCALE_MIN;
        const maxScale = CONFIG.PERFORMANCE.RESOLUTION_SCALE_MAX;

        if (this.currentFPS < targetFPS * 0.85) {
          // Dropping below 85% of target — reduce resolution
          this._resScale = Math.max(minScale, this._resScale - 0.05);
          this.engine.setHardwareScalingLevel(1 / this._resScale);
          dbg(`[perf] Dynamic res ↓ scale=${this._resScale.toFixed(2)} (FPS: ${this.currentFPS})`);
        } else if (this.currentFPS > targetFPS * 0.95 && this._resScale < maxScale) {
          // Comfortably above 95% — slowly restore resolution
          this._resScale = Math.min(maxScale, this._resScale + 0.02);
          this.engine.setHardwareScalingLevel(1 / this._resScale);
          dbg(`[perf] Dynamic res ↑ scale=${this._resScale.toFixed(2)} (FPS: ${this.currentFPS})`);
        }
      }

      this.frames = 0;
      this.lastTime = now;
    }
  }

  reduceQuality() {
    this.qualityLevel = Math.max(0.5, this.qualityLevel * CONFIG.PERFORMANCE.QUALITY_REDUCTION_FACTOR);
    this.scene.performancePriority = BABYLON.Scene.PERFORMANCE_PRIORITY_AGGRESSIVE;
    this.scene.skipFrustumClipping = true;
  }

  increaseQuality() {
    this.qualityLevel = Math.min(1.0, this.qualityLevel / CONFIG.PERFORMANCE.QUALITY_REDUCTION_FACTOR);
    this.scene.performancePriority = BABYLON.Scene.PERFORMANCE_PRIORITY_BACKWARD_COMPATIBLE;
    this.scene.skipFrustumClipping = false;
  }
}

const perfMonitor = new PerformanceMonitor(scene, engine);

/* ═══════════════════════════════════════════════════════════════════════
   11. STATE TRANSITIONS
   ═══════════════════════════════════════════════════════════════════════ */

// Transition helper
function animateLightIntensity(light, targetIntensity, duration = 400) {
  const anim = new BABYLON.Animation('lightFade', 'intensity', 60,
    BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
  anim.setKeys([{ frame: 0, value: light.intensity }, { frame: (duration / 1000) * 60, value: targetIntensity }]);
  scene.beginDirectAnimation(light, [anim], 0, (duration / 1000) * 60, false);
}

async function enterLobby() {
  dbg('[app] entering lobby');
  appState.set('lobby');

  // Clean up playing state
  videoDisplay?.dispose();
  vc.pause();
  videoEl.removeAttribute('src');
  videoEl.load();

  // Reset UI
  if (controlPanel.currentEnvIdx !== 0) {
    controlPanel.resetEnvironment();
  }
  controlPanel.currentZoom = 1.0;
  controlPanel.setHasScript(false);
  camera.fov = CONFIG.VIDEO.DEFAULT_FOV;
  controlPanel.setVisible(false);
  controlPanel.setMinimized(false);
  controlPanel.stopAutoHide();

  setLobbyVisible(true);

  // Smoothly fade the hemisphere light in
  animateLightIntensity(hemi, 0.18, 500);

  // Refresh library
  try {
    controlPanel._clearPerformers();
    controlPanel._clearChapters();
    await libraryBrowser.load();
  } catch (error) {
    dbg('[app] library load failed:', error);
  }
}

async function enterPlaying(media) {
  if (appState.current === 'transitioning') return;
  appState.set('transitioning');

  dbg(`[app] playing: ${media.title} (${media.id})`);

  // Show in-scene spinner (visible in XR where HTML overlays aren't)
  showLoadingSpinner(media.title || 'Loading…');

  // Determine video mode; honour the user's last manual stereo choice for the
  // same mode so e.g. their preferred "180 SBS" survives scene changes.
  const { mode, stereo: guessStereo } = guessMode(media);
  const lastFmt = session.lastFormat;
  const stereo = (lastFmt && lastFmt.mode === mode) ? lastFmt.stereo : guessStereo;
  patchSession({ mode, stereo, id: media.id, title: media.title });

  // Update format button
  const formatIdx = findFormatIdx(mode, stereo);
  controlPanel.currentFormatIdx = formatIdx;
  if (controlPanel.fmtBtn) {
    controlPanel.fmtBtn._label.text = FORMAT_CYCLE[formatIdx].label;
  }

  // Hide lobby and fade out lighting securely
  setLobbyVisible(false);
  animateLightIntensity(hemi, 0.02, 500);

  // Load video with retry
  const src = streamUrl(media.id);
  try {
    await loadVideoWithRetry(src, session.startTime || 0);
  } catch (error) {
    dbg('[app] video load failed:', error);
    hideLoadingSpinner();
    showErrorMessage('Failed to load video');
    enterLobby();
    return;
  }

  // Create video display
  videoDisplay.create(mode, stereo);

  // Reset zoom/FOV to default so every scene starts at the same baseline
  controlPanel.resetZoom();

  // Auto-recenter video to face the user
  setTimeout(() => videoDisplay.recenter(), 100);

  // Show controls
  controlPanel.setMinimized(false);
  controlPanel.setVisible(true);
  controlPanel.positionForCamera();
  controlPanel.startAutoHide();

  // Set script indicator (pass id so Handy HSSP can build the URL)
  controlPanel.setHasScript(!!(media.scriptPath), media.id);

  // Load heatmap + chapter markers + scrub preview
  controlPanel.resetSpriteSheet();
  // Only use locally-downloaded sprite sheets — no CDN fetching
  controlPanel.timelinePreviewUrl = media.local_preview_path
    ? `/api/library/timeline-preview?id=${media.id}`
    : null;

  // Configure sprite sheet and begin loading immediately.
  // SLR format: 4096×4096, 12 cols × 21 rows, 341×195 px per frame.
  // Passing the URL to configureSpriteSheet warms the browser cache so the
  // image is ready before the user first hovers over the timeline.
  const spriteSource = controlPanel.timelinePreviewUrl;
  if (spriteSource) {
    controlPanel.configureSpriteSheet(12, 21, 341, 195, spriteSource);
  }

  // Render performers and chapters from local media data synchronously, then
  // await loadMediaExtras so heatmap + any missing metadata is ready before
  // the scene becomes visible and playback starts.
  dbg(`[app] media data: chapters=${media.timestamps?.length || 0}, performers=${Object.keys(media.performerThumbs || {}).length}`);
  controlPanel._renderPerformers(media.performerThumbs || {});
  controlPanel._renderChapters(media.timestamps || []);
  await controlPanel.loadMediaExtras(media.id);

  // Setup Up Next Smart Auto-Play
  if (videoFeatures && libraryBrowser && libraryBrowser._filtered) {
    videoFeatures.setupUpNext(libraryBrowser._filtered, media.id, (nextMedia) => {
      dbg(`[app] Auto-playing next video: ${nextMedia.title}`);
      exitPlaying();
      setTimeout(() => enterPlaying(nextMedia), 100);
    });
  }

  // Start playback
  try {
    await vc.play();
    // Wait until the video has buffered enough for smooth playback
    // before hiding the loading spinner.  Caps at 10 s on slow networks.
    await waitForVideoReady(videoEl);
    hideLoadingSpinner();

    // Restore volume & rate from session (deep-link params)
    if (session.volume !== undefined && session.volume !== 1) {
      vc.setVolume(session.volume);
    }
    if (session.muted) { vc.setMuted(true); }
    if (session.playbackRate && session.playbackRate !== 1) {
      vc.setPlaybackRate(session.playbackRate);
      if (controlPanel.speedBtn) controlPanel.speedBtn._label.text = session.playbackRate.toFixed(1) + 'x';
    }
    // Restore persisted playback speed preference (survives across sessions)
    try {
      const savedSpeed = parseFloat(localStorage.getItem('vr_speed'));
      if (savedSpeed && savedSpeed !== 1.0 && CONFIG.VIDEO.PLAYBACK_SPEEDS.includes(savedSpeed)) {
        vc.setPlaybackRate(savedSpeed);
        controlPanel.currentSpeed = savedSpeed;
        if (controlPanel.speedBtn) controlPanel.speedBtn._label.text = savedSpeed.toFixed(1) + 'x';
        dbg(`[app] restored playback speed: ${savedSpeed}x`);
      }
    } catch (_) { }
    controlPanel.updateMuteButton();

    appState.set('playing');
    dbg('[app] playback started');
  } catch (error) {
    hideLoadingSpinner();
    dbg('[app] playback failed:', error);
  }
}

/**
 * Resolve once the video element has enough data to start smooth playback
 * (readyState ≥ HAVE_FUTURE_DATA = 3).  Falls back after `timeoutMs` so a
 * slow network never blocks the UI indefinitely.
 */
function waitForVideoReady(el, timeoutMs = 10000) {
  if (el.readyState >= 3) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('canplay', done);
      el.removeEventListener('canplaythrough', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    el.addEventListener('canplay', done, { once: true });
    el.addEventListener('canplaythrough', done, { once: true });
  });
}

async function loadVideoWithRetry(src, startTime, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await vc.load(src, { startAt: startTime });
      return;
    } catch (err) {
      dbg(`[app] load attempt ${i + 1} failed: ${err.message}`);
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

function exitPlaying() {
  dbg('[app] exiting playback');
  videoDisplay.dispose2D();
  const currentTime = vc.currentTime;
  patchSession({ startTime: currentTime });
  // Cancel any running sleep timer so it doesn't fire after the user leaves
  controlPanel.resetSleepTimer();

  // 5-C: Notify opener window (web player) of current position
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({
        type: 'vr-theatre-exit',
        id: session.id,
        t: Math.floor(currentTime),
        mode: session.mode,
        stereo: session.stereo
      }, '*');
    }
  } catch (_) { /* cross-origin or closed, ignore */ }

  enterLobby();
}

function switchFormat(mode, stereo) {
  // Persist so the next scene of the same mode starts with the same stereo
  patchSession({ mode, stereo, lastFormat: { mode, stereo } });

  // When switching formats manually, we exit passthrough if it was active
  if (controlPanel.currentEnvIdx !== 0) {
    controlPanel.resetEnvironment();
  }

  videoDisplay.create(mode, stereo);

  // Recentre so the screen always faces the user after a format switch
  setTimeout(() => videoDisplay.recenter(), 50);

  dbg(`[app] format switched: ${mode} ${stereo}`);
}

function findFormatIdx(mode, stereo) {
  const idx = FORMAT_CYCLE.findIndex(f => f.mode === mode && f.stereo === stereo);
  return idx >= 0 ? idx : FORMAT_CYCLE.length - 1;
}

/* ═══════════════════════════════════════════════════════════════════════
   12. INITIALIZATION
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Enhanced boot function with DeoVR-like features
 */
async function boot() {

  // Update loading progress
  window.updateLoadingProgress?.(10, 'Initializing 3D engine...');

  // Create video display manager
  videoDisplay = new VideoDisplay(scene, camera, videoEl, {
    dbg,
    getZoom: () => controlPanel?.currentZoom ?? 0.5,
    getLayerManager: () => appState.xrLayerManager,
    getXrState: () => xrHelper?.baseExperience?.state
  });

  // Create control panel
  controlPanel = new ControlPanel(scene, vc, {
    dbg,
    appState,
    camera,
    videoDisplay,
    skybox,
    ground,
    getXrHelper: () => xrHelper,
    onExitPlaying: exitPlaying,
    onSwitchFormat: switchFormat,
    isSnapTurnEnabled: CONFIG.VR.SNAP_TURN_ENABLED,
    onSnapTurnToggle: (enabled) => {
      if (vrControllerManager) vrControllerManager.snapTurnEnabled = enabled;
      dbg('[app] snap turn (UI):', enabled);
    },
    onVignetteToggle: (enabled) => {
      pipeline.imageProcessing.vignetteEnabled = enabled;
      pipeline.imageProcessing.vignetteWeight = 0.8;
      pipeline.imageProcessing.vignetteBlendMode = 1; // multiply
      dbg('[app] vignette:', enabled);
    },
    getVideoFeatures: () => videoFeatures,
    onBrowseLibrary: () => {
      // Save position, pause, and reveal the library browser without fully
      // tearing down the video — the user can pick a new scene or re-select the
      // same one (which resumes from saved position via session.startTime).
      const savedTime = vc.currentTime;
      patchSession({ startTime: savedTime });
      vc.pause();
      appState.set('lobby');
      controlPanel.setVisible(false);
      controlPanel.setMinimized(false);
      controlPanel.stopAutoHide();
      setLobbyVisible(true);
      animateLightIntensity(hemi, 0.18, 500);
      libraryBrowser.load().catch(e => dbg('[app] browse library load failed:', e));
      dbg('[app] browse: paused at', savedTime.toFixed(1) + 's');
    },
  });

  // Tap anywhere in scene (dome/sky) to show auto-hidden controls
  scene.onPointerDown = (evt, pickResult) => {
    if (appState.current !== 'playing') return;
    if (!controlPanel._autoHidden) {
      // If controls are visible, reset the auto-hide timer on any interaction
      controlPanel.resetAutoHide();
      return;
    }
    // Only trigger on non-UI picks (dome, skybox, ground etc.)
    const mesh = pickResult?.pickedMesh;
    if (mesh && (mesh.name === 'controls' || mesh.name === 'miniCtl' || mesh.name === 'progBar')) return;
    controlPanel.showFromAutoHide();
  };

  // ── Gaze hot zone: looking down reveals controls ───────────────────────
  // Works in desktop (mouse look) and headset (head direction) without any
  // eye-tracking API. If the camera pitch drops below GAZE_REVEAL_ANGLE the
  // controls appear, with a 1 s cooldown so it can't spam-fire.
  const GAZE_REVEAL_ANGLE = -Math.PI / 5; // -36° from horizontal
  let _gazeRevealCooldown = false;
  scene.onBeforeRenderObservable.add(() => {
    if (appState.current !== 'playing') return;
    if (!controlPanel._autoHidden) return;
    if (_gazeRevealCooldown) return;

    const cam = scene.activeCamera || camera;
    const fwd = cam.getForwardRay ? cam.getForwardRay().direction : cam.getDirection(BABYLON.Vector3.Forward());
    // pitch = arcsin(y) — negative means looking down
    if (fwd.y < Math.sin(GAZE_REVEAL_ANGLE)) {
      _gazeRevealCooldown = true;
      controlPanel.showFromAutoHide();
      setTimeout(() => { _gazeRevealCooldown = false; }, 1000);
    }
  });

  // Initialize video features (bookmarks, history, etc.)
  window.updateLoadingProgress?.(20, 'Loading video features...');
  videoFeatures = new VideoFeatures(vc, session, scene);

  // Initialize VR with enhanced controller support
  window.updateLoadingProgress?.(30, 'Setting up VR...');
  let vrControllerManager;

  try {
    xrHelper = await initXR();
    if (xrHelper) {
      vrControllerManager = new VRControllerManager(scene, xrHelper, camera);
      setupVRControllerEvents(vrControllerManager, videoFeatures);
    }
  } catch (e) {
    dbg('[xr] init error:', e);
    // Continue without VR - fallback to desktop mode
  }

  // Add performance monitoring
  window.updateLoadingProgress?.(40, 'Optimizing performance...');
  scene.registerBeforeRender(() => {
    perfMonitor.update();

    // Update stats overlay if visible
    if (document.getElementById('stats-overlay')?.classList.contains('visible')) {
      window.updateStats?.(
        perfMonitor.currentFPS,
        session.connectivity?.latency || 0,
        perfMonitor.qualityLevel === 1.0 ? 'High' :
          perfMonitor.qualityLevel > 0.7 ? 'Medium' : 'Low'
      );
    }
  });

  // Handle visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && appState.current === 'playing') {
      vc.pause();
      // Record playback position
      videoFeatures.recordPlayback();
    } else if (!document.hidden && appState.current === 'playing') {
      // Resume playback with user interaction check
      vc.play().catch(() => {
        // Autoplay blocked - show play button
        controlPanel.playBtn._label.text = '▶';
      });
    }
  });

  // Handle network changes
  window.addEventListener('online', () => {
    dbg('[app] network online');
    window.updateLoadingProgress?.(50, 'Network reconnected');

    if (appState.current === 'lobby') {
      libraryBrowser.refresh();
    } else if (appState.current === 'playing') {
      // Check if current stream is still available
      checkStreamAvailability();
    }
  });

  window.addEventListener('offline', () => {
    dbg('[app] network offline');
    showErrorMessage('Network connection lost - some features may be unavailable');
  });

  // Handle page unload
  window.addEventListener('beforeunload', () => {
    if (appState.current === 'playing') {
      videoFeatures.recordPlayback();
      patchSession({ startTime: vc.currentTime });
    }
  });

  // Load user preferences and continue watching
  window.updateLoadingProgress?.(60, 'Loading your library...');

  try {
    // Check for continue watching items
    const continueWatching = videoFeatures.getContinueWatching();
    if (continueWatching.length > 0) {
      dbg('[app] found continue watching:', continueWatching.length);
      // You could add a "Continue Watching" section to library browser
      // libraryBrowser.setContinueWatching(continueWatching);
    }

    // Load favorites
    const favorites = videoFeatures.getFavorites();
    dbg('[app] loaded', favorites.length, 'favorites');

    // Load initial state
    const loadingOverlay = document.getElementById('loading-overlay');

    // Check for direct media ID in session
    if (session.id) {
      window.updateLoadingProgress?.(70, 'Loading requested media...');
      dbg('[app] loading session media:', session.id);

      const items = await libraryBrowser.loadRaw();
      const media = items.find(m => String(m.id) === String(session.id));

      if (media) {
        window.updateLoadingProgress?.(90, 'Starting playback...');
        loadingOverlay?.classList.add('hidden');

        // Check if we should resume from last position
        if (session.startTime > 0) {
          vc.seek(session.startTime);
        }

        await enterPlaying(media);

        // Record view in history
        videoFeatures.recordPlayback();

        return;
      } else {
        dbg('[app] session media not found, falling back to lobby');
      }
    }

    // Show lobby with library
    window.updateLoadingProgress?.(80, 'Loading media library...');
    loadingOverlay?.classList.add('hidden');
    await enterLobby();

    // Preload next page of library
    if (CONFIG.LIBRARY.PRELOAD_NEXT_PAGE) {
      setTimeout(() => {
        libraryBrowser.preloadNextPage?.();
      }, 2000);
    }

  } catch (error) {
    dbg('[app] boot error:', error);
    handleBootError(error);
  }
}

/**
 * Setup VR controller event handlers
 */
function setupVRControllerEvents(vrControllerManager, videoFeatures) {
  // Handle controller selection (trigger)
  vrControllerManager.on('select', (data) => {
    dbg('[vr] select', data);

    // Check if pointing at UI
    const pickResult = scene.pick(scene.pointerX, scene.pointerY);
    if (pickResult?.hit) {
      const mesh = pickResult.pickedMesh;

      // Trigger click on GUI elements
      if (mesh?.actionManager) {
        mesh.actionManager.processTrigger(BABYLON.ActionManager.OnPickTrigger);

        // Haptic feedback
        vrControllerManager.triggerHaptic(data.controller.uniqueId, 0.3, 30);
      }
    }
  });

  // Handle grab (grip button)
  vrControllerManager.on('grab', (data) => {
    dbg('[vr] grab', data);

    if (data.active) {
      // Toggle control panel minimize state
      controlPanel.setMinimized(!controlPanel.isMinimized);

      // Haptic feedback
      vrControllerManager.triggerHaptic(data.controller.uniqueId, 0.5, 100);
    }
  });

  // Handle menu button
  vrControllerManager.on('menu', (data) => {
    dbg('[vr] menu', data);

    // Toggle format cycle
    controlPanel.cycleFormat();

    // Haptic feedback
    vrControllerManager.triggerHaptic(data.controller.uniqueId, 0.4, 50);
  });

  // Handle snap turn toggle
  vrControllerManager.on('snapTurnToggled', (data) => {
    dbg('[vr] snap turn:', data.enabled);
    controlPanel?.setSnapTurnEnabled(data.enabled);
    showHint(data.enabled ? 'Snap turn enabled' : 'Smooth turn enabled');
  });

  // Handle hand gestures
  vrControllerManager.on('gesture', (data) => {
    dbg('[vr] gesture:', data);

    if (data.confidence > 0.8) {
      switch (data.gesture) {
        case 'pinch':
          // Quick bookmark
          videoFeatures.addBookmark();
          vrControllerManager.triggerHaptic(data.handId, 0.3, 50);
          showHint('Bookmark added');
          break;

        case 'point':
          // Enter/exit VR
          if (appState.current === 'playing') {
            exitVR();
          }
          break;

        case 'grab':
          // Recenter view
          controlPanel.positionForCamera();
          vrControllerManager.triggerHaptic(data.handId, 0.4, 100);
          break;
      }
    }
  });

  // Handle controller movement
  vrControllerManager.on('move', (data) => {
    if (!controlPanel.isMinimized && appState.current === 'playing') {
      // Move control panel with controller if grabbed
      // Implementation depends on grab state
    }
  });
}

/**
 * Check if current stream is still available
 */
async function checkStreamAvailability() {
  if (!currentMedia?.id) return;

  try {
    const response = await fetch(streamUrl(currentMedia.id), {
      method: 'HEAD',
      cache: 'no-cache'
    });

    if (!response.ok) {
      showErrorMessage('Stream unavailable - returning to lobby');
      setTimeout(() => exitPlaying(), 3000);
    }
  } catch (e) {
    dbg('[app] stream check failed:', e);
  }
}

/**
 * Show temporary hint message
 */
function showHint(message) {
  // Create or reuse hint element
  let hintEl = document.getElementById('vr-hint');

  if (!hintEl) {
    hintEl = document.createElement('div');
    hintEl.id = 'vr-hint';
    hintEl.style.cssText = `
      position: fixed;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: #8ab4f8;
      padding: 12px 24px;
      border-radius: 30px;
      font-size: 16px;
      font-weight: 600;
      z-index: 2000;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(138, 180, 248, 0.3);
      transition: opacity 0.3s ease;
      pointer-events: none;
    `;
    document.body.appendChild(hintEl);
  }

  hintEl.textContent = message;
  hintEl.style.opacity = '1';

  clearTimeout(window.hintTimeout);
  window.hintTimeout = setTimeout(() => {
    hintEl.style.opacity = '0';
  }, CONFIG.UI.HINTS_TIMEOUT || 3000);
}

/**
 * Handle boot errors gracefully
 */
function handleBootError(error) {
  const loadingOverlay = document.getElementById('loading-overlay');
  loadingOverlay?.classList.add('hidden');

  // Show detailed error message
  const errorMessage = error.message || 'Unknown error';
  const errorStack = error.stack || '';

  dbg('[app] fatal error:', errorMessage, errorStack);

  // Check for common issues
  if (errorMessage.includes('WebGL') || errorMessage.includes('context')) {
    showErrorMessage(
      'WebGL not supported. Please update your browser or check graphics drivers.',
      'Graphics Error'
    );
  } else if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
    showErrorMessage(
      'Cannot connect to server. Please check your network connection.',
      'Connection Error'
    );
  } else if (errorMessage.includes('video') || errorMessage.includes('playback')) {
    showErrorMessage(
      'Video playback failed. The file may be corrupted or in an unsupported format.',
      'Playback Error'
    );
  } else {
    showErrorMessage(
      `Failed to initialize: ${errorMessage}`,
      'Initialization Error'
    );
  }

  // Offer recovery options
  showErrorActions();
}

/**
 * Show error actions for recovery
 */
function showErrorActions() {
  const errorOverlay = document.getElementById('error-overlay');
  if (!errorOverlay) return;

  const actions = document.createElement('div');
  actions.className = 'error-actions';
  actions.innerHTML = `
    <button class="error-button primary" onclick="location.reload()">
      Reload Application
    </button>
    <button class="error-button secondary" onclick="resetAndRetry()">
      Reset & Retry
    </button>
    <button class="error-button secondary" onclick="showErrorDetails()">
      Show Details
    </button>
  `;

  errorOverlay.appendChild(actions);
}

/**
 * Reset session and retry boot
 */
window.resetAndRetry = function () {
  // Clear session
  clearSession();

  // Clear caches
  if (libraryBrowser) {
    libraryBrowser.dispose();
  }

  // Reload page
  location.reload();
};

/**
 * Show detailed error information
 */
window.showErrorDetails = function () {
  const details = document.createElement('pre');
  details.style.cssText = `
    background: rgba(0, 0, 0, 0.5);
    color: #ffaaaa;
    padding: 15px;
    border-radius: 8px;
    margin-top: 20px;
    max-width: 80vw;
    overflow: auto;
    font-size: 12px;
    text-align: left;
  `;

  // Collect debug info
  const debugInfo = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    webgl: !!window.WebGLRenderingContext,
    webxr: 'xr' in navigator,
    session: session ? {
      id: session.id,
      mode: session.mode,
      stereo: session.stereo,
      page: session.page
    } : null,
    appState: appState.current,
    videoReadyState: vc?.readyState,
    videoDuration: vc?.duration,
    videoCurrentTime: vc?.currentTime,
    timestamp: new Date().toISOString()
  };

  details.textContent = JSON.stringify(debugInfo, null, 2);

  const errorOverlay = document.getElementById('error-overlay');
  if (errorOverlay) {
    errorOverlay.appendChild(details);
  }
};

/* ═══════════════════════════════════════════════════════════════════════
   14. IN-SCENE LOADING SPINNER (visible in XR when HTML overlay is hidden)
   ═══════════════════════════════════════════════════════════════════════ */

let _loadingSpinner = null;
let _spinnerAnim = null;

function showLoadingSpinner(text = 'Loading…') {
  hideLoadingSpinner();

  const cam = scene.activeCamera || camera;
  const fwd = cam.getForwardRay().direction.clone();
  const pos = cam.globalPosition.clone().add(fwd.scale(3));
  pos.y = Math.max(pos.y, 1.4);

  /* Spinning torus – rotated so the ring faces the camera (opening along Z) */
  const torus = BABYLON.MeshBuilder.CreateTorus('loadSpinner', {
    diameter: 0.4, thickness: 0.04, tessellation: 32
  }, scene);
  torus.position = pos;
  torus.rotation.x = Math.PI / 2;  // tilt ring from XZ-plane to XY-plane so hole faces forward

  const mat = new BABYLON.StandardMaterial('spinMat', scene);
  mat.emissiveColor = new BABYLON.Color3(0.54, 0.75, 0.97);  // accent blue
  mat.disableLighting = true;
  mat.alpha = 0.7;
  torus.material = mat;

  /* Text label below spinner */
  const labelPlane = BABYLON.MeshBuilder.CreatePlane('loadLabel', { width: 2.2, height: 0.4 }, scene);
  labelPlane.position = pos.clone();
  labelPlane.position.y -= 0.38;
  labelPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

  const labelTex = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(labelPlane, 880, 128);
  labelTex.useInvalidateRectOptimization = true;
  const txt = new BABYLON.GUI.TextBlock('spinTxt', text);
  txt.color = 'rgba(232,234,237,0.85)';
  txt.fontSize = 26;
  txt.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  txt.textWrapping = BABYLON.GUI.TextWrapping.WordWrap;
  txt.resizeToFit = false;
  txt.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  labelTex.addControl(txt);

  /* Rotate animation */
  const anim = new BABYLON.Animation('spinAnim', 'rotation.z',
    30, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
  anim.setKeys([
    { frame: 0, value: 0 },
    { frame: 60, value: Math.PI * 2 }
  ]);
  torus.animations = [anim];
  const animRef = scene.beginAnimation(torus, 0, 60, true);

  _loadingSpinner = { torus, mat, labelPlane, labelTex };
  _spinnerAnim = animRef;
}

function hideLoadingSpinner() {
  if (_spinnerAnim) { _spinnerAnim.stop(); _spinnerAnim = null; }
  if (_loadingSpinner) {
    _loadingSpinner.torus.dispose();
    _loadingSpinner.mat.dispose();
    _loadingSpinner.labelTex.dispose();
    _loadingSpinner.labelPlane.dispose();
    _loadingSpinner = null;
  }
}

/**
 * Enhanced showErrorMessage function
 */
function showErrorMessage(message, title = 'Error') {
  const errorOverlay = document.getElementById('error-overlay');
  const errorTitle = document.getElementById('error-title');
  const errorMessage = document.getElementById('error-message');

  if (errorOverlay && errorMessage) {
    if (errorTitle) errorTitle.textContent = title;
    errorMessage.textContent = message;
    errorOverlay.classList.add('visible');

    // Auto-hide after 5 seconds for non-fatal errors
    if (title === 'Warning' || message.includes('Network')) {
      setTimeout(() => {
        errorOverlay.classList.remove('visible');
      }, 5000);
    }
  }

  // Also log to debug
  dbg(`[error] ${title}: ${message}`);
}

// Export for use in other modules
window.showErrorMessage = showErrorMessage;
window.showHint = showHint;

// Start the app
engine.runRenderLoop(() => {
  scene.render();
  perfMonitor.update();
});

window.addEventListener('resize', () => engine.resize());

// Error handling
window.addEventListener('error', (event) => {
  dbg('[app] global error:', event.error);
});

// Start boot sequence
boot().catch(e => {
  dbg('[app] fatal error:', e);
  document.getElementById('loading-overlay')?.classList.add('hidden');
  showErrorMessage('Failed to start application');
});
