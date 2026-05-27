/**
 * vr-controller.js – Advanced VR controller handling with DeoVR-like features
 */

import { CONFIG } from './config.js';

export class VRControllerManager {
  constructor(scene, xrHelper, camera) {
    this.scene = scene;
    this.xrHelper = xrHelper;
    this.camera = camera;
    
    this.controllers = new Map();
    this.handData = new Map();
    this.gestureDetectors = new Map();
    
    this.snapTurnEnabled = CONFIG.VR.SNAP_TURN_ENABLED;
    this.snapAngle = CONFIG.VR.SNAP_TURN_ANGLE;
    this.comfortMode = CONFIG.VR.COMFORT_MODE;
    
    this.init();
  }

  init() {
    if (!this.xrHelper) return;

    // Handle controller additions
    this.xrHelper.input.onControllerAddedObservable.add((controller) => {
      this.setupController(controller);
    });

    // Handle controller removals
    this.xrHelper.input.onControllerRemovedObservable.add((controller) => {
      this.controllers.delete(controller.uniqueId);
    });

    // Handle hand tracking if enabled
    if (CONFIG.VR.ENABLE_HAND_TRACKING) {
      this.setupHandTracking();
    }
  }

  setupController(controller) {
    const controllerId = controller.uniqueId;
    
    // Add controller model
    controller.onMotionControllerInitObservable.add((motionController) => {
      this.enhanceController(controller, motionController);
    });

    // Track controller
    this.controllers.set(controllerId, {
      controller,
      position: new BABYLON.Vector3(),
      rotation: new BABYLON.Quaternion(),
      buttons: new Map(),
      axes: new Map(),
      lastClickTime: 0,
      doubleClickThreshold: 300
    });

    // Add haptic feedback support
    this.setupHaptics(controller);
  }

  enhanceController(controller, motionController) {
    const controllerId = controller.uniqueId;
    const controllerData = this.controllers.get(controllerId);
    
    // Add button mappings for different VR systems
    const buttonMap = {
      'oculus-touch': {
        trigger: 0,
        grip: 1,
        thumbstick: 2,
        buttonA: 3,
        buttonB: 4
      },
      'windows-mixed-reality': {
        trigger: 0,
        grip: 1,
        thumbstick: 2,
        touchpad: 3,
        menu: 4
      },
      'htc-vive': {
        trigger: 0,
        grip: 1,
        touchpad: 2,
        menu: 3
      }
    };

    // Detect controller type
    const controllerType = this.detectControllerType(motionController);
    controllerData.type = controllerType;
    controllerData.buttonMap = buttonMap[controllerType] || buttonMap['oculus-touch'];

    // Add button event handlers
    motionController.onButtonStateChange((buttonId, state) => {
      this.handleButtonEvent(controller, buttonId, state, controllerData);
    });

    // Track axes
    controller.onAxisValueChangedObservable.add((values) => {
      this.handleAxes(controller, values, controllerData);
    });
  }

  detectControllerType(motionController) {
    const id = (motionController.profileId || motionController.id || '').toLowerCase();
    if (id.includes('oculus') || id.includes('touch')) return 'oculus-touch';
    if (id.includes('windows') || id.includes('mixed')) return 'windows-mixed-reality';
    if (id.includes('vive') || id.includes('htc')) return 'htc-vive';
    return 'generic';
  }

  handleButtonEvent(controller, buttonId, state, controllerData) {
    const now = Date.now();
    const button = controllerData.buttons.get(buttonId) || { pressed: false, touched: false };
    
    // Detect double click
    if (state.pressed && !button.pressed) {
      if (now - controllerData.lastClickTime < controllerData.doubleClickThreshold) {
        this.emit('doubleClick', { controller, buttonId, state });
      }
      controllerData.lastClickTime = now;
    }
    
    // Update button state
    button.pressed = state.pressed;
    button.touched = state.touched;
    controllerData.buttons.set(buttonId, button);
    
    // Handle specific button actions
    this.handleButtonActions(controller, buttonId, state, controllerData);
  }

