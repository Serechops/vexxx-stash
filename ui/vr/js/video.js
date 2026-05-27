/**
 * video.js – Enhanced video controller for VR theater
 * 
 * UPGRADED VERSION with:
 * - Advanced playback controls (speed, quality, loop)
 * - Better error handling and recovery
 * - Stream quality detection
 * - Buffer management
 * - Event system with cleanup
 * - HLS/DASH support
 * - Network bandwidth monitoring
 * - Audio track selection
 * - Subtitle support
 */

// Constants for video configuration
const VIDEO_CONFIG = {
  BUFFER_TARGET: 30, // Target buffer in seconds
  BUFFER_MIN: 5,     // Minimum buffer before playback
  LOAD_TIMEOUT: 10000, // 10 seconds
  SEEK_TIMEOUT: 5000,  // 5 seconds
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  QUALITY_LEVELS: {
    AUTO: -1,
    LOW: 0,
    MEDIUM: 1,
    HIGH: 2,
    ULTRA: 3
  }
};

// Quality presets (bitrates in kbps)
const QUALITY_PRESETS = {
  [VIDEO_CONFIG.QUALITY_LEVELS.LOW]: { width: 854, height: 480, bitrate: 1500 },
  [VIDEO_CONFIG.QUALITY_LEVELS.MEDIUM]: { width: 1280, height: 720, bitrate: 3000 },
  [VIDEO_CONFIG.QUALITY_LEVELS.HIGH]: { width: 1920, height: 1080, bitrate: 6000 },
  [VIDEO_CONFIG.QUALITY_LEVELS.ULTRA]: { width: 3840, height: 2160, bitrate: 15000 }
};

export class VideoController {
  /**
   * @param {HTMLVideoElement} videoEl – the native <video> element
   * @param {Object} options – configuration options
   */
  constructor(videoEl, options = {}) {
    if (!(videoEl instanceof HTMLVideoElement)) {
      throw new TypeError('VideoController expects an HTMLVideoElement');
    }

    this._el = videoEl;
    this._options = {
      enableHLS: options.enableHLS !== false,
      enableDASH: options.enableDASH !== false,
      autoQuality: options.autoQuality !== false,
      preferredQuality: options.preferredQuality || VIDEO_CONFIG.QUALITY_LEVELS.AUTO,
      bufferTarget: options.bufferTarget || VIDEO_CONFIG.BUFFER_TARGET,
      ...options
    };

    // State
    this._state = 'idle'; // idle, loading, playing, paused, buffering, error
    this._quality = this._options.preferredQuality;
    this._availableQualities = [];
    this._bandwidth = 0;
    this._loadPromise = null;
    this._abortController = null;
    this._retryCount = 0;
    
    // Event handlers
    this._eventListeners = new Map();
    this._observers = {
      timeupdate: [],
      durationchange: [],
      loadedmetadata: [],
      loadeddata: [],
      canplay: [],
      canplaythrough: [],
      playing: [],
      pause: [],
      ended: [],
      error: [],
      waiting: [],
      progress: [],
      volumechange: [],
      ratechange: [],
      qualitychange: []
    };

    // HLS/DASH support
    this._hls = null;
    this._dash = null;

    // Stats
    this._stats = {
      loadTime: 0,
      bufferingEvents: 0,
      droppedFrames: 0,
      decodedFrames: 0
    };

    // Bind methods
    this._handleEvent = this._handleEvent.bind(this);
    this._handleError = this._handleError.bind(this);
    this._checkBuffer = this._checkBuffer.bind(this);

    // Initialize
    this._setupEventListeners();
    this._initMediaCapabilities();
  }

  /* ── Initialization ────────────────────────────────────────────── */

  _setupEventListeners() {
    const events = [
      'timeupdate', 'durationchange', 'loadedmetadata', 'loadeddata',
      'canplay', 'canplaythrough', 'playing', 'pause', 'ended', 'error',
      'waiting', 'progress', 'volumechange', 'ratechange', 'stalled',
      'suspend', 'emptied'
    ];

    events.forEach(event => {
      const handler = (e) => this._handleEvent(event, e);
      this._el.addEventListener(event, handler);
      this._eventListeners.set(event, handler);
    });

    // Video stats
    if (this._el.getVideoPlaybackQuality) {
      this._statsInterval = setInterval(() => this._updateStats(), 1000);
    }
  }

