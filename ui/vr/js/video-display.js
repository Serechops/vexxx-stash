/**
 * video-display.js – VideoDome / flat-screen lifecycle management.
 *
 * Extracted from app.js. Manages the two display modes used in the VR theatre:
 *  • Immersive dome  (180° / 360°, mono or stereo)
 *  • Flat 2-D screen (used for 2D content and MR passthrough mode)
 *
 * Dependencies injected via constructor opts so this module is testable in
 * isolation and has no direct reference to app-level globals.
 */

export class VideoDisplay {
  /**
   * @param {BABYLON.Scene}          scene
   * @param {BABYLON.UniversalCamera} camera  – default non-XR camera
   * @param {HTMLVideoElement}        videoEl
   * @param {object}                  opts
   * @param {Function}                opts.dbg        – debug logger
   * @param {Function}                opts.getZoom    – () => currentZoom [0..2]
   */
  constructor(scene, camera, videoEl, opts = {}) {
    this._scene = scene;
    this._camera = camera;
    this._videoEl = videoEl;
    this._dbg = opts.dbg || (() => { });
    this._getZoom = opts.getZoom || (() => 0.5);
    this._getLayerManager = opts.getLayerManager || (() => null);
    this._getXrState = opts.getXrState || (() => null);

    this._flatScreenVidTex = null;
    this._xrLayer2D = null;
    this._xrLayer360 = null;

    // Per-frame texture update observer (ensures video frames are pushed to GPU
    // regardless of whether the VideoTexture's internal timeupdate listener fires)
    this._vidTexUpdateObserver = null;

    // Ambilight properties
    this._glowMesh = null;
    this._glowMat = null;
    this._rtt = null; // Downsample Target
    this._ambilightObserver = null; // Quest 3 opt: track for proper disposal
  }

  /** Current dome mesh (null when not in dome mode). */
  get dome() { return this._videoDome; }

