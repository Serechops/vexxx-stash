/**
 * control-panel.js - In-scene VR theatre control panel.
 *
 * Extracted from app.js. Contains:
 *   FORMAT_CYCLE  - ordered list of video format presets
 *   ControlPanel  - Babylon.js GUI overlay: transport, progress bar,
 *                   sprite-sheet scrub preview, Handy device integration,
 *                   format cycling, passthrough toggle, auto-hide.
 *
 * All app-level globals previously captured via closure are now injected
 * through the `opts` constructor parameter:
 *
 *   opts.dbg            - debug logger fn
 *   opts.appState       - AppState instance
 *   opts.camera         - default non-XR UniversalCamera
 *   opts.videoDisplay   - VideoDisplay instance (video-display.js)
 *   opts.skybox         - lobby skybox mesh (passthrough toggle)
 *   opts.ground         - lobby ground mesh  (passthrough toggle)
 *   opts.getXrHelper    - () => xrHelper
 *   opts.onExitPlaying  - () => void
 *   opts.onSwitchFormat - (mode, stereo) => void
 */

import { CONFIG } from './config.js';
import { apiUrl } from './session.js';
// Format presets
export const FORMAT_CYCLE = [
  { mode: '180', stereo: 'sbs', label: '180° LR' },
  { mode: '180', stereo: 'tb', label: '180° OU' },
  { mode: '180', stereo: 'none', label: '180° Mono' },
  { mode: '360', stereo: 'sbs', label: '360° LR' },
  { mode: '360', stereo: 'tb', label: '360° OU' },
  { mode: '360', stereo: 'none', label: '360° Mono' },
  { mode: '2d', stereo: 'none', label: 'Flat 2D' },
];

// Environment presets
export const ENV_CYCLE = [
  { mode: 'cinema', label: 'Env: Cinema' },
  { mode: 'void', label: 'Env: Void' },
  { mode: 'passthrough', label: 'Env: PT' }, // Passthrough
  { mode: 'theater', label: 'Env: Theater' },
];

export class ControlPanel {
  constructor(scene, videoController, opts = {}) {
    this.scene = scene;
    this.vc = videoController;
    // Injected dependencies (moved from module-level closure)
    this._dbg = opts.dbg || (() => { });
    this._appState = opts.appState || { current: 'init' };
    this._camera = opts.camera || null;
    this._display = opts.videoDisplay || null;
    this._skybox = opts.skybox || null;
    this._ground = opts.ground || null;
    this._getXrHelper = opts.getXrHelper || (() => null);
    this._onExitPlaying = opts.onExitPlaying || (() => { });
    this._onSwitchFormat = opts.onSwitchFormat || (() => { });
    this._onBrowseLibrary = opts.onBrowseLibrary || null;
    this._onSnapTurnToggle = opts.onSnapTurnToggle || null;
    this._onVignetteToggle = opts.onVignetteToggle || null;
    this._getVideoFeatures = opts.getVideoFeatures || (() => null);

    // WebXR anchors
    this._anchorSystem = null;
    this._currentAnchor = null;
    this._rootNode = new BABYLON.TransformNode('cpRoot', this.scene);

    this.performerMesh = null;
    this.performerTexture = null;
    this.mesh = null;
    this.miniMesh = null;
    this.texture = null;
    this.miniTexture = null;
    this.progMesh = null;
    this.progTexture = null;

    this.isMinimized = false;
    this.isVisible = false;
    this.currentFormatIdx = 0;
    this.currentZoom = 0.5;
    this.currentDepth = 1.0;
    this.currentSpeed = 1.0;
    this.currentEnvIdx = 0; // 0 = cinema
    this.handyConnected = false;
    this.scriptActive = false;
    this.hasScript = false;
    this._scriptMediaId = null;
    this._handyServerTimeOffset = 0;
    this._handyOnSeeked = null;
    this._handyOnPause = null;
    this._handyOnPlaying = null;
    this._showRemaining = false; // toggle: elapsed/total vs -remaining

    // Snap-turn
    this._snapTurnEnabled = opts.isSnapTurnEnabled ?? CONFIG.VR.SNAP_TURN_ENABLED;

    // Comfort vignette
    this._vignetteEnabled = false;

    // Sleep timer
    this._sleepStepIdx = 0;       // 0 = off, 1..n = CONFIG.VIDEO.SLEEP_TIMER_STEPS index
    this._sleepSecondsRemaining = 0;
    this._sleepCountdownInterval = null;

    // Auto-hide
    this._autoHideTimer = null;
    this._autoHideDelay = CONFIG.UI.AUTOHIDE_DELAY;
    this._autoHidden = false;
    this._isPointerOver = false;

    // UI elements
    this.progressFill = null;
    this.playhead = null;
    this.timeTxt = null;
    this.playBtn = null;
    this.fmtBtn = null;
    this.muteBtn = null;
    this.speedBtn = null;
    this.formatBtn = null;
    this.handyBtn = null;
    this.scriptBtn = null;
    this.snapTurnBtn = null;
    this.vignetteBtn = null;
    this.sleepBtn = null;
    this.bkmAddBtn = null;
    this.bkmNextBtn = null;
    this.browseBtn = null;
    this.chapterRow = null;
    this.scrubHit = null;
    this.hoverDot = null;
    this.previewContainer = null;
    this.previewImg = null;
    this.previewTimeTxt = null;
    this.timelinePreviewUrl = null;
    this._lastHoverRelX = null;    // tracks pointer position for re-trigger on image load
    this._cellW = 0;
    this._cellH = 0;

    this.init();
  }

  init() {
    this.buildFullPanel();
    this.buildProgressBar();
    this.buildPerformerPanel();
    this.buildMiniPanel();
    this.setupDragBehavior();
    this.setupVideoEvents();
    this.loadHandyKey();
  }