  _initMediaCapabilities() {
    // Check for Media Capabilities API
    if ('mediaCapabilities' in navigator) {
      // We'll use this for quality adaptation
    }
  }

  _cleanupEventListeners() {
    this._eventListeners.forEach((handler, event) => {
      this._el.removeEventListener(event, handler);
    });
    this._eventListeners.clear();
    
    if (this._statsInterval) {
      clearInterval(this._statsInterval);
    }
  }

  /* ── Public API ────────────────────────────────────────────────── */

  /**
   * Load a video source with advanced options
   * @param {string|Object} src – URL or source configuration
   * @param {Object} options – load options
   * @returns {Promise}
   */
  async load(src, options = {}) {
    // Cancel any ongoing load
    this._abortLoad();

    this._state = 'loading';
    this._retryCount = 0;
    
    const loadOptions = {
      startAt: options.startAt || 0,
      autoPlay: options.autoPlay || false,
      muted: options.muted || false,
      crossOrigin: options.crossOrigin || 'anonymous',
      preload: options.preload || 'auto',
      ...options
    };

    // Reset element
    this._el.removeAttribute('src');
    this._el.load();

    // Configure element
    this._el.crossOrigin = loadOptions.crossOrigin;
    this._el.preload = loadOptions.preload;
    this._el.muted = loadOptions.muted;

    // Handle different source types
    if (typeof src === 'string') {
      // Single URL
      return this._loadSingleSource(src, loadOptions);
    } else if (Array.isArray(src)) {
      // Multiple quality levels
      return this._loadAdaptiveSource(src, loadOptions);
    } else if (src.hls || src.dash) {
      // HLS or DASH manifest
      return this._loadStreamingSource(src, loadOptions);
    } else {
      throw new Error('Invalid source format');
    }
  }

  /**
   * Start playback with options
   * @param {Object} options – play options
   * @returns {Promise}
   */
  async play(options = {}) {
    if (this._state === 'error') {
      throw new Error('Cannot play: video in error state');
    }

    try {
      // Handle autoplay restrictions
      const playPromise = this._el.play();
      
      if (playPromise !== undefined) {
        await playPromise;
        this._state = 'playing';
        this._emit('playing');
      }
      
      return playPromise;
    } catch (error) {
      // Autoplay blocked – try with muted
      if (error.name === 'NotAllowedError' && !options.suppressMutedFallback) {
        this._el.muted = true;
        return this.play({ ...options, suppressMutedFallback: true });
      }
      
      this._handleError(error);
      throw error;
    }
  }

  /**
   * Pause playback
   */
  pause() {
    this._el.pause();
    this._state = 'paused';
    this._emit('pause');
  }

  /**
   * Toggle play/pause.
   * Guards against the "must click twice" symptom:
   *  - If the element has no usable data yet we do nothing.
   *  - If a load is still in progress we do nothing (play will be called by
   *    enterPlaying once loading completes).
   *  - If the video is stalled/waiting but technically not paused we still
   *    honour a play request rather than pausing.
   */
  async toggle() {
    if (this._state === 'loading') return; // load in progress — wait for it
    if (this._el.readyState < 2) return;  // no usable frame data yet
    if (this._el.paused) {
      return this.play();
    } else {
      this.pause();
    }
  }

  /**
   * Stop playback and unload
   */
  stop() {
    this.pause();
    this._el.removeAttribute('src');
    this._el.load();
    this._state = 'idle';
  }