  handleButtonActions(controller, buttonId, state, controllerData) {
    const buttonMap = controllerData.buttonMap;
    
    // Trigger (select)
    if (buttonId === buttonMap.trigger && state.pressed) {
      this.emit('select', { controller, position: controller.position });
    }
    
    // Grip (grab)
    if (buttonId === buttonMap.grip) {
      this.emit('grab', { controller, active: state.pressed });
    }
    
    // Menu (options)
    if (buttonId === buttonMap.menu && state.pressed) {
      this.emit('menu', { controller });
    }
    
    // Thumbstick press (snap turn toggle)
    if (buttonId === buttonMap.thumbstick && state.pressed) {
      this.snapTurnEnabled = !this.snapTurnEnabled;
      this.emit('snapTurnToggled', { enabled: this.snapTurnEnabled });
    }
  }

  handleAxes(controller, values, controllerData) {
    const buttonMap = controllerData.buttonMap;
    
    // Update axes values
    controllerData.axes.set('thumbstick', { x: values[0], y: values[1] });
    
    // Handle thumbstick for movement/snap turn
    if (Math.abs(values[0]) > 0.5 || Math.abs(values[1]) > 0.5) {
      if (this.snapTurnEnabled && Math.abs(values[0]) > 0.8) {
        // Snap turn
        const direction = values[0] > 0 ? -1 : 1;
        this.performSnapTurn(direction * this.snapAngle);
      } else {
        // Smooth movement/turn
        this.emit('move', {
          forward: -values[1] * CONFIG.VR.MOVEMENT_SPEED,
          turn: values[0] * CONFIG.VR.ROTATION_SPEED
        });
      }
    }
  }

  performSnapTurn(angle) {
    const rotation = this.camera.rotation.y + (angle * Math.PI / 180);
    BABYLON.Animation.CreateAndStartAnimation(
      'snapTurn',
      this.camera,
      'rotation.y',
      60,
      10,
      this.camera.rotation.y,
      rotation,
      BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
    );
  }

  setupHandTracking() {
    if (!this.xrHelper.input) return;

    this.xrHelper.input.onHandAddedObservable.add((hand) => {
      this.setupHand(hand);
    });

    this.xrHelper.input.onHandRemovedObservable.add((hand) => {
      this.handData.delete(hand.uniqueId);
    });
  }

  setupHand(hand) {
    const handId = hand.uniqueId;
    
    this.handData.set(handId, {
      hand,
      joints: new Map(),
      lastGesture: null,
      gestureConfidence: 0
    });

    // Track joint positions
    hand.onJointUpdatedObservable.add((jointData) => {
      this.updateHandJoints(handId, jointData);
      this.detectGestures(handId, jointData);
    });

    // Add visual hand representation
    this.createHandVisuals(hand);
  }

  updateHandJoints(handId, jointData) {
    const handData = this.handData.get(handId);
    if (!handData) return;

    jointData.joints.forEach(joint => {
      handData.joints.set(joint.id, {
        position: joint.position.clone(),
        rotation: joint.rotation.clone(),
        radius: joint.radius
      });
    });
  }

  detectGestures(handId, jointData) {
    const handData = this.handData.get(handId);
    if (!handData) return;

    // Detect pinch gesture
    const pinch = this.detectPinch(jointData);
    if (pinch.active) {
      handData.lastGesture = 'pinch';
      handData.gestureConfidence = pinch.confidence;
      this.emit('gesture', { handId, gesture: 'pinch', confidence: pinch.confidence });
    }

    // Detect grab gesture
    const grab = this.detectGrab(jointData);
    if (grab.active) {
      handData.lastGesture = 'grab';
      handData.gestureConfidence = grab.confidence;
      this.emit('gesture', { handId, gesture: 'grab', confidence: grab.confidence });
    }

    // Detect point gesture
    const point = this.detectPoint(jointData);
    if (point.active) {
      handData.lastGesture = 'point';
      handData.gestureConfidence = point.confidence;
      this.emit('gesture', { handId, gesture: 'point', confidence: point.confidence });
    }
  }

  detectPinch(jointData) {
    // Get thumb tip and index tip positions
    const thumb = jointData.joints.find(j => j.id === 'thumb-tip');
    const index = jointData.joints.find(j => j.id === 'index-finger-tip');
    
    if (!thumb || !index) return { active: false, confidence: 0 };
    
    const distance = BABYLON.Vector3.Distance(thumb.position, index.position);
    const confidence = Math.max(0, 1 - (distance / 0.05));
    
    return {
      active: distance < 0.02,
      confidence
    };
  }