  /* ── Compact control panel (transport + settings) ─────────── */
  buildFullPanel() {
    this.mesh = BABYLON.MeshBuilder.CreatePlane('controls',
      { width: 2.4, height: 0.58 }, this.scene);
    this.mesh.position = new BABYLON.Vector3(0, 0.6, 2.5);
    this.mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
    this.mesh.isVisible = false;
    this.mesh.isPickable = true;

    this.texture = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(this.mesh, 960, 230);
    this.texture.useInvalidateRectOptimization = true;
    this.mesh.actionManager = new BABYLON.ActionManager(this.scene);
    this.mesh.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, () => { this._isPointerOver = true; this.resetAutoHide(); }));
    this.mesh.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOutTrigger, () => { this._isPointerOver = false; this.resetAutoHide(); }));

    const bg = new BABYLON.GUI.Rectangle('ctlBg');
    bg.width = '100%'; bg.height = '132px';
    bg.cornerRadius = 20;
    bg.color = 'rgba(79, 142, 255, 0.18)';
    bg.background = 'rgba(4, 4, 11, 0.97)';
    bg.thickness = 1;
    bg.shadowColor = 'rgba(0, 0, 0, 0.55)';
    bg.shadowBlur = 14;
    bg.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
    bg.useBitmapCache = true;
    this.texture.addControl(bg);
    this.mesh.parent = this._rootNode;

    const mainCol = new BABYLON.GUI.StackPanel('mainCol');
    mainCol.isVertical = true;
    mainCol.width = '98%';
    mainCol.height = '100%';
    mainCol.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    bg.addControl(mainCol);

    this._addSpacer(mainCol, 4);

    // Row 1: Transport
    const row1 = new BABYLON.GUI.StackPanel('r1');
    row1.isVertical = false;
    row1.height = '58px';
    row1.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    mainCol.addControl(row1);

    this._btn(row1, 'btnBack', '←', '46px', '48px', () => this._onExitPlaying(), 'Back to Library');
    this._btn(row1, 'btnRew', '−10s', '62px', '48px', () => this.vc.seekDelta(-CONFIG.VIDEO.SEEK_STEP), 'Rewind 10s');
    this.playBtn = this._btn(row1, 'btnPlay', '▶', '52px', '48px', () => this._handlePlayClick(), 'Play / Pause');
    this._btn(row1, 'btnFwd', '+10s', '62px', '48px', () => this.vc.seekDelta(CONFIG.VIDEO.SEEK_STEP), 'Skip Forward 10s');
    this.muteBtn = this._btn(row1, 'btnMute', '🔊', '42px', '48px', () => { this.vc.toggleMute(); this.updateMuteButton(); this._updateVolBar(); }, 'Mute / Unmute');

    /* Volume slider — mini horizontal bar, click/drag to set 0-1 */
    this._volWrap = new BABYLON.GUI.Rectangle('volWrap');
    this._volWrap.width = '80px'; this._volWrap.height = '48px';
    this._volWrap.color = 'transparent'; this._volWrap.thickness = 0;
    this._volWrap.paddingLeft = '2px'; this._volWrap.paddingRight = '2px';
    this._volWrap.isPointerBlocker = true;
    row1.addControl(this._volWrap);

    const volTrack = new BABYLON.GUI.Rectangle('volTrack');
    volTrack.width = '64px'; volTrack.height = '8px'; volTrack.cornerRadius = 4;
    volTrack.background = 'rgba(255,255,255,0.10)';
    volTrack.color = 'transparent'; volTrack.thickness = 0;
    this._volWrap.addControl(volTrack);

    this._volFill = new BABYLON.GUI.Rectangle('volFill');
    this._volFill.height = '100%'; this._volFill.cornerRadius = 4;
    this._volFill.background = 'rgba(79, 142, 255, 0.85)';
    this._volFill.color = 'transparent'; this._volFill.thickness = 0;
    this._volFill.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    volTrack.addControl(this._volFill);

    this._volPct = new BABYLON.GUI.TextBlock('volPct', '');
    this._volPct.color = 'rgba(255,255,255,0.45)'; this._volPct.fontSize = 9;
    this._volPct.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    this._volPct.top = '12px';
    this._volWrap.addControl(this._volPct);

    this._volTrackW = 64;  // px width of track for click mapping
    this._updateVolBar();

    /* Click anywhere on volWrap → set volume proportionally */
    this._volWrap.onPointerDownObservable.add((pi) => {
      const local = pi.localPosition;
      if (local) {
        const frac = Math.max(0, Math.min(1, (local.x + 0.5)));
        this.vc.setVolume(frac);
        if (this.vc.muted && frac > 0) { this.vc.setMuted(false); this.updateMuteButton(); }
        this._updateVolBar();
        if (window.triggerHaptic) window.triggerHaptic(0.5, 15);
      }
    });

    this.fmtBtn = this._btn(row1, 'btnFmt', FORMAT_CYCLE[this.currentFormatIdx].label, '110px', '48px', () => this.cycleFormat(), 'Video Format');
    this.speedBtn = this._btn(row1, 'btnSpd', '1.0x', '58px', '48px', () => this.cycleSpeed(), 'Playback Speed');

    this._addSpacer(mainCol, 3);

    // Row 2: Performer Photos (Floating above main panel)
    this.performerRow = new BABYLON.GUI.StackPanel('performers');
    this.performerRow.isVertical = false;
    this.performerRow.height = '90px';
    this.performerRow.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.performerRow.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    this.performerRow.left = '20px';
    this.performerRow.top = '4px';
    this.performerRow.isVisible = false;
    this.texture.addControl(this.performerRow);

    // Tooltip for performer names
    this._pTooltip = new BABYLON.GUI.Rectangle('pTooltip');
    this._pTooltip.height = '32px';
    this._pTooltip.adaptWidthToChildren = true;
    this._pTooltip.cornerRadius = 8;
    this._pTooltip.background = 'rgba(0,0,0,0.85)';
    this._pTooltip.color = 'rgba(138,180,248,0.6)';
    this._pTooltip.thickness = 1;
    this._pTooltip.isVisible = false;
    this._pTooltip.isPointerBlocker = false;
    this.texture.addControl(this._pTooltip);

    this._pTooltipTxt = new BABYLON.GUI.TextBlock('pTooltipTxt', '');
    this._pTooltipTxt.color = '#fff';
    this._pTooltipTxt.fontSize = 15;
    this._pTooltipTxt.fontFamily = 'Inter, -apple-system, sans-serif';
    this._pTooltipTxt.paddingLeft = '12px';
    this._pTooltipTxt.paddingRight = '12px';
    this._pTooltipTxt.resizeToFit = true;
    this._pTooltip.addControl(this._pTooltipTxt);

    this._addSpacer(mainCol, 3);

    // Row 3: Utility
    const row3 = new BABYLON.GUI.StackPanel('r3');
    row3.isVertical = false;
    row3.height = '52px';
    row3.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    mainCol.addControl(row3);

    // 🔍− = zoom out (fov wider = content appears farther), 🔍+ = zoom in (closer)
    this._btn(row3, 'btnZO', '🔍−', '50px', '42px', () => this.adjustZoom(0.15), 'Zoom Out');
    this._btn(row3, 'btnZI', '🔍+', '50px', '42px', () => this.adjustZoom(-0.15), 'Zoom In');
    this.handyBtn = this._btn(row3, 'btnHandy', '🔌 Off', '78px', '42px', () => this.toggleHandy(), 'Handy Device');
    this.scriptBtn = this._btn(row3, 'btnScript', '🎮 —', '70px', '42px', () => this.toggleScript(), 'Script Sync');
    this.snapTurnBtn = this._btn(row3, 'btnSnap', this._snapTurnEnabled ? '↪ On' : '↪ Off', '60px', '42px', () => this._handleSnapTurnClick(), 'Snap Turn');
    if (this._snapTurnEnabled) {
      this.snapTurnBtn.background = 'rgba(79,142,255,0.20)';
      this.snapTurnBtn.color = 'rgba(79,142,255,0.50)';
      if (this.snapTurnBtn._label) this.snapTurnBtn._label.color = '#8ab4f8';
    }
    this.vignetteBtn = this._btn(row3, 'btnVig', '👁 Off', '60px', '42px', () => this.toggleVignette(), 'Comfort Vignette');
    this.sleepBtn = this._btn(row3, 'btnSleep', '💤 Off', '76px', '42px', () => this.cycleSleepTimer(), 'Sleep Timer');
    this.bkmAddBtn = this._btn(row3, 'btnBkmAdd', '🔖+', '52px', '42px', () => this.addBookmark(), 'Add Bookmark');
    this.bkmNextBtn = this._btn(row3, 'btnBkmNext', '🔖►', '54px', '42px', () => this.nextBookmark(), 'Next Bookmark');
    this.browseBtn = this._btn(row3, 'btnBrowse', '📚 Browse', '88px', '42px', () => this._handleBrowseClick(), 'Browse Library');
    this._btn(row3, 'btnExit', 'Exit', '52px', '42px', () => this.exitVR(), 'Exit VR');
    this._btn(row3, 'btnRC', '◎', '42px', '42px', () => { this.positionForCamera(); this._display.recenter(); }, 'Recenter Screen');
    this._btn(row3, 'btnMin', '▾', '40px', '42px', () => this.setMinimized(true), 'Minimize Controls');

    this._addSpacer(mainCol, 3);

    // Shared tooltip for all buttons — added LAST so it renders above everything
    this._btnTooltip = new BABYLON.GUI.Rectangle('btnTip');
    this._btnTooltip.heightInPixels = 28;
    this._btnTooltip.adaptWidthToChildren = true;
    this._btnTooltip.cornerRadius = 6;
    this._btnTooltip.background = 'rgba(4,4,11,0.95)';
    this._btnTooltip.color = 'rgba(79,142,255,0.40)';
    this._btnTooltip.thickness = 1;
    this._btnTooltip.isVisible = false;
    this._btnTooltip.zIndex = 999;
    // Sit between the two button rows (inside the panel background).
    // The panel bg is 132px tall, VERTICAL_ALIGNMENT_BOTTOM inside a 230px
    // texture, so the bg top edge sits at y≈98px. Row1 (58px) ends at ≈160px
    // and Row3 (52px) starts at ≈163px — anchor there.
    this._btnTooltip.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    this._btnTooltip.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    this._btnTooltip.top = '155px';
    this.texture.addControl(this._btnTooltip);

    this._btnTooltipTxt = new BABYLON.GUI.TextBlock('btnTipTxt', '');
    this._btnTooltipTxt.color = '#e8eaed';
    this._btnTooltipTxt.fontSize = 13;
    this._btnTooltipTxt.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    this._btnTooltipTxt.paddingLeft = '10px';
    this._btnTooltipTxt.paddingRight = '10px';
    this._btnTooltipTxt.resizeToFit = true;
    this._btnTooltip.addControl(this._btnTooltipTxt);
  }

  /* ── Separate interactive progress bar mesh ───────────────── */
  buildProgressBar() {
    const TEX_W = 960, TEX_H = 312;
    // Track uses 96% of texture width, centred — matches the main panel's layout.
    const TRACK_W = Math.round(TEX_W * 0.96);  // 922px
    // TRACK_TOP: offset from texture center (y=156) for the scrub track row.
    const TRACK_TOP = 60;
    const PLAYHEAD_R = 10; // half-width of playhead dot (20px / 2)
    const HOVER_R = 7;     // half-width of hover dot  (14px / 2)

    this.progMesh = BABYLON.MeshBuilder.CreatePlane('progBar',
      { width: 2.4, height: 0.75 }, this.scene);
    this.progMesh.position = new BABYLON.Vector3(0, 0.6 - 0.54, 2.5);
    this.progMesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
    this.progMesh.isVisible = false;
    this.progMesh.isPickable = true;

    this.progTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(this.progMesh, TEX_W, TEX_H);
    this.progTexture.useInvalidateRectOptimization = true;
    this.progMesh.parent = this._rootNode;
    this.progMesh.actionManager = new BABYLON.ActionManager(this.scene);
    this.progMesh.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, () => { this._isPointerOver = true; this.resetAutoHide(); }));
    this.progMesh.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOutTrigger, () => { this._isPointerOver = false; this.resetAutoHide(); }));

    // Fully transparent panel — only the track elements render.
    const pbg = new BABYLON.GUI.Rectangle('pbg');
    pbg.width = '100%'; pbg.height = '100%';
    pbg.cornerRadius = 0;
    pbg.color = 'transparent';
    pbg.background = 'transparent';
    pbg.thickness = 0;
    this.progTexture.addControl(pbg);

    /* -- TOP ROW: full-width scrub track + time text (absolute pos) -- */
    // Background track (absolute positioned from left edge)
    const track = new BABYLON.GUI.Rectangle('track');
    track.widthInPixels = TRACK_W;
    track.height = '18px';
    track.cornerRadius = 9;
    track.color = 'transparent';
    track.background = 'rgba(255,255,255,0.10)';
    track.thickness = 0;
    track.topInPixels = TRACK_TOP;
    track.isPointerBlocker = false;
    // Centred horizontally (no leftInPixels needed)
    track.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    pbg.addControl(track);

    // Progress fill
    this.progressFill = new BABYLON.GUI.Rectangle('pFill');
    this.progressFill.width = '0%';
    this.progressFill.height = '100%';
    this.progressFill.cornerRadius = 9;
    this.progressFill.color = 'transparent';
    this.progressFill.background = 'rgba(79, 142, 255, 0.92)';
    this.progressFill.thickness = 0;
    this.progressFill.isPointerBlocker = false;
    this.progressFill.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    track.addControl(this.progressFill);

    // Playhead dot — current playback position
    this.playhead = new BABYLON.GUI.Ellipse('playhead');
    this.playhead.widthInPixels = 20;
    this.playhead.heightInPixels = 20;
    this.playhead.color = '#ffffff';
    this.playhead.background = '#8ab4f8';
    this.playhead.thickness = 2;
    this.playhead.shadowColor = 'rgba(138,180,248,0.7)';
    this.playhead.shadowBlur = 8;
    this.playhead.leftInPixels = -TRACK_W / 2;  // starts at left edge of track
    this.playhead.topInPixels = TRACK_TOP;
    this.playhead.isPointerBlocker = false;
    this.playhead.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    pbg.addControl(this.playhead);

    // Hover dot — pointer position indicator, visible only on hover
    this.hoverDot = new BABYLON.GUI.Ellipse('hoverDot');
    this.hoverDot.widthInPixels = 14;
    this.hoverDot.heightInPixels = 14;
    this.hoverDot.color = 'rgba(255,255,255,0.95)';
    this.hoverDot.background = 'rgba(255,255,255,0.22)';
    this.hoverDot.thickness = 2;
    this.hoverDot.leftInPixels = -TRACK_W / 2;  // starts at left edge of track
    this.hoverDot.topInPixels = TRACK_TOP;
    this.hoverDot.isPointerBlocker = false;
    this.hoverDot.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    this.hoverDot.isVisible = false;
    pbg.addControl(this.hoverDot);

    // Time text — pill placed BELOW the track row
    const timeBg = new BABYLON.GUI.Rectangle('timeBg');
    timeBg.widthInPixels = 180;
    timeBg.heightInPixels = 22;
    timeBg.cornerRadius = 6;
    timeBg.background = 'rgba(0,0,0,0.50)';
    timeBg.color = 'transparent';
    timeBg.thickness = 0;
    timeBg.topInPixels = TRACK_TOP + 42;  // below track + heatmap/chapters
    // Centred horizontally (default alignment)
    timeBg.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    pbg.addControl(timeBg);

    this.timeTxt = new BABYLON.GUI.TextBlock('tTxt', '0:00 / 0:00');
    this.timeTxt.color = '#8ab4f8';
    this.timeTxt.fontSize = 15;
    this.timeTxt.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    this.timeTxt.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    timeBg.addControl(this.timeTxt);

    // Click time pill to toggle elapsed / remaining display
    timeBg.isPointerBlocker = true;
    timeBg.onPointerClickObservable.add(() => {
      this._showRemaining = !this._showRemaining;
    });

    /* -- BOTTOM ROW: heatmap + chapters -- */
    // Heatmap strip
    this.heatmapContainer = new BABYLON.GUI.Rectangle('heatC');
    this.heatmapContainer.widthInPixels = TRACK_W;
    this.heatmapContainer.height = '12px';
    this.heatmapContainer.cornerRadius = 4;
    this.heatmapContainer.color = 'transparent';
    this.heatmapContainer.background = 'rgba(255,255,255,0.04)';
    this.heatmapContainer.thickness = 0;
    this.heatmapContainer.topInPixels = TRACK_TOP + 14;
    // Centred horizontally (no leftInPixels needed)
    this.heatmapContainer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    this.heatmapContainer.isVisible = false;
    this.heatmapContainer.isPointerBlocker = false;
    pbg.addControl(this.heatmapContainer);

    // Chapter row - overlays both track AND progress fill so chapter segments are visible
    this.chapterRow = new BABYLON.GUI.Rectangle('chapRow');
    this.chapterRow.widthInPixels = TRACK_W;
    this.chapterRow.height = '18px';
    this.chapterRow.color = 'transparent';
    this.chapterRow.background = 'transparent';
    this.chapterRow.thickness = 0;
    this.chapterRow.topInPixels = TRACK_TOP;
    // Centred horizontally (no leftInPixels needed)
    this.chapterRow.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    this.chapterRow.isVisible = false;
    this.chapterRow.isPointerBlocker = false; // Let scrubHit receive pointer events
    pbg.addControl(this.chapterRow);

    // ── Invisible scrub hit zone — MUST be added AFTER chapterRow & heatmap
    // so it sits on top in Babylon GUI's z-order and always receives pointer
    // events, even when chapter segments are rendered over the track. ──
    const scrubHit = new BABYLON.GUI.Rectangle('scrubHit');
    scrubHit.widthInPixels = TRACK_W + 20;
    scrubHit.height = '60px';
    scrubHit.topInPixels = TRACK_TOP;
    // Centred horizontally (no leftInPixels needed)
    scrubHit.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    scrubHit.color = 'transparent';
    scrubHit.background = 'rgba(0,0,0,0.01)'; // 1% opacity forces reliable hit detection
    scrubHit.thickness = 0;
    scrubHit.isPointerBlocker = true;
    pbg.addControl(scrubHit);
    this.scrubHit = scrubHit;

    // Store track dims for scrub calc
    this._trackWidth = TRACK_W;
    this._texW = TEX_W;
    this._playheadR = PLAYHEAD_R;
    this._hoverR = HOVER_R;
    // Track left edge in texture coordinates (for scrub hit-test mapping)
    this._trackLeft = (TEX_W - TRACK_W) / 2;

    let scrubbing = false;
    let scrubTimer = null;

    // Update the visual playhead & fill immediately from a [0..1] ratio.
    // Called on every pointer-move for instant feedback.
    const applyVisual = (relX) => {
      const pct = relX * 100;
      const cur = relX * this.vc.duration;
      if (this.progressFill) this.progressFill.width = pct + '%';
      if (this.playhead && this._trackWidth) {
        // Center-aligned: offset from centre.  At relX=0 → left edge, relX=1 → right edge
        this.playhead.leftInPixels = (relX - 0.5) * this._trackWidth;
      }
      this._updateChapterProgress(cur);
    };

    // During drag: set currentTime directly (no promise, no timeout race).
    // Debounced to ~80 ms so we don't spam seeks on every pointer-move event.
    const doScrubDrag = (localX) => {
      if (!this.vc || !this.vc.duration || !isFinite(this.vc.duration)) return;
      this.resetAutoHide();
      const relX = Math.max(0, Math.min(1, (localX - this._trackLeft) / this._trackWidth));
      applyVisual(relX);                        // instant visual update

      // Haptic tick during drag (throttle by percentage change to avoid continuous buzz)
      const tickPct = Math.floor(relX * 100 / 2); // tick every 2 percent
      if (this._lastHapticTick !== tickPct) {
        if (window.triggerHaptic) window.triggerHaptic(1.0, 5); // Short, sharp tick
        this._lastHapticTick = tickPct;
      }

      clearTimeout(scrubTimer);
      scrubTimer = setTimeout(() => {
        const target = relX * this.vc.duration;
        this.vc._el.currentTime = Math.max(0, Math.min(this.vc.duration, target));
      }, 80);
    };

    const doScrubEnd = (localX) => {
      clearTimeout(scrubTimer);
      if (!this.vc || !this.vc.duration || !isFinite(this.vc.duration)) return;
      const relX = Math.max(0, Math.min(1, (localX - this._trackLeft) / this._trackWidth));
      applyVisual(relX);
      this.vc.seek(relX * this.vc.duration).catch(() => { });
      if (window.triggerHaptic) window.triggerHaptic(1.0, 5); // Notched tick on jump
    };

    scrubHit.onPointerDownObservable.add((evtData) => {
      scrubbing = true;
      if (evtData && typeof evtData.x === 'number') doScrubDrag(evtData.x);
    });
    scrubHit.onPointerMoveObservable.add((evtData) => {
      if (evtData && typeof evtData.x === 'number') {
        // Cancel any pending hide — pointer is still over the timeline
        clearTimeout(this._previewHideTimer);
        const relX = Math.max(0, Math.min(1, (evtData.x - this._trackLeft) / this._trackWidth));
        this._lastHoverRelX = relX;
        // Move hover dot to pointer position (centre-aligned)
        if (this.hoverDot) {
          this.hoverDot.leftInPixels = (relX - 0.5) * this._trackWidth;
          this.hoverDot.isVisible = true;
        }
        this.updateScrubPreview(relX);
        if (scrubbing) doScrubDrag(evtData.x);
      }
    });
    scrubHit.onPointerUpObservable.add((evtData) => {
      if (scrubbing) {
        if (evtData && typeof evtData.x === 'number') doScrubEnd(evtData.x);
        scrubbing = false;
      }
      if (this.previewContainer) this.previewContainer.isVisible = false;
      if (this.hoverDot) this.hoverDot.isVisible = false;
    });
    scrubHit.onPointerOutObservable.add(() => {
      scrubbing = false;
      clearTimeout(scrubTimer);
      this._lastHoverRelX = null;
      // Debounce the hide in VR: the Quest controller ray briefly exits the
      // hit zone even when still aimed at the timeline, causing rapid
      // show/hide flicker. A short delay lets the next onPointerMove cancel
      // the timer before the preview actually disappears.
      clearTimeout(this._previewHideTimer);
      this._previewHideTimer = setTimeout(() => {
        if (this.previewContainer) this.previewContainer.isVisible = false;
        if (this.hoverDot) this.hoverDot.isVisible = false;
      }, 160);
    });
    // Safety: cancel scrub if pointer leaves the texture
    // Reusing the ActionManager defined at the top of buildProgressBar
    this.progTexture.onPointerOutObservable?.add(() => {
      scrubbing = false;
      clearTimeout(scrubTimer);
      clearTimeout(this._previewHideTimer);
      this._previewHideTimer = setTimeout(() => {
        if (this.previewContainer) this.previewContainer.isVisible = false;
      }, 160);
    });

    /* -- Scrub Preview Thumbnail (floats above track in top zone) -- */
    // Container: 320×180px (16:9) centred at texture y=90.
    // topInPixels = 90 - 156 = -66.
    this.previewContainer = new BABYLON.GUI.Rectangle('previewC');
    this.previewContainer.widthInPixels = 320;
    this.previewContainer.heightInPixels = 180;
    this.previewContainer.cornerRadius = 8;
    this.previewContainer.background = 'rgba(0,0,0,0.85)';
    this.previewContainer.color = 'rgba(255,255,255,0.12)';
    this.previewContainer.thickness = 1;
    this.previewContainer.isVisible = false;
    this.previewContainer.topInPixels = -62;
    this.previewContainer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    // Centred horizontally (default) — position set dynamically in updateScrubPreview
    pbg.addControl(this.previewContainer);

    this.previewImg = new BABYLON.GUI.Image('previewImg', '');
    this.previewImg.width = '100%';
    this.previewImg.height = '100%';
    // STRETCH_FILL: fill the container exactly — cellId cropping handles aspect ratio
    // STRETCH_UNIFORM would add letterbox padding that fights cellId rendering
    this.previewImg.stretch = BABYLON.GUI.Image.STRETCH_FILL;
    this._spriteImgReady = false;
    this.previewImg.onImageLoadedObservable.add(() => {
      this._spriteImgReady = true;
      this._dbg('[scrubPreview] sprite sheet image loaded, ready for cellId');
      // Re-trigger preview if the pointer is still hovering over the track.
      // cellId set before image load is silently ignored by Babylon GUI, so
      // we must re-apply it once the image is actually ready.
      if (this._lastHoverRelX !== null) {
        this.updateScrubPreview(this._lastHoverRelX);
      }
    });
    this.previewContainer.addControl(this.previewImg);

    this.previewTimeTxt = new BABYLON.GUI.TextBlock('pvTime', '0:00');
    this.previewTimeTxt.color = '#fff';
    this.previewTimeTxt.fontSize = 12;
    this.previewTimeTxt.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.previewTimeTxt.top = '-4px';
    this.previewContainer.addControl(this.previewTimeTxt);
  }

  buildMiniPanel() {
    this.miniMesh = BABYLON.MeshBuilder.CreatePlane('miniCtl',
      { width: 0.5, height: 0.2 }, this.scene);
    this.miniMesh.position = new BABYLON.Vector3(0, 0.6, 2.5);
    this.miniMesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
    this.miniMesh.isVisible = false;
    this.miniMesh.isPickable = true;

    this.miniTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(this.miniMesh, 200, 80);
    this.miniTexture.useInvalidateRectOptimization = true;
    this.miniMesh.actionManager = new BABYLON.ActionManager(this.scene);
    this.miniMesh.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, () => { this._isPointerOver = true; this.resetAutoHide(); }));
    this.miniMesh.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOutTrigger, () => { this._isPointerOver = false; this.resetAutoHide(); }));

    const miniBg = new BABYLON.GUI.Rectangle('miniBg');
    miniBg.width = '100%'; miniBg.height = '100%';
    miniBg.cornerRadius = 16;
    miniBg.color = 'rgba(79, 142, 255, 0.18)';
    miniBg.background = 'rgba(4, 4, 11, 0.97)';
    miniBg.thickness = 1;
    this.miniTexture.addControl(miniBg);
    this.miniMesh.parent = this._rootNode;

    const miniTxt = new BABYLON.GUI.TextBlock('miniTxt', '▴ Controls');
    miniTxt.color = '#8ab4f8';
    miniTxt.fontSize = 24;
    miniTxt.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    miniBg.addControl(miniTxt);

    miniBg.onPointerEnterObservable.add(() => {
      miniBg.background = 'rgba(79, 142, 255, 0.22)';
      miniTxt.color = '#ffffff';
    });

    miniBg.onPointerOutObservable.add(() => {
      miniBg.background = 'rgba(4, 4, 11, 0.97)';
      miniTxt.color = '#8ab4f8';
    });

    miniBg.onPointerClickObservable.add(() => this.setMinimized(false));
  }

  buildPerformerPanel() {
    this.performerMesh = BABYLON.MeshBuilder.CreatePlane('perfPanel',
      { width: 0.65, height: 0.7 }, this.scene);
    this.performerMesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
    this.performerMesh.isVisible = false;
    this.performerMesh.isPickable = true;
    this.performerMesh.parent = this._rootNode;

    this.performerTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(this.performerMesh, 800, 800);
    this.performerTexture.useInvalidateRectOptimization = true;

    const bg = new BABYLON.GUI.Rectangle('perfBg');
    bg.width = '100%'; bg.height = '100%';
    bg.cornerRadius = 28;
    bg.color = 'rgba(79, 142, 255, 0.18)';
    bg.background = 'rgba(4, 4, 11, 0.97)';
    bg.thickness = 1;
    this.performerTexture.addControl(bg);

    const header = new BABYLON.GUI.Rectangle('perfHeader');
    header.height = '80px'; header.width = '100%';
    header.thickness = 0;
    header.background = 'rgba(255, 255, 255, 0.03)';
    header.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    bg.addControl(header);

    const headerTxt = new BABYLON.GUI.TextBlock('perfHTxt', 'PERFORMERS');
    headerTxt.color = 'rgba(138,180,248,0.9)';
    headerTxt.fontSize = 24; headerTxt.fontWeight = 'bold';
    headerTxt.fontFamily = 'Inter, -apple-system, sans-serif';
    headerTxt.letterSpacing = '4px';
    header.addControl(headerTxt);

    this.performerSV = new BABYLON.GUI.ScrollViewer('perfScroll');
    this.performerSV.width = '100%'; this.performerSV.height = '720px';
    this.performerSV.top = '80px';
    this.performerSV.thickness = 0; this.performerSV.color = 'transparent';
    this.performerSV.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    this.performerSV.horizontalBarImageHeight = '0%';
    this.performerSV.verticalBarImageWidth = '6px';
    this.performerSV.barColor = 'rgba(138,180,248,0.3)';
    bg.addControl(this.performerSV);

    this.performerRow = new BABYLON.GUI.StackPanel('performers');
    this.performerRow.isVertical = true;
    this.performerRow.width = '100%';
    this.performerRow.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.performerSV.addControl(this.performerRow);
  }

  /* ── Compact button factory ──────────────────────────────── */
  _btn(parent, name, label, width, height, onClick, tooltip = '') {
    const wrap = new BABYLON.GUI.Rectangle(name + '_w');
    wrap.width = width;
    wrap.height = height;
    wrap.cornerRadius = 10;
    wrap.color = 'rgba(255, 255, 255, 0.09)';
    wrap.background = 'rgba(12, 12, 24, 0.90)';
    wrap.thickness = 1;
    wrap.paddingLeft = '2px';
    wrap.paddingRight = '2px';
    parent.addControl(wrap);

    const txt = new BABYLON.GUI.TextBlock(name + '_t', label);
    txt.color = '#e8eaed';
    txt.fontSize = 17;
    txt.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    wrap.addControl(txt);

    wrap.onPointerEnterObservable.add(() => {
      wrap.background = 'rgba(79, 142, 255, 0.20)';
      wrap.color = 'rgba(79, 142, 255, 0.50)';
      txt.color = '#8ab4f8';
      if (tooltip && this._btnTooltip) {
        this._btnTooltipTxt.text = tooltip;
        this._btnTooltip.isVisible = true;
      }
    });
    wrap.onPointerOutObservable.add(() => {
      wrap.background = 'rgba(12, 12, 24, 0.90)';
      wrap.color = 'rgba(255, 255, 255, 0.09)';
      txt.color = '#e8eaed';
      if (this._btnTooltip) this._btnTooltip.isVisible = false;
    });
    wrap.onPointerClickObservable.add(() => {
      if (this._btnTooltip) this._btnTooltip.isVisible = false;
      onClick();
    });

    wrap._label = txt;
    return wrap;
  }

  _addSpacer(parent, h) {
    const s = new BABYLON.GUI.Rectangle('sp_' + Math.random());
    s.height = h + 'px'; s.width = '100%';
    s.color = 'transparent'; s.thickness = 0;
    parent.addControl(s);
  }

  /* ── Handy connection ─────────────────────────────────────── */
  async loadHandyKey() {
    try {
      const res = await fetch(apiUrl('/api/settings?key=handy_ck'));
      if (res.ok) {
        const data = await res.json();
        if (data.value) {
          this._handyCK = data.value;
          this._dbg('[handy] saved key loaded');
        }
      }
    } catch (e) { this._dbg('[handy] key load failed: ' + e.message); }
  }

  async toggleHandy() {
    if (this.handyConnected) {
      this.handyConnected = false;
      if (this.scriptActive) {
        this.scriptActive = false;
        await this._stopHandyScript();
      }
      this._updateHandyBtn();
      this._updateScriptBtn();
      this._dbg('[handy] disconnected');
      return;
    }
    if (!this._handyCK) {
      this._dbg('[handy] no connection key saved – set it in the web panel first');
      return;
    }
    try {
      if (this.handyBtn) this.handyBtn._label.text = '🔌 …';
      // Issue bearer token
      const tokRes = await fetch('https://www.handyfeeling.com/api/handy-rest/v3/auth/token/' + this._handyCK);
      if (!tokRes.ok) throw new Error('Token issue failed');
      const tokData = await tokRes.json();
      this._handyToken = tokData.token;
      // Check connected
      const connRes = await fetch('https://www.handyfeeling.com/api/handy-rest/v3/connected', {
        headers: { 'Authorization': 'Bearer ' + this._handyToken, 'Accept': 'application/json' }
      });
      const connData = await connRes.json();
      if (connData?.result?.connected) {
        this.handyConnected = true;
        this._dbg('[handy] connected ✓');
      } else {
        throw new Error('Device not connected');
      }
    } catch (e) {
      this._dbg('[handy] connect failed: ' + e.message);
      this.handyConnected = false;
    }
    this._updateHandyBtn();
    this._updateScriptBtn();
  }

  toggleScript() {
    if (!this.handyConnected || !this.hasScript) return;
    this.scriptActive = !this.scriptActive;
    this._updateScriptBtn();
    this._dbg('[handy] script ' + (this.scriptActive ? 'ON' : 'OFF'));
    if (this.scriptActive) {
      this._startHandyScript();
    } else {
      this._stopHandyScript();
    }
  }

  setHasScript(val, mediaId = null) {
    this.hasScript = !!val;
    this._scriptMediaId = mediaId;
    if (!this.hasScript && this.scriptActive) {
      this.scriptActive = false;
      this._stopHandyScript();
    }
    this._updateScriptBtn();
  }

  async _startHandyScript() {
    if (!this._handyToken || !this._scriptMediaId) {
      this._dbg('[handy] HSSP: missing token or media id');
      return;
    }
    try {
      // 1. Sync clocks with Handy server
      const stRes = await fetch('https://www.handyfeeling.com/api/handy-rest/v3/servertime');
      if (!stRes.ok) throw new Error('servertime ' + stRes.status);
      const stData = await stRes.json();
      this._handyServerTimeOffset = stData.serverTime - Date.now();

      // 2. Set the script URL (must be reachable by Handy's cloud from this host)
      const scriptUrl = new URL(
        apiUrl('/media/script?id=' + encodeURIComponent(this._scriptMediaId)),
        window.location.origin
      ).href;
      this._dbg('[handy] HSSP setup url:', scriptUrl);
      const setupRes = await fetch('https://www.handyfeeling.com/api/handy-rest/v3/hssp/setup', {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + this._handyToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ url: scriptUrl, timeout: 10000 })
      });
      if (!setupRes.ok) throw new Error('HSSP setup ' + setupRes.status);

      // 3. Start playing at current position
      await this._syncHandyScript();

      // 4. Keep device in sync on seek, pause, and resume
      this._stopHandySyncListeners();
      this._handyOnSeeked = () => this._syncHandyScript();
      this._handyOnPause = () => this._hsspStop();
      this._handyOnPlaying = () => this._syncHandyScript();
      this.vc._el.addEventListener('seeked', this._handyOnSeeked);
      this.vc._el.addEventListener('pause', this._handyOnPause);
      this.vc._el.addEventListener('playing', this._handyOnPlaying);

      this._dbg('[handy] HSSP started ✓');
    } catch (e) {
      this._dbg('[handy] HSSP start error: ' + e.message);
      this.scriptActive = false;
      this._updateScriptBtn();
    }
  }

  async _syncHandyScript() {
    if (!this._handyToken) return;
    try {
      const estServerTime = Date.now() + (this._handyServerTimeOffset || 0);
      const startTimeMs = Math.round(this.vc.currentTime * 1000);
      const res = await fetch('https://www.handyfeeling.com/api/handy-rest/v3/hssp/play', {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + this._handyToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          estimatedServerTime: estServerTime,
          startTime: startTimeMs
        })
      });
      if (!res.ok) throw new Error('HSSP play ' + res.status);
      this._dbg(`[handy] HSSP synced @${this.vc.currentTime.toFixed(1)}s`);
    } catch (e) {
      this._dbg('[handy] HSSP sync error: ' + e.message);
    }
  }

  async _hsspStop() {
    if (!this._handyToken) return;
    try {
      await fetch('https://www.handyfeeling.com/api/handy-rest/v3/hssp/stop', {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + this._handyToken, 'Accept': 'application/json' }
      });
    } catch (e) { this._dbg('[handy] HSSP stop error: ' + e.message); }
  }

  async _stopHandyScript() {
    this._stopHandySyncListeners();
    await this._hsspStop();
    this._dbg('[handy] HSSP stopped');
  }

  _stopHandySyncListeners() {
    if (this._handyOnSeeked) this.vc._el.removeEventListener('seeked', this._handyOnSeeked);
    if (this._handyOnPause) this.vc._el.removeEventListener('pause', this._handyOnPause);
    if (this._handyOnPlaying) this.vc._el.removeEventListener('playing', this._handyOnPlaying);
    this._handyOnSeeked = null;
    this._handyOnPause = null;
    this._handyOnPlaying = null;
  }

  _updateHandyBtn() {
    if (!this.handyBtn) return;
    this.handyBtn._label.text = this.handyConnected ? '🔌 On' : '🔌 Off';
    this.handyBtn.background = this.handyConnected
      ? 'rgba(34,197,94,0.25)' : 'rgba(12, 12, 24, 0.90)';
  }

  _updateScriptBtn() {
    if (!this.scriptBtn) return;
    if (!this.hasScript) {
      this.scriptBtn._label.text = '🎮 —';
      this.scriptBtn.background = 'rgba(12, 12, 24, 0.60)';
    } else if (this.scriptActive) {
      this.scriptBtn._label.text = '🎮 On';
      this.scriptBtn.background = 'rgba(34,197,94,0.25)';
    } else {
      this.scriptBtn._label.text = '🎮 Off';
      this.scriptBtn.background = 'rgba(253,214,99,0.18)';
    }
  }

  setupDragBehavior() {
    // Arc Drag updates the _rootNode transform natively (without destroying the anchor immediately)
    // We update the local offsets temporarily, then re-anchor on drag end to cement in XR space.
    const setupArcDrag = (mesh) => {
      const dragBehavior = new BABYLON.PointerDragBehavior({
        dragPlaneNormal: new BABYLON.Vector3(0, 0, 1),
      });
      dragBehavior.useObjectOrientationForDragging = false;
      dragBehavior.moveAttached = false;

      dragBehavior.onDragStartObservable.add(() => {
        // Un-tether the anchor during the drag
        if (this._currentAnchor) {
          this._currentAnchor.attachedNode = null;
        }
      });

      dragBehavior.onDragObservable.add((event) => {
        const cam = this.scene.activeCamera || this._camera;
        const camPos = cam.globalPosition;
        const dist = CONFIG.UI.CONTROL_PANEL_DISTANCE;

        // Drive the _rootNode position locally
        const curAngle = Math.atan2(
          this._rootNode.position.x - camPos.x,
          this._rootNode.position.z - camPos.z
        );
        const newAngle = curAngle + event.delta.x / dist;

        this._rootNode.position.x = camPos.x + Math.sin(newAngle) * dist;
        this._rootNode.position.z = camPos.z + Math.cos(newAngle) * dist;

        // Update local quaternion based on the new view direction
        const dir = camPos.subtract(this._rootNode.position);
        dir.normalize();
        this._rootNode.rotationQuaternion = BABYLON.Quaternion.FromLookDirectionLH(dir, new BABYLON.Vector3(0, 1, 0));
      });

      // When drag naturally ends, re-trigger position mapping to spawn a new firm anchor
      dragBehavior.onDragEndObservable.add(async () => {
        await this._mapAnchorToRootNode();
      });

      mesh.addBehavior(dragBehavior);
    };

    if (this.mesh) setupArcDrag(this.mesh);
    if (this.miniMesh) setupArcDrag(this.miniMesh);
  }

  setupVideoEvents() {
    this.vc.onTimeUpdate(() => {
      const cur = this.vc.currentTime;
      const dur = this.vc.duration;
      if (!dur || !isFinite(dur)) return;
      const pct = Math.min(100, (cur / dur) * 100);
      if (this.progressFill) {
        this.progressFill.width = pct + '%';
      }
      // Move playhead dot along track
      if (this.playhead && this._trackWidth) {
        this.playhead.leftInPixels = ((pct / 100) - 0.5) * this._trackWidth;
      }
      if (this.timeTxt) {
        const chapterLabel = this.getChapterLabelAtTime(cur);
        const timeStr = this._showRemaining
          ? '-' + this.formatTime(dur - cur)
          : this.formatTime(cur) + ' / ' + this.formatTime(dur);

        this.timeTxt.text = chapterLabel ? `${timeStr}  ·  ${chapterLabel}` : timeStr;
      }
      this._updateChapterProgress(cur);
      // Note: updatePlayButton() intentionally NOT called here — play/pause state
      // does not change during normal timeupdate ticks. Dedicated 'playing' and
      // 'pause' event listeners handle icon updates correctly and more efficiently.
    });

    // Update play/pause icon immediately — don't wait for the next timeupdate tick.
    this.vc._el.addEventListener('playing', () => this.updatePlayButton());
    this.vc._el.addEventListener('pause',   () => this.updatePlayButton());

    // Populate the duration display as soon as the browser knows it
    // (fires before the first timeupdate, so the time pill shows correctly).
    this.vc._el.addEventListener('loadedmetadata', () => {
      const dur = this.vc.duration;
      if (this.timeTxt && dur && isFinite(dur)) {
        this.timeTxt.text = '0:00 / ' + this.formatTime(dur);
      }
      this.updatePlayButton();
    });
  }

  /**
   * Play button click handler.
   *
   * Two problems exist if we naively call toggle() + updatePlayButton():
   *  1. toggle() is async — updatePlayButton() fires on the same tick before
   *     _el.paused has flipped, so the icon incorrectly stays as-is.
   *  2. A rapid second click while the first play() promise is still pending
   *     immediately re-pauses the video, forcing the user to click a third time.
   *
   * Fix: optimistically flip the icon before the async call, then guard against
   * re-entry until the operation settles.
   */
  _handlePlayClick() {
    if (this._playTogglePending) return; // ignore rapid re-clicks
    this._playTogglePending = true;
    // Optimistic icon: show the state we *intend* to reach immediately
    if (this.playBtn) {
      this.playBtn._label.text = this.vc.paused ? '⏸' : '▶';
    }
    this.vc.toggle()
      .catch(() => {})
      .finally(() => {
        this._playTogglePending = false;
        this.updatePlayButton(); // reconcile with actual element state
      });
  }

  updatePlayButton() {
    if (this.playBtn) {
      this.playBtn._label.text = this.vc.paused ? '▶' : '⏸';
    }
  }

  updateMuteButton() {
    if (this.muteBtn) {
      this.muteBtn._label.text = this.vc.muted ? '🔇' : '🔊';
    }
    this._updateVolBar();
  }

  _updateVolBar() {
    if (!this._volFill) return;
    const v = this.vc.muted ? 0 : this.vc.volume;
    this._volFill.width = Math.round(v * 100) + '%';
    if (this._volPct) {
      this._volPct.text = this.vc.muted ? 'MUTE' : Math.round(this.vc.volume * 100) + '%';
    }
  }

  /**
   * Load heatmap + chapter timestamps for the currently playing media.
   * Awaited by enterPlaying() before play() so all data is ready when the
   * scene becomes visible. Does NOT clear chapters or performers that were
   * already rendered from the local media object — only overwrites if the
   * server returns richer data that was absent locally.
   */
  async loadMediaExtras(mediaId) {
    // Only clear the heatmap overlay — chapters/performers may already be
    // populated from the local media object and must not be wiped here.
    this._clearHeatmap();

    // ── Heatmap from funscript ──
    try {
      const scriptUrl = apiUrl(`/media/script?id=${encodeURIComponent(mediaId)}`);
      const res = await fetch(scriptUrl);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.actions) && data.actions.length > 1) {
          this._renderHeatmap(data.actions);
          this._dbg(`[heatmap] ${data.actions.length} actions`);
        }
      }
    } catch (e) { this._dbg('[heatmap] ' + e.message); }

    // ── Full Metadata Refresh ──
    try {
      const resp = await fetch(apiUrl(`/api/library/media?id=${encodeURIComponent(mediaId)}`));
      if (resp.ok) {
        const media = await resp.json();
        if (media.blobs && media.blobs.heatmap) {
          this._renderHeatmap(media.blobs.heatmap);
        } else if (media.heatmap_url) {
          this._renderHeatmap(media.heatmap_url);
        }
        // Only render chapters/performers if not already populated from local data
        if (media.timestamps && (!this._timestamps || this._timestamps.length === 0)) {
          this._renderChapters(media.timestamps);
        }
        if (media.performerThumbs && Object.keys(media.performerThumbs).length > 0
            && (!this._performersLoaded)) {
          this._renderPerformers(media.performerThumbs);
        }
      }
    } catch (e) {
      this._dbg('[extras] load failed: ' + e.message);
    }
  }

  updateScrubPreview(relX) {
    if (!this.previewContainer || !this.vc.duration) return;

    const time = relX * this.vc.duration;
    const chapterLabel = this.getChapterLabelAtTime(time);
    const timeStr = this.formatTime(time);
    this.previewTimeTxt.text = chapterLabel ? `${timeStr}  ·  ${chapterLabel}` : timeStr;

    // Horizontal position: centre the 220px preview over the scrub point.
    // Centre-aligned: scrubX relative to centre = (relX - 0.5) * trackWidth
    const scrubCX = (relX - 0.5) * this._trackWidth;
    const halfTex = this._texW / 2;
    const halfPrev = 110; // half of 220px preview width
    this.previewContainer.leftInPixels = Math.max(-halfTex + halfPrev + 4, Math.min(halfTex - halfPrev - 4, scrubCX));

    // Only use locally-downloaded sprite sheet (no CDN fallback)
    const src = this.timelinePreviewUrl;
    if (src && this._spriteCols && this._cellW) {
      // Trigger image load on first hover (or if URL changed between sessions)
      if (this.previewImg.source !== src) {
        this._dbg(`[scrubPreview] loading sprite sheet: ${src.slice(0, 60)}...`);
        this._spriteImgReady = false;
        this.previewImg.source = src;
      }
      // Fall back to Babylon GUI's internal _loaded flag — more reliable than
      // our own flag which can miss the observable under race conditions.
      if (!this._spriteImgReady && this.previewImg._loaded) {
        this._spriteImgReady = true;
      }
      // Drive source rect directly in pixel coords instead of using cellId.
      // Babylon's cellId mode requires naturalWidth/Height resolved at set-time
      // and silently produces wrong results if not yet available. sourceLeft/Top/
      // Width/Height are applied at draw-time and are always reliable.
      if (this._spriteImgReady) {
        const total = this._spriteCols * this._spriteRows;
        const usable = total - 1; // frame 0 is often blank
        const frameIdx = 1 + Math.min(usable - 1, Math.floor(relX * usable));
        const col = frameIdx % this._spriteCols;
        const row = Math.floor(frameIdx / this._spriteCols);
        this.previewImg.sourceLeft = col * this._cellW;
        this.previewImg.sourceTop = row * this._cellH;
        this.previewImg.sourceWidth = this._cellW;
        this.previewImg.sourceHeight = this._cellH;
      }
      this.previewContainer.isVisible = true;
    } else {
      this.previewContainer.isVisible = false;
    }
  }

  /**
   * Configure the scrub preview for sprite-sheet based timeline thumbnails.
   * Matches the SLR format: 4096×4096 image, 12 cols × 21 rows, 341×195 per frame.
   * Pass `url` to begin loading immediately; the browser cache is warmed with a
   * native Image so Babylon GUI picks it up from cache (near-instant).
   *
   * Cell size is auto-calibrated from the image's natural dimensions once it
   * loads, overriding the passed-in frameW/frameH fallbacks. This ensures
   * correctness even if the server generates a different resolution (e.g. 2048
   * or 8192 px sheets) than the hardcoded SLR defaults.
   */
  configureSpriteSheet(cols, rows, frameW, frameH, url = null) {
    this._spriteCols = cols;
    this._spriteRows = rows;
    this._cellW = frameW;
    this._cellH = frameH;
    this._dbg(`[scrubPreview] configureSpriteSheet ${cols}x${rows} @ ${frameW}x${frameH} (fallback)`);

    if (url && this.previewImg) {
      if (this.previewImg.source !== url) {
        // Warm the browser's native image cache first so Babylon GUI's load
        // completes from memory rather than hitting the network again.
        const cacheImg = new window.Image();
        cacheImg.onload = () => {
          if (cacheImg.naturalWidth && cacheImg.naturalHeight) {
            const cw = Math.floor(cacheImg.naturalWidth / cols);
            const ch = Math.floor(cacheImg.naturalHeight / rows);
            if (cw > 0 && ch > 0 && (cw !== this._cellW || ch !== this._cellH)) {
              this._cellW = cw;
              this._cellH = ch;
              this._dbg(`[scrubPreview] auto-calibrated: ${cols}x${rows} @ ${cw}x${ch}`);
            }
          }
        };
        cacheImg.src = url;

        this._spriteImgReady = false;
        this.previewImg.source = url;
      }
      // If source is already set (same scene re-entered, same URL) and
      // Babylon GUI already decoded it, mark ready immediately.
      if (!this._spriteImgReady && this.previewImg._loaded) {
        this._spriteImgReady = true;
      }
    }
  }

  resetSpriteSheet() {
    this._spriteCols = 0;
    this._spriteRows = 0;
    this._cellW = 0;
    this._cellH = 0;
    this._spriteImgReady = false;
    // Do NOT clear previewImg.source — keep the decoded image resident in
    // Babylon GUI's internal state so it doesn't need a network round-trip if
    // the same URL is reused (e.g. re-entering the same scene).
    // The source-equality check in updateScrubPreview handles URL changes.
  }

  /** Build coloured heatmap segments from funscript actions */
  _renderHeatmap(actions) {
    if (!this.heatmapContainer) return;
    this.heatmapContainer.isVisible = true;

    const totalMs = actions[actions.length - 1].at;
    if (totalMs <= 0) return;

    // Compute speed per segment
    const segments = [];
    let maxSpeed = 0;
    for (let i = 1; i < actions.length; i++) {
      const dt = actions[i].at - actions[i - 1].at;
      const dp = Math.abs(actions[i].pos - actions[i - 1].pos);
      const speed = dt > 0 ? dp / dt : 0;
      segments.push({ startMs: actions[i - 1].at, endMs: actions[i].at, speed });
      if (speed > maxSpeed) maxSpeed = speed;
    }

    // Use N buckets across the bar
    const BUCKETS = 200;
    for (let b = 0; b < BUCKETS; b++) {
      const startTime = (b / BUCKETS) * totalMs;
      const endTime = ((b + 1) / BUCKETS) * totalMs;

      let total = 0, cnt = 0;
      for (const s of segments) {
        if (s.endMs >= startTime && s.startMs <= endTime) { total += s.speed; cnt++; }
      }
      const avg = cnt > 0 ? total / cnt : 0;
      const intensity = maxSpeed > 0 ? avg / maxSpeed : 0;

      const color = this._intensityColor(intensity);
      const rect = new BABYLON.GUI.Rectangle('hb_' + b);
      rect.width = (100 / BUCKETS) + '%';
      rect.height = '100%';
      rect.color = 'transparent';
      rect.background = color;
      rect.thickness = 0;
      rect.left = ((b / BUCKETS) * 100) + '%';
      rect.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
      rect.isPointerBlocker = false; // Added per instruction
      this.heatmapContainer.addControl(rect);
    }
  }

  /** Green → Yellow → Red intensity mapping */
  _intensityColor(t) {
    let r, g, b;
    if (t < 0.33) {
      const f = t / 0.33;
      r = Math.floor(34 + 221 * f); g = 211; b = Math.floor(102 - 102 * f);
    } else if (t < 0.66) {
      const f = (t - 0.33) / 0.33;
      r = 255; g = Math.floor(211 - 106 * f); b = 0;
    } else {
      const f = (t - 0.66) / 0.34;
      r = 255; g = Math.floor(105 - 105 * f); b = 0;
    }
    return `rgb(${r},${g},${b})`;
  }

  _clearHeatmap() {
    if (!this.heatmapContainer) return;
    // Remove all children
    const kids = this.heatmapContainer.children.slice();
    for (const c of kids) this.heatmapContainer.removeControl(c);
    this.heatmapContainer.isVisible = false;
  }

  _renderChapters(timestamps) {
    if (!this.chapterRow) return;
    this._clearChapters();
    this.chapterRow.isVisible = true;

    let dur = this.vc.duration;
    if (!dur || !isFinite(dur) || dur <= 0) {
      // Duration not yet known — defer until loadedmetadata fires.
      // Use a one-shot listener instead of a blind setTimeout so we don't
      // schedule multiple retries or fire after the user has already navigated away.
      const onMeta = () => {
        this.vc._el.removeEventListener('loadedmetadata', onMeta);
        this.vc._el.removeEventListener('durationchange', onMeta);
        if (this.vc.duration > 0) this._renderChapters(timestamps);
      };
      this.vc._el.addEventListener('loadedmetadata', onMeta, { once: true });
      this.vc._el.addEventListener('durationchange', onMeta, { once: true });
      return;
    }

    // Pre-sort once and cache — getChapterLabelAtTime uses this directly
    // without re-sorting on every timeupdate tick.
    const sortedTs = (timestamps || []).slice().sort((a, b) => a.time - b.time);
    if (!sortedTs.length) return;

    // Auto-insert implicit Intro chapter if first chapter doesn't start at 0s
    if (sortedTs[0].time > 0) {
      sortedTs.unshift({ time: 0, label: 'Intro' });
    }

    // Save back to instance so getChapterLabelAtTime works for the [0, T1] period
    this._timestamps = sortedTs;

    // Create segments: [0..T1], [T1..T2], ..., [TN..End]
    const segments = [];
    for (let i = 0; i < sortedTs.length; i++) {
      const start = sortedTs[i].time;
      const end = (i < sortedTs.length - 1) ? sortedTs[i + 1].time : dur;
      segments.push({
        start,
        end,
        label: sortedTs[i].label,
        duration: end - start
      });
    }

    this._chapterSegments = []; // store for progress updates

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const pctWidth = (seg.duration / dur) * 100;

      const container = new BABYLON.GUI.Rectangle('seg_' + i);
      container.width = pctWidth + '%';
      container.left = (seg.start / dur) * 100 + '%';
      container.height = '100%';
      container.color = 'transparent';
      container.background = 'transparent';
      container.thickness = 0;
      container.paddingLeft = '1px';
      container.paddingRight = '1px';
      container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
      container.isPointerBlocker = false; // ScrubHit handles interactions
      this.chapterRow.addControl(container);

      // Background indicator
      const bg = new BABYLON.GUI.Rectangle('segbg_' + i);
      bg.width = '100%';
      bg.height = '10px';
      bg.cornerRadius = 5;
      bg.background = 'rgba(255,255,255,0.2)'; // More visible against track
      bg.color = 'transparent';
      bg.thickness = 0;
      bg.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
      bg.isPointerBlocker = false;
      container.addControl(bg);

      // Active fill (updates as video plays)
      const fill = new BABYLON.GUI.Rectangle('segfill_' + i);
      fill.width = '0%';
      fill.height = '10px';
      fill.cornerRadius = 5;
      fill.background = 'rgba(255,100,60,0.85)'; // Vibrant red-orange for progress
      fill.color = 'transparent';
      fill.thickness = 0;
      fill.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
      fill.isPointerBlocker = false;
      bg.addControl(fill);

      this._chapterSegments.push({ seg, fill });

      // Note: Tooltips were removed here because updateScrubPreview natively shows the chapter name,
      // and container pointer blockers would override the main scrubHit interactions.
    }
    this._dbg(`[_renderChapters] rendered ${segments.length} segments`);
  }

  _updateChapterProgress(currentTime) {
    if (!this._chapterSegments || !this._chapterSegments.length) return;
    for (let i = 0; i < this._chapterSegments.length; i++) {
      const { seg, fill } = this._chapterSegments[i];
      if (currentTime >= seg.end) {
        fill.width = '100%';
      } else if (currentTime <= seg.start) {
        fill.width = '0%';
      } else {
        const pct = ((currentTime - seg.start) / seg.duration) * 100;
        fill.width = pct + '%';
      }
    }
  }

  getChapterLabelAtTime(time) {
    // _timestamps is pre-sorted ascending by _renderChapters — no re-sort needed.
    // This is called on every timeupdate tick so must stay allocation-free.
    if (!this._timestamps || this._timestamps.length === 0) return '';
    const chapters = this._timestamps;
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (time >= chapters[i].time) return chapters[i].label;
    }
    return '';
  }

  _renderPerformers(thumbsMap) {
    this._clearPerformers();
    this._performersLoaded = false;
    const hasPerformers = thumbsMap && Object.keys(thumbsMap).length > 0;

    if (!hasPerformers) {
      if (this.performerMesh) this.performerMesh.isVisible = false;
      return;
    }
    this._performersLoaded = true;

    if (this.isVisible && !this.isMinimized) {
      if (this.performerMesh) this.performerMesh.isVisible = true;
    }

    const entries = Object.entries(thumbsMap);
    let currentRow = null;

    for (let i = 0; i < entries.length; i++) {
      const [name, thumb] = entries[i];

      // 2 per row
      if (i % 2 === 0) {
        currentRow = new BABYLON.GUI.StackPanel('prow_' + Math.floor(i / 2));
        currentRow.isVertical = false;
        currentRow.height = '360px'; currentRow.width = '100%';
        currentRow.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.performerRow.addControl(currentRow);
      }

      const chip = new BABYLON.GUI.Rectangle('pchip_' + i);
      chip.width = '360px'; chip.height = '360px';
      chip.thickness = 0; chip.color = 'transparent';
      currentRow.addControl(chip);

      const ellipse = new BABYLON.GUI.Ellipse('pimg_' + i);
      ellipse.width = '320px'; ellipse.height = '320px';
      ellipse.thickness = 3; ellipse.color = 'rgba(255,255,255,0.2)';
      ellipse.background = 'rgba(0,0,0,0.4)';
      ellipse.isPointerBlocker = true;
      chip.addControl(ellipse);

      const img = new BABYLON.GUI.Image('picon_' + i, thumb);
      img.stretch = BABYLON.GUI.Image.STRETCH_FILL;
      ellipse.addControl(img);

      // Hover Overlay
      const overlay = new BABYLON.GUI.Rectangle('pover_' + i);
      overlay.width = '100%'; overlay.height = '100%';
      overlay.background = 'rgba(0,0,0,0.65)';
      overlay.thickness = 0; overlay.isVisible = false;
      overlay.isPointerBlocker = false;
      overlay.cornerRadius = 160;
      ellipse.addControl(overlay);

      const nameTxt = new BABYLON.GUI.TextBlock('pname_' + i, name);
      nameTxt.color = '#fff'; nameTxt.fontSize = 32;
      nameTxt.fontWeight = 'bold';
      nameTxt.textWrapping = true;
      nameTxt.paddingLeft = '20px'; nameTxt.paddingRight = '20px';
      overlay.addControl(nameTxt);

      ellipse.onPointerEnterObservable.add(() => {
        overlay.isVisible = true;
        ellipse.color = 'rgba(138,180,248,0.8)';
        this.resetAutoHide();
      });

      ellipse.onPointerOutObservable.add(() => {
        overlay.isVisible = false;
        ellipse.color = 'rgba(255,255,255,0.2)';
        this.resetAutoHide();
      });
    }
  }

  _clearPerformers() {
    if (!this.performerRow) return;
    const kids = this.performerRow.children.slice();
    for (const c of kids) this.performerRow.removeControl(c);
  }

  _clearChapters() {
    if (!this.chapterRow) return;
    const kids = this.chapterRow.children.slice();
    for (const c of kids) this.chapterRow.removeControl(c);
    this.chapterRow.isVisible = false;
    this._timestamps = null;
    this._chapterSegments = [];
    this._lastDbgChap = null;
  }

  cycleSpeed() {
    const speeds = CONFIG.VIDEO.PLAYBACK_SPEEDS;
    const currentIdx = speeds.indexOf(this.currentSpeed);
    const nextIdx = (currentIdx + 1) % speeds.length;
    this.currentSpeed = speeds[nextIdx];
    this.vc.setPlaybackRate(this.currentSpeed);
    if (this.speedBtn) {
      this.speedBtn._label.text = this.currentSpeed.toFixed(1) + 'x';
    }
    // Persist across scenes
    try { localStorage.setItem('vr_speed', String(this.currentSpeed)); } catch (_) { }
  }

  /* ── Snap-turn ────────────────────────────────────────────── */

  _handleSnapTurnClick() {
    const next = !this._snapTurnEnabled;
    this.setSnapTurnEnabled(next);
    if (this._onSnapTurnToggle) this._onSnapTurnToggle(next);
  }

  setSnapTurnEnabled(enabled) {
    this._snapTurnEnabled = enabled;
    if (!this.snapTurnBtn) return;
    this.snapTurnBtn._label.text = enabled ? '↪ On' : '↪ Off';
    this.snapTurnBtn.background = enabled
      ? 'rgba(79,142,255,0.20)'
      : 'rgba(12,12,24,0.90)';
    this.snapTurnBtn.color = enabled
      ? 'rgba(79,142,255,0.50)'
      : 'rgba(255,255,255,0.09)';
    if (this.snapTurnBtn._label) {
      this.snapTurnBtn._label.color = enabled ? '#8ab4f8' : '#e8eaed';
    }
  }

  /* ── Comfort vignette ─────────────────────────────────────── */

  toggleVignette() {
    this._vignetteEnabled = !this._vignetteEnabled;
    if (this.vignetteBtn) {
      this.vignetteBtn._label.text = this._vignetteEnabled ? '👁 On' : '👁 Off';
      this.vignetteBtn.background = this._vignetteEnabled
        ? 'rgba(79,142,255,0.20)'
        : 'rgba(12,12,24,0.90)';
      this.vignetteBtn.color = this._vignetteEnabled
        ? 'rgba(79,142,255,0.50)'
        : 'rgba(255,255,255,0.09)';
      if (this.vignetteBtn._label) {
        this.vignetteBtn._label.color = this._vignetteEnabled ? '#8ab4f8' : '#e8eaed';
      }
    }
    if (this._onVignetteToggle) this._onVignetteToggle(this._vignetteEnabled);
  }

  /* ── Sleep timer ──────────────────────────────────────────── */

  cycleSleepTimer() {
    const steps = CONFIG.VIDEO.SLEEP_TIMER_STEPS; // [15, 30, 60]
    this._sleepStepIdx = (this._sleepStepIdx + 1) % (steps.length + 1);
    const minutes = this._sleepStepIdx === 0 ? 0 : steps[this._sleepStepIdx - 1];
    this._setSleepTimer(minutes);
  }

  _setSleepTimer(minutes) {
    clearInterval(this._sleepCountdownInterval);
    this._sleepCountdownInterval = null;
    this._sleepSecondsRemaining = minutes * 60;
    this._updateSleepBtn();
    if (minutes <= 0) return;
    this._sleepCountdownInterval = setInterval(() => {
      this._sleepSecondsRemaining--;
      this._updateSleepBtn();
      if (this._sleepSecondsRemaining <= 0) {
        clearInterval(this._sleepCountdownInterval);
        this._sleepCountdownInterval = null;
        this._sleepStepIdx = 0;
        this._sleepSecondsRemaining = 0;
        this._updateSleepBtn();
        this._dbg('[sleep] timer expired — pausing');
        this.vc.pause();
      }
    }, 1000);
    this._dbg(`[sleep] timer set: ${minutes}m`);
  }

  _updateSleepBtn() {
    if (!this.sleepBtn) return;
    if (!this._sleepSecondsRemaining) {
      this.sleepBtn._label.text = '💤 Off';
      this.sleepBtn.background = 'rgba(12,12,24,0.90)';
      this.sleepBtn.color = 'rgba(255,255,255,0.09)';
      return;
    }
    const m = Math.floor(this._sleepSecondsRemaining / 60);
    const s = this._sleepSecondsRemaining % 60;
    this.sleepBtn._label.text = `💤 ${m}:${String(s).padStart(2, '0')}`;
    this.sleepBtn.background = 'rgba(253,214,99,0.15)';
    this.sleepBtn.color = 'rgba(253,214,99,0.50)';
  }

  /** Cancel sleep timer — called when exiting playback. */
  resetSleepTimer() {
    clearInterval(this._sleepCountdownInterval);
    this._sleepCountdownInterval = null;
    this._sleepStepIdx = 0;
    this._sleepSecondsRemaining = 0;
    this._updateSleepBtn();
  }

  /* ── Library browse ───────────────────────────────────────── */

  _handleBrowseClick() {
    if (this._onBrowseLibrary) {
      this._onBrowseLibrary();
    } else {
      // Fall back to exit-playing which naturally returns to the lobby browser
      this._onExitPlaying();
    }
  }

  /* ── Bookmark navigation ──────────────────────────────────── */

  addBookmark() {
    const vf = this._getVideoFeatures();
    if (!vf) return;
    vf.addBookmark(this.vc.currentTime);
    this._dbg(`[bkm] added @${this.vc.currentTime.toFixed(1)}s`);
    // Brief ✓ flash on the button for feedback
    if (this.bkmAddBtn) {
      const orig = this.bkmAddBtn._label.text;
      this.bkmAddBtn._label.text = '✓';
      setTimeout(() => { if (this.bkmAddBtn) this.bkmAddBtn._label.text = orig; }, 700);
    }
  }

  nextBookmark() {
    const vf = this._getVideoFeatures();
    if (!vf) return;
    const mediaId = vf.session.id;
    const sorted = (vf.bookmarks || [])
      .filter(b => b.mediaId === mediaId)
      .sort((a, b) => a.time - b.time);
    if (!sorted.length) return;
    const cur = this.vc.currentTime;
    // Find first bookmark strictly after current time, wrap around
    const next = sorted.find(b => b.time > cur + 1) || sorted[0];
    this.vc.seek(next.time);
    this._dbg(`[bkm] → ${next.name} @${next.time.toFixed(1)}s`);
  }

  cycleFormat() {
    this.currentFormatIdx = (this.currentFormatIdx + 1) % FORMAT_CYCLE.length;
    const fmt = FORMAT_CYCLE[this.currentFormatIdx];
    this._onSwitchFormat(fmt.mode, fmt.stereo);
    if (this.fmtBtn) {
      this.fmtBtn._label.text = fmt.label;
    }
  }

  adjustZoom(delta) {
    this.currentZoom = Math.max(CONFIG.VIDEO.MIN_ZOOM,
      Math.min(CONFIG.VIDEO.MAX_ZOOM, this.currentZoom + delta));
    this._applyZoom();
  }

  resetZoom() {
    this.currentZoom = 1.10;
    this._applyZoom();
    this._dbg('[zoom] reset to default (1.10)');
  }

  _applyZoom() {
    if (this._display && this._display.dome) {
      this._display.dome.fovMultiplier = this.currentZoom;
      this._dbg(`[zoom] dome fov=${this.currentZoom.toFixed(2)}`);
    }
    if (this._display && this._display.flatScreen) {
      const s = 0.5 + this.currentZoom;
      this._display.flatScreen.scaling.setAll(s);
      this._dbg(`[zoom] flat scale=${s.toFixed(2)}`);
    }
  }

  adjustDepth(delta) {
    this.currentDepth = Math.max(0.3, Math.min(3.0, this.currentDepth + delta));
    if (this._display.flatScreen) {
      // Reposition the flat screen along the user's forward vector
      const cam = this.scene.activeCamera || this._camera;
      const fwd = cam.getForwardRay().direction.clone();
      fwd.y = 0; fwd.normalize();
      const pos = cam.globalPosition.clone();
      // Base distance 8u matches the theatre placement; currentDepth 0.3–3.0 scales around it
      const target = pos.add(fwd.scale(this.currentDepth * 8));
      target.y = pos.y + 0.3;
      this._display.flatScreen.position.copyFrom(target);
      this._display.flatScreen.lookAt(cam.globalPosition, Math.PI);
      this._dbg(`[depth] flat depth=${this.currentDepth.toFixed(2)}`);
    }
    // For dome content depth is N/A — zoom controls the effective FOV
  }

  cycleEnvironment() {
    this.currentEnvIdx = (this.currentEnvIdx + 1) % ENV_CYCLE.length;
    const mode = ENV_CYCLE[this.currentEnvIdx].mode;
    this.setEnvironment(mode);
  }

  resetEnvironment() {
    this.currentEnvIdx = 0;
    this.setEnvironment(ENV_CYCLE[0].mode);
  }

  setEnvironment(mode) {
    if (mode === 'passthrough') {
      // ── MR Passthrough Mode: transparent background so passthrough shows ──
      this.scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);

      // Hide immersive dome but keep flat screen (MR floating screen)
      if (this._display.dome) this._display.dome.mesh.isVisible = false;
      this._skybox.isVisible = false;
      if (this._skybox.material) this._skybox.material.emissiveColor = new BABYLON.Color3(0, 0, 0);
      this._ground.isVisible = false;

      // For VR content, switch to flat screen display so user sees
      // the video floating in their real room
      if (this._display.dome && this._appState.current === 'playing') {
        this._mrWasDome = true;
        this._display.create('2d', 'none');
        if (this._display.flatScreen) {
          this._display.flatScreen.isVisible = true;
          this._display.recenter();
        }
        this._dbg('[passthrough] converted dome → floating MR screen');
      }
    } else {
      // Opaque background
      this.scene.clearColor = new BABYLON.Color4(0.071, 0.071, 0.071, 1);

      // Restore dome if we converted it for MR
      if (this._mrWasDome && this._appState.current === 'playing') {
        const fmt = FORMAT_CYCLE[this.currentFormatIdx];
        if (fmt.mode !== '2d') {
          this._display.create(fmt.mode, fmt.stereo);
          this._dbg('[passthrough] restored dome from MR mode');
        }
        this._mrWasDome = false;
      }

      if (this._display.dome) this._display.dome.mesh.isVisible = true;
      if (this._display.flatScreen) this._display.flatScreen.isVisible = true;

      // Handle specific opaque modes
      if (mode === 'void') {
        this._skybox.isVisible = false;
        this._ground.isVisible = false;
        this.scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);
      } else if (mode === 'theater') {
        this._skybox.isVisible = true;
        if (this._skybox.material) {
          this._skybox.material.emissiveColor = new BABYLON.Color3(0.0, 0.05, 0.1); // Dark blue-grey for a theater vibe
        }
        this.scene.clearColor = new BABYLON.Color4(0.01, 0.02, 0.05, 1);
      } else {
        // Cinema (Default dark environment)
        this._skybox.isVisible = true;
        if (this._skybox.material) {
          this._skybox.material.emissiveColor = new BABYLON.Color3(0.01, 0.01, 0.01); // Just slightly visible black
        }
        this.scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);
      }
    }
  }

  async exitVR() {
    this._dbg('[vr] exiting VR');
    try {
      if (this._getXrHelper()?.baseExperience?.state === BABYLON.WebXRState.IN_XR) {
        await this._getXrHelper().baseExperience.exitXRAsync();
      }
    } catch (e) {
      this._dbg('[vr] exit error: ' + e.message);
    }
  }

  async _mapAnchorToRootNode() {
    const xr = this._getXrHelper();

    // Fallback: If no XR or no anchor system, just use the local root transforms.
    if (!xr || !xr.baseExperience || xr.baseExperience.state !== BABYLON.WebXRState.IN_XR) {
      return;
    }

    if (!this._anchorSystem) {
      try {
        this._anchorSystem = xr.baseExperience.featuresManager.enableFeature(BABYLON.WebXRFeatureName.ANCHOR_SYSTEM, 'latest');
      } catch (e) {
        this._dbg('[anchor] anchor system not available');
        return;
      }
    }

    if (this._currentAnchor) {
      this._currentAnchor.remove();
      this._currentAnchor = null;
    }

    try {
      // Create a native spatial anchor exactly where our root node mathematically is right now.
      const pos = this._rootNode.position.clone();
      const rot = this._rootNode.rotationQuaternion.clone();

      this._currentAnchor = await this._anchorSystem.addAnchorAtPositionAndRotationAsync(pos, rot);
      if (this._currentAnchor) {
        // Link the root geometry natively to the XR physical space tracking
        this._currentAnchor.attachedNode = this._rootNode;
        this._dbg('[anchor] webxr anchor successfully mapped and attached.');
      }
    } catch (err) {
      this._dbg('[anchor] failed to create: ' + err.message);
    }
  }

  positionForCamera() {
    if (!this._rootNode) return;

    const activeCam = this.scene.activeCamera || this._camera;
    const fwd = activeCam.getForwardRay().direction.clone();
    fwd.normalize();

    const pos = activeCam.globalPosition.clone();
    const dist = CONFIG.UI.CONTROL_PANEL_DISTANCE;

    // The root node "tether" position - EXACTLY where we look in 3D
    const target = pos.add(fwd.scale(dist));
    target.y = target.y + CONFIG.UI.CONTROL_PANEL_HEIGHT_OFFSET;

    // Set stable local offsets (lock sub-panel positions relative to anchor parent)
    if (this.progMesh) {
      this.progMesh.position.set(0, 0, 0); // Timeline at top
    }
    if (this.mesh) {
      this.mesh.position.set(0, -0.36, 0); // Controls tightly below
    }
    if (this.miniMesh) {
      this.miniMesh.position.set(0, -0.36, 0);
    }
    if (this.performerMesh) {
      this.performerMesh.position.set(1.6, -0.32, 0); // Performer left
    }

    // Detach current anchor to allow teleportation
    if (this._currentAnchor) {
      this._currentAnchor.attachedNode = null;
    }

    this._rootNode.position.copyFrom(target);

    // Atomic billboard rotation using Quaternions
    // "fwd" points away from camera. By aligning +Z to -dir, the plane normal strictly faces us.
    const dirToCam = pos.subtract(target);
    dirToCam.normalize();
    // Use FromLookDirectionLH with robust Up vector ensuring 0 arbitrary flips.
    this._rootNode.rotationQuaternion = BABYLON.Quaternion.FromLookDirectionLH(dirToCam, new BABYLON.Vector3(0, 1, 0));

    // Attempt to remap in physical XR space immediately
    this._mapAnchorToRootNode();
  }

  setVisible(visible) {
    this.isVisible = visible;
    const hasPerformers = this.performerRow && this.performerRow.children.length > 0;

    if (visible && !this.isMinimized) {
      if (this.mesh) this.mesh.isVisible = true;
      if (this.miniMesh) this.miniMesh.isVisible = false;
      if (this.progMesh) this.progMesh.isVisible = true;
      if (this.performerMesh) this.performerMesh.isVisible = hasPerformers;
    } else if (visible && this.isMinimized) {
      if (this.mesh) this.mesh.isVisible = false;
      if (this.miniMesh) this.miniMesh.isVisible = true;
      if (this.progMesh) this.progMesh.isVisible = false;
      if (this.performerMesh) this.performerMesh.isVisible = false;
    } else {
      if (this.mesh) this.mesh.isVisible = false;
      if (this.miniMesh) this.miniMesh.isVisible = false;
      if (this.progMesh) this.progMesh.isVisible = false;
      if (this.performerMesh) this.performerMesh.isVisible = false;
    }
  }

  setMinimized(minimized) {
    this.isMinimized = minimized;
    if (this._appState.current !== 'playing') return;
    this.setVisible(true);
    this.resetAutoHide();
  }

  /* ── Auto-hide controls ─────────────────────────────────── */
  startAutoHide() {
    this._autoHidden = false;
    this.resetAutoHide();
  }

  stopAutoHide() {
    if (this._autoHideTimer) { clearTimeout(this._autoHideTimer); this._autoHideTimer = null; }
    this._autoHidden = false;
  }

  resetAutoHide() {
    if (this._autoHideTimer) clearTimeout(this._autoHideTimer);
    if (this._isPointerOver) return; // Don't hide while hovering
    // If currently hidden, show first
    const hasPerformers = this.performerRow && this.performerRow.children.length > 0;
    if (this._autoHidden && this._appState.current === 'playing') {
      this._autoHidden = false;
      if (this.mesh) this.mesh.isVisible = !this.isMinimized;
      if (this.miniMesh) this.miniMesh.isVisible = this.isMinimized;
      if (this.progMesh) this.progMesh.isVisible = !this.isMinimized;
      if (this.performerMesh) this.performerMesh.isVisible = !this.isMinimized && hasPerformers;
    }
    this._autoHideTimer = setTimeout(() => {
      if (this._appState.current !== 'playing') return;
      this._autoHidden = true;
      if (this.mesh) this.mesh.isVisible = false;
      if (this.miniMesh) this.miniMesh.isVisible = false;
      if (this.progMesh) this.progMesh.isVisible = false;
      if (this.performerMesh) this.performerMesh.isVisible = false;
      this._dbg('[controls] auto-hidden');
    }, this._autoHideDelay);
  }

  /** Called when user taps the dome / scene to bring controls back */
  showFromAutoHide() {
    if (!this._autoHidden || this._appState.current !== 'playing') return;
    this._autoHidden = false;
    this.setVisible(true);
    this.positionForCamera();
    this.resetAutoHide();
    this._dbg('[controls] shown on tap');
  }

  formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}