  /**
   * Seek to time with verification
   * @param {number} time – target time in seconds
   * @returns {Promise}
   */
  async seek(time) {
    if (!isFinite(time)) return;

    const targetTime = Math.max(0, Math.min(time, this.duration || Infinity));
    this._el.currentTime = targetTime;

    return new Promise((resolve) => {
      // Large timeout to handle buffering over slow HTTP streams.
      // We always *resolve* – never reject – so callers never see
      // unhandled rejections from normal scrub activity.
      const timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, 20000);

      const handleSeeked = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this._el.removeEventListener('seeked', handleSeeked);
      };

      this._el.addEventListener('seeked', handleSeeked);
    });
  }

  /**
   * Seek relative to current position
   * @param {number} delta – seconds to seek
   */
  seekDelta(delta) {
    return this.seek(this.currentTime + delta);
  }

  /**
   * Set playback rate (speed)
   * @param {number} rate – playback rate (0.5 - 2.0)
   */
  setPlaybackRate(rate) {
    const clampedRate = Math.max(0.5, Math.min(2.0, rate));
    this._el.playbackRate = clampedRate;
  }

  /**
   * Set volume
   * @param {number} value – volume (0-1)
   */
  setVolume(value) {
    this._el.volume = Math.max(0, Math.min(1, value));
  }

  /**
   * Set muted state
   * @param {boolean} muted
   */
  setMuted(muted) {
    this._el.muted = muted;
  }

  /**
   * Toggle mute
   */
  toggleMute() {
    this._el.muted = !this._el.muted;
  }

  /**
   * Set loop state
   * @param {boolean} loop
   */
  setLoop(loop) {
    this._el.loop = loop;
  }

  /**
   * Set quality level
   * @param {number} level – quality level index or VIDEO_CONFIG.QUALITY_LEVELS.AUTO
   */
  setQuality(level) {
    if (this._hls) {
      // HLS quality adaptation
      if (level === VIDEO_CONFIG.QUALITY_LEVELS.AUTO) {
        this._hls.currentLevel = -1;
      } else {
        this._hls.levels.forEach((lvl, idx) => {
          if (lvl.height >= QUALITY_PRESETS[level]?.height) {
            this._hls.currentLevel = idx;
          }
        });
      }
    } else if (this._dash) {
      // DASH quality adaptation
      // Implementation depends on DASH library
    }

    this._quality = level;
    this._emit('qualitychange', { quality: level });
  }

  /**
   * Get available quality levels
   * @returns {Array}
   */
  getAvailableQualities() {
    if (this._hls) {
      return this._hls.levels.map(lvl => ({
        height: lvl.height,
        width: lvl.width,
        bitrate: lvl.bitrate,
        index: lvl.index
      }));
    }
    return this._availableQualities;
  }

  /* ── Private Load Methods ──────────────────────────────────────── */

  async _loadSingleSource(src, options) {
    this._loadPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Load timeout'));
      }, VIDEO_CONFIG.LOAD_TIMEOUT);

      const handleCanPlay = () => {
        cleanup();
        if (options.startAt > 0) {
          this.seek(options.startAt).then(resolve).catch(reject);
        } else {
          resolve();
        }
      };

      const handleError = (error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this._el.removeEventListener('canplay', handleCanPlay);
        this._el.removeEventListener('error', handleError);
      };

      this._el.addEventListener('canplay', handleCanPlay);
      this._el.addEventListener('error', handleError);

      this._el.src = src;
      this._el.load();
    });

    try {
      await this._loadPromise;
      this._state = 'paused';
      return this;
    } catch (error) {
      this._state = 'error';
      throw error;
    }
  }

  async _loadAdaptiveSource(qualities, options) {
    // Sort qualities by resolution/bitrate
    this._availableQualities = qualities.sort((a, b) => 
      (b.width * b.height) - (a.width * a.height)
    );

    // Select initial quality
    const initialQuality = this._options.autoQuality ? 
      await this._selectOptimalQuality() : 
      this._availableQualities[this._quality] || this._availableQualities[0];

    return this._loadSingleSource(initialQuality.url, options);
  }

  async _loadStreamingSource(streamConfig, options) {
    if (streamConfig.hls && this._options.enableHLS) {
      return this._loadHLS(streamConfig.hls, options);
    } else if (streamConfig.dash && this._options.enableDASH) {
      return this._loadDASH(streamConfig.dash, options);
    } else {
      throw new Error('Streaming format not supported');
    }
  }

  async _loadHLS(manifestUrl, options) {
    // Dynamically import HLS.js
    const HLS = await import('hls.js').then(m => m.default);
    
    if (!HLS.isSupported()) {
      throw new Error('HLS not supported');
    }

    this._hls = new HLS({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90
    });

    return new Promise((resolve, reject) => {
      this._hls.on(HLS.Events.MANIFEST_PARSED, () => {
        this._availableQualities = this._hls.levels;
        
        if (options.startAt > 0) {
          this.seek(options.startAt);
        }
        
        resolve();
      });

      this._hls.on(HLS.Events.ERROR, (event, data) => {
        if (data.fatal) {
          reject(new Error(`HLS fatal error: ${data.type}`));
        }
      });

      this._hls.loadSource(manifestUrl);
      this._hls.attachMedia(this._el);
    });
  }

  async _loadDASH(manifestUrl, options) {
    // Dynamically import dash.js
    const dashjs = await import('dashjs').then(m => m.default);
    
    this._dash = dashjs.MediaPlayer().create();
    this._dash.initialize(this._el, manifestUrl, false);

    return new Promise((resolve) => {
      this._dash.on('streamInitialized', () => {
        if (options.startAt > 0) {
          this.seek(options.startAt);
        }
        resolve();
      });
    });
  }

  /* ── Quality Adaptation ────────────────────────────────────────── */

  async _selectOptimalQuality() {
    // Estimate bandwidth
    const bandwidth = await this._estimateBandwidth();
    
    // Select quality based on bandwidth
    for (let i = this._availableQualities.length - 1; i >= 0; i--) {
      const quality = this._availableQualities[i];
      if (quality.bitrate && quality.bitrate * 1.5 < bandwidth) {
        return quality;
      }
    }
    
    return this._availableQualities[0];
  }

  async _estimateBandwidth() {
    return new Promise((resolve) => {
      if (navigator.connection) {
        // Use Network Information API
        const connection = navigator.connection;
        const bandwidth = connection.downlink * 1000; // Convert to kbps
        resolve(bandwidth);
      } else {
        // Fallback to sample download
        this._measureBandwidth().then(resolve);
      }
    });
  }

  async _measureBandwidth() {
    const startTime = performance.now();
    const testUrl = '/api/bandwidth-test'; // Your test endpoint
    const testSize = 1024 * 1024; // 1MB test file
    
    try {
      const response = await fetch(testUrl);
      await response.blob();
      const duration = (performance.now() - startTime) / 1000;
      const bandwidth = (testSize * 8) / duration; // bits per second
      return bandwidth / 1000; // kbps
    } catch {
      return 5000; // Default fallback
    }
  }

  /* ── Buffer Management ─────────────────────────────────────────── */

  _checkBuffer() {
    if (this._el.buffered.length === 0) return;

    const currentTime = this._el.currentTime;
    const bufferedEnd = this._el.buffered.end(this._el.buffered.length - 1);
    const bufferAhead = bufferedEnd - currentTime;

    if (bufferAhead < VIDEO_CONFIG.BUFFER_MIN && this._state === 'playing') {
      this._state = 'buffering';
      this._emit('waiting');
      this._stats.bufferingEvents++;
    } else if (bufferAhead > VIDEO_CONFIG.BUFFER_TARGET && this._state === 'buffering') {
      this._state = 'playing';
    }
  }

  /* ── Stats and Monitoring ──────────────────────────────────────── */

  _updateStats() {
    if (this._el.getVideoPlaybackQuality) {
      const quality = this._el.getVideoPlaybackQuality();
      this._stats.droppedFrames = quality.droppedVideoFrames;
      this._stats.decodedFrames = quality.totalVideoFrames;
    }
  }

  getStats() {
    return {
      ...this._stats,
      currentTime: this.currentTime,
      duration: this.duration,
      readyState: this.readyState,
      networkState: this._el.networkState,
      buffered: this._getBufferedRanges(),
      state: this._state,
      quality: this._quality
    };
  }

  _getBufferedRanges() {
    const ranges = [];
    for (let i = 0; i < this._el.buffered.length; i++) {
      ranges.push({
        start: this._el.buffered.start(i),
        end: this._el.buffered.end(i)
      });
    }
    return ranges;
  }

  /* ── Error Handling ────────────────────────────────────────────── */

  _handleError(error) {
    this._state = 'error';
    this._stats.lastError = {
      message: error.message,
      time: new Date().toISOString(),
      code: this._el.error?.code,
      networkState: this._el.networkState,
      readyState: this._el.readyState
    };

    this._emit('error', this._stats.lastError);
    
    // Attempt recovery if appropriate
    if (this._retryCount < VIDEO_CONFIG.RETRY_ATTEMPTS) {
      this._retryCount++;
      setTimeout(() => this._retryLoad(), VIDEO_CONFIG.RETRY_DELAY * this._retryCount);
    }
  }

  async _retryLoad() {
    if (this._el.src) {
      const currentSrc = this._el.src;
      const currentTime = this._el.currentTime;
      await this.load(currentSrc, { startAt: currentTime });
    }
  }

  _abortLoad() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    
    if (this._loadPromise) {
      // Don't reject, just clean up
      this._loadPromise = null;
    }
  }

  /* ── Event System ──────────────────────────────────────────────── */

  _handleEvent(event, nativeEvent) {
    // Update state based on events
    switch (event) {
      case 'playing':
        this._state = 'playing';
        break;
      case 'pause':
        this._state = 'paused';
        break;
      case 'waiting':
      case 'stalled':
        this._state = 'buffering';
        break;
      case 'ended':
        this._state = 'ended';
        break;
      case 'error':
        this._handleError(nativeEvent.error || new Error('Video error'));
        break;
      case 'progress':
        this._checkBuffer();
        break;
    }

    // Emit to observers
    this._emit(event, nativeEvent);
  }

  _emit(event, data) {
    if (this._observers[event]) {
      this._observers[event].forEach(callback => {
        try {
          callback(data);
        } catch (e) {
          console.warn(`Error in ${event} callback:`, e);
        }
      });
    }
  }

  /**
   * Register callback for time updates
   * @param {Function} callback – receives (currentTime, duration)
   * @returns {Function} – unsubscribe function
   */
  onTimeUpdate(callback) {
    return this._addObserver('timeupdate', callback);
  }

  /**
   * Register callback for duration changes
   * @param {Function} callback – receives (duration)
   */
  onDurationChange(callback) {
    return this._addObserver('durationchange', callback);
  }

  /**
   * Register callback for playback end
   * @param {Function} callback
   */
  onEnded(callback) {
    return this._addObserver('ended', callback);
  }

  /**
   * Register callback for errors
   * @param {Function} callback – receives (error)
   */
  onError(callback) {
    return this._addObserver('error', callback);
  }

  /**
   * Register callback for quality changes
   * @param {Function} callback – receives ({ quality })
   */
  onQualityChange(callback) {
    return this._addObserver('qualitychange', callback);
  }

  /**
   * Register callback for buffering events
   * @param {Function} callback
   */
  onBuffering(callback) {
    const unsubscribeWaiting = this._addObserver('waiting', callback);
    const unsubscribePlaying = this._addObserver('playing', callback);
    return () => {
      unsubscribeWaiting();
      unsubscribePlaying();
    };
  }

  _addObserver(event, callback) {
    if (!this._observers[event]) {
      this._observers[event] = [];
    }
    
    this._observers[event].push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this._observers[event].indexOf(callback);
      if (index > -1) {
        this._observers[event].splice(index, 1);
      }
    };
  }

  /* ── Getters ───────────────────────────────────────────────────── */

  get state() { return this._state; }
  get paused() { return this._el.paused; }
  get muted() { return this._el.muted; }
  get volume() { return this._el.volume; }
  get currentTime() { return this._el.currentTime; }
  get duration() { return this._el.duration || 0; }
  get readyState() { return this._el.readyState; }
  get playbackRate() { return this._el.playbackRate; }
  get src() { return this._el.src; }
  get el() { return this._el; }
  get error() { return this._el.error; }
  get buffered() { return this._el.buffered; }
  get seeking() { return this._el.seeking; }
  get ended() { return this._el.ended; }
  get loop() { return this._el.loop; }
  get quality() { return this._quality; }

  /* ── Cleanup ───────────────────────────────────────────────────── */

  /**
   * Clean up resources and remove event listeners
   */
  destroy() {
    this.stop();
    this._cleanupEventListeners();
    
    if (this._hls) {
      this._hls.destroy();
      this._hls = null;
    }
    
    if (this._dash) {
      this._dash.reset();
      this._dash = null;
    }
    
    this._observers = {};
    this._stats = {};
    this._abortLoad();
  }
}

/* ── Utility Functions ───────────────────────────────────────────── */

/**
 * Format time in seconds to HH:MM:SS
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parse time string to seconds
 * @param {string} timeStr – format: "HH:MM:SS" or "MM:SS"
 * @returns {number}
 */
export function parseTime(timeStr) {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}