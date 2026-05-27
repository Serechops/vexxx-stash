/**
 * session.js – VR Theater session state management
 * 
 * UPGRADED VERSION with:
 * - Type-safe state management
 * - Enhanced URL parameter handling
 * - Session validation and recovery
 * - Event system for state changes
 * - Better error handling
 * - Server connectivity detection
 * - History management
 * - Multi-session support
 */

const STORAGE_KEY = 'handy_vr_session';
const SESSION_VERSION = '1.0.0';
const CONNECTIVITY_CHECK_TIMEOUT = 3000;

// Session state schema with defaults
const DEFAULT_SESSION = {
  // Media info
  id: null,
  src: null,
  mode: '2d',           // '2d' | '180' | '360'
  stereo: 'none',       // 'none' | 'sbs' | 'tb'
  title: '',
  studio: '',
  performers: [],
  tags: [],
  duration: 0,

  // Playback state
  startTime: 0,
  volume: 1.0,
  muted: false,
  playbackRate: 1.0,
  quality: 'auto',      // 'auto' | 'low' | 'medium' | 'high' | 'ultra'

  // UI state
  page: 1,
  controlsMinimized: false,
  lastFormat: null,

  // System
  serverUrl: '',
  lastUpdated: Date.now(),
  version: SESSION_VERSION,
  connectivity: {
    status: 'unknown',  // 'unknown' | 'online' | 'offline' | 'checking'
    lastCheck: null,
    latency: null
  }
};

// URL parameter mapping
const URL_PARAM_MAPPING = {
  id: 'id',
  src: 'src',
  mode: 'mode',
  stereo: 'stereo',
  title: 'title',
  studio: 'studio',
  performers: 'performers',
  t: 'startTime',
  page: 'page',
  quality: 'quality',
  muted: 'muted',
  volume: 'volume',
  speed: 'playbackRate'
};

// Parameter validators and transformers
const PARAM_TRANSFORMERS = {
  startTime: (val) => parseFloat(val) || 0,
  page: (val) => parseInt(val) || 1,
  volume: (val) => Math.max(0, Math.min(1, parseFloat(val) || 1)),
  muted: (val) => val === 'true' || val === '1',
  playbackRate: (val) => Math.max(0.5, Math.min(2, parseFloat(val) || 1)),
  performers: (val) => val.split(',').map(s => s.trim()),
  tags: (val) => val.split(',').map(s => s.trim())
};

/* ═══════════════════════════════════════════════════════════════════════
   1. SERVER URL DETECTION
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Derive server URL based on current page context
 * Enhanced with better detection and fallbacks
 */
function deriveServerUrl() {
  const { hostname, protocol, port } = window.location;

  // Development environment detection
  const isDevServer = port === '3000' || port === '5173' || port === '8081';
  const isGoServer = port === '8080' || port === '8443';

  // If served directly from Go binary
  if (isGoServer) {
    return ''; // Use relative paths
  }

  // If in development with Vite/Webpack, API is on Go port
  if (isDevServer) {
    const goPort = protocol === 'https:' ? '8443' : '8080';
    return `${protocol}//${hostname}:${goPort}`;
  }

  // Production with reverse proxy - assume API at same origin
  return '';
}

/* ═══════════════════════════════════════════════════════════════════════
   2. SESSION MANAGER CLASS
   ═══════════════════════════════════════════════════════════════════════ */

class SessionManager {
  constructor() {
    this._state = { ...DEFAULT_SESSION };
    this._listeners = new Set();
    this._history = [];
    this._historyIndex = -1;
    this._connectivityCheckInterval = null;

    // Bind methods
    this._handleStorageChange = this._handleStorageChange.bind(this);
    this._checkConnectivity = this._checkConnectivity.bind(this);

    // Initialize
    this._load();
    this._setupListeners();
    this._startConnectivityMonitoring();
  }

  /* ── Initialization ─────────────────────────────────────────────── */

  _load() {
    try {
      // Load from localStorage
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);

        // Version check and migration
        if (parsed.version !== SESSION_VERSION) {
          this._migrateSession(parsed);
        } else {
          Object.assign(this._state, DEFAULT_SESSION, parsed);
        }
      }