  /** Current flat screen mesh (null when not in 2-D mode). */
  get flatScreen() { return this._flatScreen; }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Create (or re-create) the appropriate video display for the given mode.
   * Automatically disposes the previous display first.
   *
   * @param {'180'|'360'|'2d'} mode
   * @param {'sbs'|'tb'|'none'} stereo
   */
  create(mode, stereo) {
    // Babylon's VideoTexture.dispose() calls video.pause() internally.
    // Save playing state so we can resume after the new display is set up.
    const wasPlaying = !this._videoEl.paused;

    // Clean up existing
    this.dispose();

    const layerManager = this._getLayerManager();
    const inXR = this._getXrState() === BABYLON.WebXRState.IN_XR;

    // We always need a VideoTexture for the layers or fallback meshes.
    // invertY: true — video frames are stored bottom-up in WebGL; invert to display right-side up.
    // autoUpdateTexture: true — hooks into the video's timeupdate event as a fallback.
    // A per-frame observer below is the primary update path (more reliable than timeupdate alone).
    this._flatScreenVidTex = new BABYLON.VideoTexture(
      'vrVidTex', this._videoEl, this._scene, false, true,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
      { autoPlay: false, autoUpdateTexture: true }
    );

    // Per-frame texture update: guarantees every rendered frame picks up the latest
    // video image regardless of timeupdate event timing.
    this._vidTexUpdateObserver = this._scene.onBeforeRenderObservable.add(() => {
      if (this._flatScreenVidTex && !this._videoEl.paused && this._videoEl.readyState >= 2) {
        try { this._flatScreenVidTex.update(); } catch (_) { }
      }
    });

    if (mode === '2d') {
      if (inXR && layerManager) {
        // Native XR Cylinder Layer — ultra-wide theatre: 21:9, 8u radius, seated eye level
        this._xrLayer2D = layerManager.createCylinderLayer({
          texture: this._flatScreenVidTex,
          radius: 8,
          centralAngle: Math.PI * 2 / 3, // 120° arc — fills peripheral vision nicely
          aspectRatio: 21 / 9,
          // Layout based on stereo mode
          layout: stereo === 'none' ? BABYLON.WebXRLayerLayout.MONO :
            stereo === 'sbs' ? BABYLON.WebXRLayerLayout.STEREO_LEFT_RIGHT :
              BABYLON.WebXRLayerLayout.STEREO_TOP_BOTTOM
        });

        // Theatre position: 8 units out, seated eye level
        this._xrLayer2D.position = new BABYLON.Vector3(0, 1.8, 8);
        this._dbg('[video] Created XRCylinderLayer for 2D (theatre mode)');
      }

      // Always create fallback mesh so it’s visible on the desktop mirror.
      // High-res layers only show inside the headset.
      // 10 × 4.5 (21:9 aspect) with radius=40 gives a gently curved IMAX-style screen.
      // At default zoom 1.10 this scales to ~16 × 7 world units at 8u distance
      // filling roughly 90° of horizontal FOV — a proper theatre immersion.
      this._flatScreen = this._createCurvedScreen('flatScreen', 10, 4.5, 40);
      this._flatScreen.isPickable = true;
      this._flatScreen.position = new BABYLON.Vector3(0, 1.8, 8);

      const s = 0.5 + this._getZoom();
      this._flatScreen.scaling.setAll(s);

      // StandardMaterial with disableLighting is the most reliable way to render
      // a video texture in a dark scene. PBRMaterial + PERFORMANCE_PRIORITY_AGGRESSIVE
      // can silently drop the emissive pass for dynamic textures.
      this._flatScreenMat = new BABYLON.StandardMaterial('flatScreenMat', this._scene);
      this._flatScreenMat.emissiveTexture = this._flatScreenVidTex;
      this._flatScreenMat.disableLighting = true;
      this._flatScreenMat.backFaceCulling = false;
      this._flatScreen.material = this._flatScreenMat;

      // If we made a layer, we can hide the mesh in the headset to save rendering overhead
      if (this._xrLayer2D) {
        this._flatScreen.layerMask = 0x10000000; // Only render to main camera, not XR cameras
      }

      // Quest 3 opt: Only enable ambilight outside XR (invisible behind XR layers)
      if (!inXR) {
        this._setupAmbilight();
      }

    } else {
      // 180 / 360 Mode
      if (inXR && layerManager && !!BABYLON.WebXRCompositionLayerEquirectangular) {
        // Native XR Equirectangular Layer
        this._xrLayer360 = layerManager.createEquirectangularLayer({
          texture: this._flatScreenVidTex,
          centralHorizontalAngle: mode === '180' ? Math.PI : Math.PI * 2,
          upperVerticalAngle: Math.PI / 2,
          lowerVerticalAngle: -Math.PI / 2,
          radius: 1000,
          layout: stereo === 'sbs' ? BABYLON.WebXRLayerLayout.STEREO_LEFT_RIGHT :
            stereo === 'tb' ? BABYLON.WebXRLayerLayout.STEREO_TOP_BOTTOM :
              BABYLON.WebXRLayerLayout.MONO
        });
        this._dbg('[video] Created XREquirectLayer for 360/180');
      }

      // Fallback Mesh (VideoDome)
      this._videoDome = new BABYLON.VideoDome(
        'videoDome',
        this._videoEl, // We can pass the element directly here, VideoDome makes its own texture internally usually
        {
          resolution: 32,
          clickToPlay: false,
          halfDomeMode: mode === '180',
          size: 1000,
          autoPlay: false,
          useDirectMapping: false,
        },
        this._scene
      );

      if (this._videoDome.mesh) {
        this._videoDome.mesh.isPickable = true;
        if (this._xrLayer360) {
          this._videoDome.mesh.layerMask = 0x10000000; // Hide in headset if layer is active
        }
      }

      this._videoDome.fovMultiplier = this._getZoom();

      // Cover the UV-convergence "needle" artifact at the sphere's north pole.
      // The dome sphere's triangle fan converges to a single point at y=+radius,
      // producing a thin black spike when viewed from inside. A small dark sphere
      // positioned just inside the dome top occludes it cleanly.
      try {
        const capMat = new BABYLON.StandardMaterial('domePoleMat', this._scene);
        capMat.diffuseColor = BABYLON.Color3.Black();
        capMat.emissiveColor = BABYLON.Color3.Black();
        capMat.backFaceCulling = false;
        capMat.disableLighting = true;
        this._poleCap = BABYLON.MeshBuilder.CreateSphere('domePoleCap',
          { diameter: 60, segments: 4 }, this._scene);
        this._poleCap.position.y = 478; // just inside dome top (dome radius = 500)
        this._poleCap.material = capMat;
        this._poleCap.isPickable = false;
      } catch (_) { }

      switch (stereo) {
        case 'sbs':
          this._videoDome.videoMode = BABYLON.VideoDome.MODE_SIDEBYSIDE;
          break;
        case 'tb':
          this._videoDome.videoMode = BABYLON.VideoDome.MODE_TOPBOTTOM;
          break;
        default:
          this._videoDome.videoMode = BABYLON.VideoDome.MODE_MONOSCOPIC;
      }
    }

    // Restore playback if it was running before the format switch.
    // Babylon's dispose() pauses the underlying <video> element — we undo that here.
    if (wasPlaying) {
      this._videoEl.play().catch(() => { /* autoplay policy — caller should handle */ });
    }
  }