  detectGrab(jointData) {
    // Check if fingers are curled
    const fingers = ['index', 'middle', 'ring', 'little'];
    let curledCount = 0;
    
    fingers.forEach(finger => {
      const tip = jointData.joints.find(j => j.id === `${finger}-finger-tip`);
      const base = jointData.joints.find(j => j.id === `${finger}-finger-metacarpal`);
      
      if (tip && base) {
        const distance = BABYLON.Vector3.Distance(tip.position, base.position);
        if (distance < 0.05) curledCount++;
      }
    });
    
    const confidence = curledCount / fingers.length;
    
    return {
      active: curledCount >= 3,
      confidence
    };
  }

  detectPoint(jointData) {
    // Check if only index is extended
    const indexTip = jointData.joints.find(j => j.id === 'index-finger-tip');
    const indexBase = jointData.joints.find(j => j.id === 'index-finger-metacarpal');
    const middleTip = jointData.joints.find(j => j.id === 'middle-finger-tip');
    const middleBase = jointData.joints.find(j => j.id === 'middle-finger-metacarpal');
    
    if (!indexTip || !indexBase || !middleTip || !middleBase) return { active: false, confidence: 0 };
    
    const indexExtended = BABYLON.Vector3.Distance(indexTip.position, indexBase.position) > 0.1;
    const middleCurled = BABYLON.Vector3.Distance(middleTip.position, middleBase.position) < 0.05;
    
    return {
      active: indexExtended && middleCurled,
      confidence: indexExtended && middleCurled ? 0.9 : 0
    };
  }

  createHandVisuals(hand) {
    // Add simple visual representation for hands
    const material = new BABYLON.StandardMaterial(`handMat_${hand.uniqueId}`, this.scene);
    material.emissiveColor = new BABYLON.Color3(0.2, 0.5, 1);
    material.alpha = 0.5;
    
    // Add spheres at joint positions (simplified)
    hand.onJointUpdatedObservable.add((jointData) => {
      // Update visuals based on joint positions
    });
  }

  setupHaptics(controller) {
    controller.onMotionControllerInitObservable.add((motionController) => {
      if (motionController.hapticFeedback) {
        this.controllers.get(controller.uniqueId).haptics = motionController.hapticFeedback;
      }
    });
  }

  /**
   * Trigger haptic feedback
   * @param {string} controllerId - Controller ID
   * @param {number} intensity - 0-1
   * @param {number} duration - milliseconds
   */
  triggerHaptic(controllerId, intensity = 0.5, duration = 50) {
    const controller = this.controllers.get(controllerId);
    if (controller?.haptics) {
      controller.haptics.actuate(intensity, duration);
    }
  }

  /**
   * Get controller ray for UI interaction
   * @param {string} controllerId
   * @returns {BABYLON.Ray}
   */
  getControllerRay(controllerId) {
    const controller = this.controllers.get(controllerId);
    if (!controller) return null;
    
    const forward = new BABYLON.Vector3(0, 0, 1);
    const worldForward = BABYLON.Vector3.TransformNormal(forward, controller.controller.worldMatrix);
    
    return new BABYLON.Ray(
      controller.controller.position.clone(),
      worldForward.normalize(),
      10
    );
  }

  /**
   * Check if controller is pointing at mesh
   * @param {string} controllerId
   * @param {BABYLON.Mesh} mesh
   * @returns {boolean}
   */
  isPointingAt(controllerId, mesh) {
    const ray = this.getControllerRay(controllerId);
    if (!ray) return false;
    
    const pickInfo = this.scene.pickWithRay(ray, (m) => m === mesh);
    return pickInfo?.hit || false;
  }

  /**
   * Event emitter
   */
  emit(event, data) {
    const key = `on${event.charAt(0).toUpperCase() + event.slice(1)}`;
    if (this[key]) {
      this[key].forEach(callback => callback(data));
    }
  }

  /**
   * Event listeners
   */
  on(event, callback) {
    const eventName = `on${event.charAt(0).toUpperCase() + event.slice(1)}`;
    if (!this[eventName]) {
      this[eventName] = [];
    }
    this[eventName].push(callback);
  }

  /**
   * Clean up
   */
  destroy() {
    this.controllers.clear();
    this.handData.clear();
    this.gestureDetectors.clear();
  }
}