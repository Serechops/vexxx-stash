/**
 * config.js – Central configuration for VR Theater
 * DeoVR-like experience settings
 */

export const CONFIG = {
  // Debug
  DEBUG: true,

  // Video playback
  VIDEO: {
    DEFAULT_FOV: Math.PI / 3,
    MIN_ZOOM: 0.5,
    MAX_ZOOM: 2.0,
    SEEK_STEP: 10,
    VOLUME_STEP: 0.1,
    PLAYBACK_SPEEDS: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],
    SLEEP_TIMER_STEPS: [15, 30, 60],   // minutes; 0 = off (implicit first step)
    BUFFER_TARGET: 30,
    QUALITY_LEVELS: {
      AUTO: -1,
      LOW: 0,      // 480p
      MEDIUM: 1,   // 720p
      HIGH: 2,     // 1080p
      ULTRA: 3,    // 4K
      MAX: 4       // 8K
    }
  },

  // VR settings (DeoVR-like)
  VR: {
    SESSION_MODE: 'immersive-vr',
    REFERENCE_SPACE: 'local', // 'local-floor' requires guardian setup; 'local' is universally supported
    CONTROLLER_MODEL: 'oculus-touch-v3',
    ENABLE_HAND_TRACKING: true,
    DEFAULT_HEIGHT: 1.7,
    MOVEMENT_SPEED: 1.0,
    ROTATION_SPEED: 2.0,
    SNAP_TURN_ANGLE: 45, // degrees
    SNAP_TURN_ENABLED: true,
    COMFORT_MODE: true
  },

  // UI settings
  UI: {
    CONTROL_PANEL_DISTANCE: 2.2,
    CONTROL_PANEL_HEIGHT_OFFSET: -0.4,
    ANIMATION_DURATION: 300,
    SHOW_HINTS: true,
    HINTS_TIMEOUT: 5000,
    AUTOHIDE_CONTROLS: true,
    AUTOHIDE_DELAY: 5000
  },

  // Library settings
  LIBRARY: {
    COLS: 3,
    ROWS: 2,
    CARD_WIDTH: 1.6,
    CARD_HEIGHT: 1.1,
    GAP_X: 0.25,
    GAP_Y: 0.25,
    GRID_Z: 4.5,
    GRID_Y: 2.0,
    THUMBNAIL_SIZE: 512,
    LAZY_LOAD_DISTANCE: 10,
    PRELOAD_NEXT_PAGE: true
  },

  // Network settings
  NETWORK: {
    CONNECTIVITY_CHECK_TIMEOUT: 3000,
    CONNECTIVITY_CHECK_INTERVAL: 30000,
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,
    BANDWIDTH_SAMPLE_SIZE: 5,
    ADAPTIVE_QUALITY: true,
    MIN_BANDWIDTH_4K: 25000, // kbps
    MIN_BANDWIDTH_1080p: 8000,
    MIN_BANDWIDTH_720p: 3000
  },

  // Features (DeoVR-like)
  FEATURES: {
    PASSTHROUGH: true,
    HAND_TRACKING: true,
    EYE_TRACKING: false, // Future
    FOVEATED_RENDERING: true,
    MULTI_VIEW: true,
    SUBTITLES: true,
    AUDIO_TRACKS: true,
    CHAPTERS: true,
    BOOKMARKS: true,
    HISTORY: true,
    PLAYLISTS: true,
    FAVORITES: true,
    RECENTLY_WATCHED: true,
    CONTINUE_WATCHING: true
  },

  // Performance targets
  PERFORMANCE: {
    TARGET_FPS: 90, // Quest 3 default refresh rate (was 72 for Quest 2)
    LOW_FPS_THRESHOLD: 30,
    QUALITY_REDUCTION_FACTOR: 0.7,
    MAX_TEXTURE_SIZE: 4096,
    ENABLE_DYNAMIC_RESOLUTION: true,
    RESOLUTION_SCALE_MIN: 0.7,
    RESOLUTION_SCALE_MAX: 1.0,
    FOVEATION_LEVEL: 2 // 0-3
  }
};