  /**
   * Dispose only the flat 2-D screen (keep dome if active).
   */
  dispose2D() {
    // Stop per-frame texture update observer first
    if (this._vidTexUpdateObserver) {
      this._scene.onBeforeRenderObservable.remove(this._vidTexUpdateObserver);
      this._vidTexUpdateObserver = null;
    }
    if (this._flatScreen) {
      this._flatScreen.dispose();
      this._flatScreen = null;
    }
    if (this._xrLayer2D) {
      this._xrLayer2D.dispose();
      this._xrLayer2D = null;
    }
    if (this._flatScreenMat) {
      this._flatScreenMat.emissiveTexture = null;
      this._flatScreenMat.dispose();
      this._flatScreenMat = null;
    }
    if (this._flatScreenVidTex) {
      this._flatScreenVidTex.dispose();
      this._flatScreenVidTex = null;
    }
  }

  /**
   * Dispose everything (dome + flat screen + layers).
   */
  dispose() {
    // Quest 3 opt: unregister ambilight observer to stop per-frame work
    if (this._ambilightObserver) {
      this._scene.onBeforeRenderObservable.remove(this._ambilightObserver);
      this._ambilightObserver = null;
    }
    if (this._glowMesh) {
      this._glowMesh.dispose();
      this._glowMesh = null;
    }
    if (this._glowMat) {
      this._glowMat.dispose();
      this._glowMat = null;
    }
    if (this._rtt) {
      this._rtt.dispose();
      this._rtt = null;
    }
    if (this._poleCap) {
      this._poleCap.material?.dispose();
      this._poleCap.dispose();
      this._poleCap = null;
    }
    if (this._videoDome) {
      this._videoDome.dispose();
      this._videoDome = null;
    }
    if (this._xrLayer360) {
      this._xrLayer360.dispose();
      this._xrLayer360 = null;
    }
    this.dispose2D();
  }