      // Apply URL parameters (they override stored values)
      this._applyURLParameters();

      // Ensure server URL is current
      this._state.serverUrl = deriveServerUrl();
      this._state.lastUpdated = Date.now();

    } catch (error) {
      console.warn('[Session] Failed to load session:', error);
      // Fall back to defaults with URL params
      this._applyURLParameters();
    }
  }

  _migrateSession(oldSession) {
    console.log('[Session] Migrating from version', oldSession.version);

    // Perform migrations based on version
    const migrated = {
      ...DEFAULT_SESSION,
      ...oldSession,
      version: SESSION_VERSION
    };

    // Handle specific version migrations
    if (!oldSession.version || oldSession.version < '1.0.0') {
      // Convert performers string to array if needed
      if (typeof migrated.performers === 'string') {
        migrated.performers = migrated.performers.split(',').map(s => s.trim());
      }

      // Add new fields with defaults
      migrated.quality = migrated.quality || 'auto';
      migrated.playbackRate = migrated.playbackRate || 1.0;
    }

    Object.assign(this._state, migrated);
  }

  _applyURLParameters() {
    const params = new URLSearchParams(window.location.search);

    for (const [urlParam, stateKey] of Object.entries(URL_PARAM_MAPPING)) {
      if (params.has(urlParam)) {
        let value = params.get(urlParam);

        // Apply transformer if exists
        if (PARAM_TRANSFORMERS[stateKey]) {
          value = PARAM_TRANSFORMERS[stateKey](value);
        }

        this._state[stateKey] = value;
      }
    }

    // Handle special cases
    if (params.has('t') && !params.has('startTime')) {
      this._state.startTime = PARAM_TRANSFORMERS.startTime(params.get('t'));
    }
  }

  _setupListeners() {
    // Listen for storage events from other tabs
    window.addEventListener('storage', this._handleStorageChange);

    // Listen for history changes
    window.addEventListener('popstate', (event) => {
      if (event.state?.session) {
        this._restoreFromHistory(event.state.session);
      }
    });
  }

  _handleStorageChange(event) {
    if (event.key === STORAGE_KEY && event.newValue) {
      try {
        const newState = JSON.parse(event.newValue);
        const oldState = { ...this._state };
        Object.assign(this._state, newState);
        this._notifyListeners(oldState, this._state);
      } catch (error) {
        console.warn('[Session] Failed to handle storage change:', error);
      }
    }
  }

  /* ── Connectivity Monitoring ────────────────────────────────────── */

  _startConnectivityMonitoring() {
    this._checkConnectivity();
    this._connectivityCheckInterval = setInterval(
      this._checkConnectivity,
      30000 // Check every 30 seconds
    );
  }

  async _checkConnectivity() {
    const oldStatus = this._state.connectivity.status;

    this._state.connectivity.status = 'checking';
    this._state.connectivity.lastCheck = Date.now();

    try {
      const startTime = performance.now();
      const response = await fetch(`${this._state.serverUrl}/api/ping`, {
        method: 'HEAD',
        cache: 'no-cache',
        timeout: CONNECTIVITY_CHECK_TIMEOUT
      });

      const latency = performance.now() - startTime;

      this._state.connectivity.status = response.ok ? 'online' : 'offline';
      this._state.connectivity.latency = latency;
      this._state.connectivity.error = null;

    } catch (error) {
      this._state.connectivity.status = 'offline';
      this._state.connectivity.error = error.message;
      this._state.connectivity.latency = null;
    }

    if (oldStatus !== this._state.connectivity.status) {
      this._notifyListeners({ connectivity: { status: oldStatus } }, this._state);
    }
  }

  /* ── Public API ─────────────────────────────────────────────────── */

  /**
   * Get current session state
   * @returns {Object} - Immutable snapshot of current state
   */
  get() {
    return { ...this._state };
  }

  /**
   * Update session state
   * @param {Object} patch - Partial state to update
   * @param {Object} options - Update options
   */
  update(patch, options = {}) {
    const oldState = { ...this._state };

    // Apply patch
    Object.assign(this._state, patch);
    this._state.lastUpdated = Date.now();

    // Save to history if requested
    if (options.saveToHistory) {
      this._pushToHistory();
    }

    // Persist to localStorage
    this._persist();

    // Notify listeners
    this._notifyListeners(oldState, this._state);

    // Update URL if requested
    if (options.updateURL) {
      this._updateURL();
    }
  }

  /**
   * Reset session to defaults
   * @param {Object} options - Reset options
   */
  reset(options = {}) {
    const oldState = { ...this._state };

    this._state = {
      ...DEFAULT_SESSION,
      serverUrl: deriveServerUrl(),
      lastUpdated: Date.now(),
      version: SESSION_VERSION
    };

    // Re-apply URL params if requested
    if (options.applyURLParams) {
      this._applyURLParameters();
    }

    this._persist();
    this._notifyListeners(oldState, this._state);
  }

  /**
   * Clear session (logout)
   */
  clear() {
    this.reset();
    localStorage.removeItem(STORAGE_KEY);
    this._history = [];
    this._historyIndex = -1;
  }

  /**
   * Subscribe to session changes
   * @param {Function} listener - Callback receiving (oldState, newState)
   * @returns {Function} - Unsubscribe function
   */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Get connectivity status
   * @returns {Object}
   */
  getConnectivity() {
    return { ...this._state.connectivity };
  }

  /**
   * Force connectivity check
   */
  async checkConnectivity() {
    await this._checkConnectivity();
  }

  /* ── History Management ─────────────────────────────────────────── */

  _pushToHistory() {
    // Truncate forward history if we're not at the end
    if (this._historyIndex < this._history.length - 1) {
      this._history = this._history.slice(0, this._historyIndex + 1);
    }

    this._history.push({ ...this._state });
    this._historyIndex++;

    // Limit history size
    if (this._history.length > 50) {
      this._history.shift();
      this._historyIndex--;
    }
  }

  /**
   * Undo last session change
   */
  undo() {
    if (this._historyIndex > 0) {
      this._historyIndex--;
      this._restoreFromHistory(this._history[this._historyIndex]);
    }
  }

  /**
   * Redo previously undone change
   */
  redo() {
    if (this._historyIndex < this._history.length - 1) {
      this._historyIndex++;
      this._restoreFromHistory(this._history[this._historyIndex]);
    }
  }

  _restoreFromHistory(historyState) {
    const oldState = { ...this._state };
    Object.assign(this._state, historyState);
    this._persist();
    this._notifyListeners(oldState, this._state);
  }

  /* ── URL Management ─────────────────────────────────────────────── */

  _updateURL() {
    const url = new URL(window.location);
    const params = new URLSearchParams();

    // Add non-default values to URL
    for (const [stateKey, value] of Object.entries(this._state)) {
      const urlParam = this._getURLParamForKey(stateKey);
      if (!urlParam) continue;

      const defaultValue = DEFAULT_SESSION[stateKey];

      // Skip default values
      if (JSON.stringify(value) === JSON.stringify(defaultValue)) {
        params.delete(urlParam);
      } else {
        params.set(urlParam, String(value));
      }
    }

    // Update URL without reloading
    const newURL = `${url.pathname}${params.toString() ? '?' + params.toString() : ''}${url.hash}`;
    window.history.replaceState({ session: this._state }, '', newURL);
  }

  _getURLParamForKey(stateKey) {
    return Object.entries(URL_PARAM_MAPPING).find(([_, key]) => key === stateKey)?.[0];
  }

  /* ── Persistence ────────────────────────────────────────────────── */

  _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._state));
    } catch (error) {
      console.warn('[Session] Failed to persist session:', error);
    }
  }

  _notifyListeners(oldState, newState) {
    this._listeners.forEach(listener => {
      try {
        listener(oldState, newState);
      } catch (error) {
        console.warn('[Session] Listener error:', error);
      }
    });
  }

  /* ── Cleanup ────────────────────────────────────────────────────── */

  destroy() {
    if (this._connectivityCheckInterval) {
      clearInterval(this._connectivityCheckInterval);
    }
    window.removeEventListener('storage', this._handleStorageChange);
    this._listeners.clear();
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   3. CREATE AND EXPORT SINGLETON
   ═══════════════════════════════════════════════════════════════════════ */

const sessionManager = new SessionManager();

// Export the session object (read-only)
export const session = sessionManager.get();

// Export update function
export function patchSession(patch, options = {}) {
  sessionManager.update(patch, options);
  // Update the exported session object
  Object.assign(session, sessionManager.get());
}

// Export utility functions
export function apiUrl(path) {
  const base = sessionManager.get().serverUrl;
  return base + (path.startsWith('/') ? path : '/' + path);
}

export function streamUrl(id) {
  return apiUrl(`/media/stream?id=${encodeURIComponent(id)}`);
}

export function thumbUrl(thumbnailPath) {
  if (!thumbnailPath) return null;
  if (thumbnailPath.startsWith('http')) return thumbnailPath;
  return apiUrl(thumbnailPath);
}

// Export additional utilities
export function getSession() {
  return sessionManager.get();
}

export function subscribeToSession(listener) {
  return sessionManager.subscribe(listener);
}

export function checkConnectivity() {
  return sessionManager.checkConnectivity();
}

export function getConnectivityStatus() {
  return sessionManager.getConnectivity();
}

export function undoSession() {
  sessionManager.undo();
  Object.assign(session, sessionManager.get());
}

export function redoSession() {
  sessionManager.redo();
  Object.assign(session, sessionManager.get());
}

export function resetSession(options = {}) {
  sessionManager.reset(options);
  Object.assign(session, sessionManager.get());
}

export function clearSession() {
  sessionManager.clear();
  Object.assign(session, sessionManager.get());
}

/* ═══════════════════════════════════════════════════════════════════════
   4. URL SHARE GENERATION
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Generate a shareable URL for current session
 * @param {Object} options - Share options
 * @returns {string}
 */
export function getShareableURL(options = {}) {
  const baseUrl = window.location.origin + window.location.pathname;
  const params = new URLSearchParams();

  const state = sessionManager.get();

  // Always include essential params
  if (state.id) params.set('id', state.id);
  if (state.startTime > 0 && options.includeTime !== false) {
    params.set('t', Math.floor(state.startTime));
  }

  // Optional params
  if (options.includeMode && state.mode !== '2d') {
    params.set('mode', state.mode);
  }

  if (options.includeStereo && state.stereo !== 'none') {
    params.set('stereo', state.stereo);
  }

  return `${baseUrl}${params.toString() ? '?' + params.toString() : ''}`;
}

/**
 * Parse a shareable URL and extract session data
 * @param {string} url - Shareable URL
 * @returns {Object}
 */
export function parseShareableURL(url) {
  const urlObj = new URL(url);
  const params = urlObj.searchParams;

  const sessionData = {};

  for (const [key, value] of params.entries()) {
    const stateKey = URL_PARAM_MAPPING[key];
    if (stateKey) {
      sessionData[stateKey] = PARAM_TRANSFORMERS[stateKey]?.(value) || value;
    }
  }

  return sessionData;
}

/* ═══════════════════════════════════════════════════════════════════════
   5. SESSION VALIDATION
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Validate session data
 * @param {Object} sessionData - Session data to validate
 * @returns {Object} - Validation result
 */
export function validateSession(sessionData) {
  const errors = [];
  const warnings = [];

  // Required fields
  if (sessionData.id && !/^[a-zA-Z0-9_-]+$/.test(sessionData.id)) {
    errors.push('Invalid ID format');
  }

  // Mode validation
  if (sessionData.mode && !['2d', '180', '360'].includes(sessionData.mode)) {
    errors.push('Invalid mode');
  }

  // Stereo validation
  if (sessionData.stereo && !['none', 'sbs', 'tb'].includes(sessionData.stereo)) {
    errors.push('Invalid stereo format');
  }

  // Time validation
  if (sessionData.startTime && (sessionData.startTime < 0 || sessionData.startTime > sessionData.duration)) {
    warnings.push('Start time out of range');
  }

  // Volume validation
  if (sessionData.volume && (sessionData.volume < 0 || sessionData.volume > 1)) {
    errors.push('Volume out of range');
  }

  // Playback rate validation
  if (sessionData.playbackRate && (sessionData.playbackRate < 0.5 || sessionData.playbackRate > 2)) {
    errors.push('Playback rate out of range');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// Export version info
export const VERSION = SESSION_VERSION;