  /**
   * Recenter the video display to face the user's current gaze direction.
   * Uses a smooth 300 ms ease-out LERP animation.
   */
  recenter() {
    const cam = this._scene.activeCamera || this._camera;
    if (!cam) return;

    if (this._videoDome) {
      if (this._videoDome.mesh) {
        this._videoDome.mesh.setParent(null); // Detach on recenter
      }
      const fwd = cam.getForwardRay().direction.clone();
      const heading = Math.atan2(fwd.x, fwd.z);
      const targetY = -heading;

      const startY = this._videoDome.rotation.y;
      const duration = 300;
      const startTime = performance.now();
      const animate = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        const ease = t * (2 - t);
        const newRotY = startY + (targetY - startY) * ease;
        this._videoDome.rotation.y = newRotY;

        if (this._xrLayer360) {
          // XREquirectLayer uses a quaternion for orientation
          this._xrLayer360.orientation = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, newRotY);
        }

        if (t < 1) requestAnimationFrame(animate);
      };
      animate();
      this._dbg(`[recenter] dome targetY=${(targetY * 180 / Math.PI).toFixed(1)}° heading=${(heading * 180 / Math.PI).toFixed(1)}°`);
    }

    if (this._flatScreen || this._xrLayer2D) {
      if (this._flatScreen) this._flatScreen.setParent(null);
      const fwd = cam.getForwardRay().direction.clone();
      fwd.y = 0;
      fwd.normalize();

      const pos = cam.globalPosition.clone();
      // Theatre recentre: push to 8 units — matches the initial theatre placement
      const targetPos = pos.add(fwd.scale(8));
      targetPos.y = pos.y + 0.3;

      const startPos = this._flatScreen.position.clone();
      const duration = 300;
      const startTime = performance.now();
      const animate = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        const ease = t * (2 - t);

        const currentPos = new BABYLON.Vector3();
        BABYLON.Vector3.LerpToRef(startPos, targetPos, ease, currentPos);

        if (this._flatScreen) {
          this._flatScreen.position.copyFrom(currentPos);
          this._flatScreen.lookAt(cam.globalPosition, Math.PI);
        }

        if (this._xrLayer2D) {
          this._xrLayer2D.position.copyFrom(currentPos);
          // Cylinder layer orientation works differently; we rotate it to face the camera
          // but we only rotate around Y
          const lookAtQ = BABYLON.Quaternion.FromLookDirectionRH(cam.globalPosition.subtract(currentPos).normalize(), BABYLON.Vector3.Up());
          this._xrLayer2D.orientation = lookAtQ;
        }

        if (t < 1) requestAnimationFrame(animate);
      };
      animate();
      this._dbg('[recenter] 2D screen repositioned (animated)');
    }
  }

  /**
   * Helper to create an IMAX-style curved ribbon.
   * @param {string} name 
   * @param {number} width 
   * @param {number} height 
   * @param {number} radius - Curve radius (higher = flatter)
   */
  _createCurvedScreen(name, width, height, radius = 10) {
    const tess = 40;
    const path = [];
    const halfW = width / 2;
    // Angle spanning the width of the screen based on radius
    const arc = width / radius;

    for (let i = 0; i <= tess; i++) {
      const pct = i / tess;
      const angle = (pct - 0.5) * arc;
      // Construct the curvature on the X-Z plane
      path.push(new BABYLON.Vector3(
        Math.sin(angle) * radius,
        0,
        (Math.cos(angle) * radius) - radius // Offset so center is at local 0,0,0
      ));
    }

    // Extrude the path vertically to create a 3D ribbon
    const screen = BABYLON.MeshBuilder.CreateRibbon(name, {
      pathArray: [
        path.map(p => p.add(new BABYLON.Vector3(0, height / 2, 0))),
        path.map(p => p.add(new BABYLON.Vector3(0, -height / 2, 0)))
      ],
      sideOrientation: BABYLON.Mesh.DOUBLESIDE
    }, this._scene);

    return screen;
  }

  /**
   * Initializes real-time lighting bleed (Ambilight).
   * Quest 3 opt: Only called outside XR; observer is tracked for proper disposal.
   */
  _setupAmbilight() {
    if (!this._flatScreen) return;

    // 1. Create the Glow Mesh - a larger, blurred plane behind the screen
    // Glow plane sized to overshoot the theatre screen edges for a full-bleed effect
    this._glowMesh = BABYLON.MeshBuilder.CreatePlane('ambilightGlow', { width: 18, height: 9 }, this._scene);
    this._glowMesh.parent = this._flatScreen;
    this._glowMesh.position.z = 0.5; // Slightly behind the curved screen
    this._glowMesh.isPickable = false;

    this._glowMat = new BABYLON.StandardMaterial('glowMat', this._scene);
    this._glowMat.disableLighting = true;
    this._glowMat.emissiveColor = new BABYLON.Color3(0, 0, 0);
    this._glowMat.alpha = 0.6;
    this._glowMat.backFaceCulling = false;
    this._glowMesh.material = this._glowMat;

    // 2. Downsampling RTT - 8x8 is enough for a soft average
    this._rtt = new BABYLON.RenderTargetTexture('ambiDownsample', 8, this._scene, false);

    // Quest 3 opt: Pre-allocate target color (avoid per-frame Color3 allocation)
    const _ambTargetColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    // Quest 3 opt: Throttle to every 6th frame (~15 FPS) — smooth lerp hides the gap
    let _ambFrame = 0;

    // Track the observer for proper disposal
    this._ambilightObserver = this._scene.onBeforeRenderObservable.add(() => {
      if (!this._flatScreenVidTex || !this._flatScreenVidTex.isReady()) return;
      if (++_ambFrame % 6 !== 0) return; // Quest 3 opt: throttle

      // Transition glow color smoothly
      BABYLON.Color3.LerpToRef(this._glowMat.emissiveColor, _ambTargetColor, 0.05, this._glowMat.emissiveColor);
    });
  }
}
