/**
 * XRSessionManager — owns the three.js renderer + immersive WebXR session.
 *
 * Rendering approach: three.js `renderer.xr` drives the session and per-eye
 * cameras (the robust, well-trodden WebXR video path). The video is shown on a
 * sphere (360) / hemisphere (180) / plane (flat) with a per-eye UV split for
 * stereo (left mesh → layer 1, right mesh → layer 2). This single path supports
 * every projection control (FOV, stereo, swap-eyes, recenter) and renders
 * crisply on Quest 3 at high framebuffer scale.
 *
 * NOTE: an `XREquirectLayer` media-layer "max quality" mode (compositor-sampled
 * video) is a planned follow-up — it needs on-device tuning and gracefully sits
 * behind this same manager interface.
 *
 * The floating UI is one consolidated control panel (transport + performers
 * carousel + tag/chapter strips) plus a collapsible Handy sub-panel, living in
 * one group that is pinned in front of the viewer by default, grip-draggable,
 * and auto-hides after a few seconds of no input. Drawing is dirty-checked and
 * the UI fades as a unit so per-frame GPU work stays minimal.
 *
 * Playback state is *pulled* each frame via `getState()` and all interactions
 * are *pushed* out via `onAction`, so the React layer remains the only owner of
 * the <video> element and projection state.
 */
import * as THREE from "three";
import {
  IProjectionSettings,
  IUVTransform,
  StereoMode,
  FISHEYE190_MAX_THETA,
  horizontalCoverage,
  isStereo,
  uvTransformForEye,
} from "./projection";
import { VRControlPanel, IDrawInput } from "./VRControls";
import { VRControllerInput, IPanelHit } from "./VRControllerInput";
import { VRDeviceModels } from "./VRDeviceModels";
import {
  VRHandyPanel,
  VRInfoPanel,
  IVRSceneInfo,
  VRCanvasPanel,
} from "./VRInfoPanels";
import { VRScenesPanel, IVRSceneEntry } from "./VRScenesPanel";
import { VRCarouselLibrary } from "./VRCarouselLibrary";
import { VRHomePanel } from "./VRHomePanel";
import { fetchFaptapStatus } from "./faptapLibrary";
import { VRGalleryViewerPanel } from "./VRGalleryViewerPanel";
import { VRLobbyBackdrop } from "./VRLobbyBackdrop";
import {
  VRControlAction,
  IVRMarker,
  IVRPlaybackState,
  IVRHandyState,
  IVRHomeSettings,
  VRStrokeStatus,
  IVRHomeDataSource,
  IVRGalleryDataSource,
  IVRGroupDataSource,
  IVRFilterEntry,
  VRMediaFilter,
  VRSortMode,
} from "./types";
import type { IThumbnailCrop } from "./vttThumbnails";
import { vrLog } from "./vrLog";

const DOME_RADIUS = 500;
// Dome geometry segments — lowered from 64×40 to 48×32 (~40% fewer tris) to
// reduce GPU fill-rate pressure on Quest 3, especially for the always-shader
// fisheye190 path. 48×32 is visually indistinguishable at DOME_RADIUS=500.
const DOME_SEG_W = 48;
const DOME_SEG_H = 32;
const PANEL_DISTANCE = 2.4;
const PANEL_DROP = 0.45; // metres below eye level
const PANEL_TILT = 0.18; // radians the UI group leans back toward the eyes
// Metres the angled side panels (Scenes / Info) are pushed toward the viewer so
// their inward rotation doesn't sink the inner edge behind the main bar plane.
const SIDE_PANEL_FORWARD = 0.5;
// Local X-tilt (radians) of the Handy panel, which sits below the main bar and
// is angled up toward the viewer. Negative tilts the top edge forward so a
// below-eye-level panel faces up at the viewer. Tuned on-device (Quest 3).
const HANDY_TILT = -0.4;

// Performance auto-throttle thresholds (timings in ms):
//   HITCH_MS       — any single frame longer than this counts as a hitch
//   HITCH_WINDOW   — sliding window (ms) over which we count hitches
//   ESCALATE_AT    — hitches within the window to escalate throttle
//   DECAY_MS       — smooth frames needed before dropping one throttle level
const THROTTLE_HITCH_MS = 33; // ~30fps boundary
const THROTTLE_WINDOW_MS = 3000;
const THROTTLE_ESCALATE_AT = 4;
const THROTTLE_DECAY_MS = 10000;

// Auto-hide: fade the whole UI out after this much hand/controller-input-free
// time, and back in on the next deliberate input.
const AUTO_HIDE_MS = 4000;
const FADE_LERP = 0.18;

// How long the controller ray must dwell on a scene card before its hover
// preview <video> is loaded. Sweeping across cards faster than this loads
// nothing, so the media pipeline isn't thrashed (each src swap is a main-thread
// decode-pipeline reset — a measured interaction hitch).
const HOVER_PREVIEW_DWELL_MS = 180;

// Floating scrubber-hover thumbnail preview (enlarged for legibility, with a
// marker-name caption overlaid when the hovered position falls inside a marker).
const THUMB_W_M = 0.9;
const THUMB_H_M = (THUMB_W_M * 9) / 16;
const THUMB_CANVAS_W = 480;
const THUMB_CANVAS_H = 270;

/**
 * Debug bisection flags for the on-device flicker hunt, read from the URL
 * (`?vrDebug=solid,mono`) or localStorage `vrDebug`. All default off, so the
 * normal render path is unchanged. Flags:
 *   solid      — dome uses a flat colour, not the video texture (isolates the
 *                VideoTexture / per-frame upload as the flicker source)
 *   mono       — force a single mono dome mesh (isolates the stereo eye-layer
 *                assignment)
 *   noaa       — disable renderer MSAA (antialias)
 *   nofov      — disable fixed-foveated rendering
 *   hideui     — keep the whole UI hidden (isolates panel rendering)
 *   noautohide — keep the UI permanently visible (isolates the auto-hide fade)
 *   nomedialayer — force the shader-dome texture path instead of the WebXR
 *                media layer (A/B the compositor-sampled video on-device)
 *   opaque     — build the renderer opaque (alpha off, opaque black clear), i.e.
 *                the pre-media-layer behaviour. Use with `nomedialayer` to fully
 *                restore the original render path for regression A/B.
 */
function readVrDebug(): Set<string> {
  const out = new Set<string>();
  try {
    const url = new URLSearchParams(window.location.search).get("vrDebug");
    const ls = window.localStorage.getItem("vrDebug");
    for (const raw of [url, ls]) {
      if (!raw) continue;
      for (const part of raw.split(",")) {
        const t = part.trim().toLowerCase();
        if (t) out.add(t);
      }
    }
  } catch {
    /* SSR / blocked storage — ignore */
  }
  return out;
}

/** Map our stereo-packing mode to the WebXR composition-layer layout. */
function layoutForStereo(stereo: StereoMode): XRLayerLayout {
  switch (stereo) {
    case "sbs":
      return "stereo-left-right";
    case "tb":
      return "stereo-top-bottom";
    default:
      return "mono";
  }
}

export interface IXRSessionManagerOptions {
  video: HTMLVideoElement;
  container: HTMLElement;
  projection: IProjectionSettings;
  /** Static, per-scene info for the performers + scene-info panels. */
  info: IVRSceneInfo;
  getState: () => IVRPlaybackState;
  getMarkers: () => IVRMarker[];
  getChapterTitle: () => string | null;
  getCaption: () => string | null;
  /** Handy connection state, for the VR Handy panel status bar. */
  getHandyState?: () => IVRHandyState;
  /** Whether the current scene has a funscript (for the green Handy status icon). */
  getFunscriptLoaded?: () => boolean;
  /**
   * Server-backed data source for the immersive Home wall (lobby mode). The wall
   * pages / filters / sorts through this rather than holding the whole library
   * in memory, so it scales to libraries of any size.
   */
  homeData?: IVRHomeDataSource;
  /**
   * Server-backed data source for the Galleries content mode + XR gallery viewer.
   * Pages galleries and (on demand) an active gallery's images server-side.
   */
  galleryData?: IVRGalleryDataSource;
  /**
   * Server-backed data source for the Movies content mode. Pages movie posters
   * and (on drill-in) an active movie's scenes — ordered by scene_index —
   * server-side, so the wall scales to libraries of any size.
   */
  groupData?: IVRGroupDataSource;
  /**
   * Server-backed data source for the premium FapTap content mode. Same
   * IVRHomeDataSource contract as [homeData] but backed by the FapTap sidecar
   * catalog; only present (and only unlocks the tab) when its database exists.
   */
  faptapData?: IVRHomeDataSource;
  /** Start the session in lobby/Home mode (no scene loaded yet). */
  lobby?: boolean;
  /** Initial immersive-Home preferences (gaze-launch / dwell / audio). */
  homeSettings?: IVRHomeSettings;
  /** Sprite crop for a scrubber-hover preview, or null when unavailable. */
  getThumbnail?: (time: number) => IThumbnailCrop | null;
  onAction: (a: VRControlAction) => void;
  onEnd: () => void;
}

/** A panel the controller can hover/select, routed by its hit-target mesh. */
interface IHittable {
  target: THREE.Object3D;
  hover: (uv: THREE.Vector2 | null) => void;
  select: (uv: THREE.Vector2) => VRControlAction | null;
  /** Trigger held + dragged across the panel (drag-to-scroll). */
  move?: (uv: THREE.Vector2) => void;
  /** Trigger released over the panel (tap-to-select). */
  up?: (uv: THREE.Vector2) => VRControlAction | null;
}

/**
 * GPU timer-query helper (WebGL2 `EXT_disjoint_timer_query_webgl2`). Wraps the
 * scene render to measure its GPU time, which is the decisive third leg of the
 * jitter diagnosis: a dome frame that re-uploads a large video texture is
 * GPU-bound (high gpuMs that scales with video resolution), whereas a
 * compositor/decode hitch leaves gpuMs small. Results lag a few frames (async
 * readback) and are drained by the caller. Fully inert when the extension is
 * absent (older runtimes / WebGL1) — gpuMs is simply omitted from the log.
 */
class GpuTimer {
  private gl: WebGL2RenderingContext;
  private ext: {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  private active: WebGLQuery | null = null;
  private inflight: WebGLQuery[] = [];
  private pool: WebGLQuery[] = [];
  /** Completed GPU times (ms); drained by the profiler each frame. */
  results: number[] = [];

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.gl = gl as WebGL2RenderingContext;
    this.ext =
      typeof WebGL2RenderingContext !== "undefined" &&
      gl instanceof WebGL2RenderingContext
        ? gl.getExtension("EXT_disjoint_timer_query_webgl2")
        : null;
  }

  get supported(): boolean {
    return !!this.ext;
  }

  begin(): void {
    if (!this.ext || this.active) return;
    const q = this.pool.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.inflight.push(this.active);
    this.active = null;
    this.poll();
  }

  private poll(): void {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.inflight.length) {
      const q = this.inflight[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.inflight.shift();
      if (!disjoint) {
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        this.results.push(ns / 1e6);
      }
      this.pool.push(q);
    }
  }
}

export class XRSessionManager {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private videoGroup: THREE.Group;
  private uiGroup: THREE.Group;
  private videoTexture: THREE.VideoTexture;
  private panel: VRControlPanel;
  private input: VRControllerInput;
  private deviceModels: VRDeviceModels | null = null;
  private session: XRSession | null = null;
  private projection: IProjectionSettings;
  private domeMeshes: THREE.Mesh[] = [];
  // WebXR Media Layers — the default, compositor-sampled video path ("max
  // quality": the headset compositor samples the video directly, ~halving GPU
  // vs the eye-buffer dome). Used for 180/360 (equirect); the shader dome is
  // retained for fisheye190 (no composition-layer type can un-distort dual
  // fisheye) and for flat (the compositor flat layer renders nothing on Quest
  // here — see wantsMediaLayer). null on devices without the Layers API → we
  // keep the dome path.
  private mediaBinding: XRMediaBinding | null = null;
  private mediaLayer: XREquirectLayer | null = null;
  private usingMediaLayer = false;
  // Recenter yaw applied to the video, preserved across media-layer rebuilds.
  private videoYaw = 0;
  private opts: IXRSessionManagerOptions;
  private debug: Set<string>;
  private onSessionEnd = () => this.handleEnd();
  // Promote to the media layer once the <video> has real dimensions. The layer
  // constructors throw on a zero-size video, so on a cold session start (or a
  // scene switch) we begin on the dome and switch over when metadata loads.
  // Guarded by a generation counter to prevent stale callbacks from firing
  // after dispose() or a scene switch that rebinds the video element.
  private mediaGen = 0;
  private onVideoReady = () => {
    const gen = this.mediaGen;
    const v = this.opts.video;
    // Switch-crash probe: the media→media switch is the path that hard-crashes
    // the Quest compositor. Record the exact gating inputs — flushed now so the
    // row survives a GPU-process kill — to prove whether this callback rebuilds
    // the layer for the new stream or the `!usingMediaLayer` guard skips it.
    vrLog.note("videoready", {
      using: this.usingMediaLayer ? 1 : 0,
      vw: v.videoWidth,
      vh: v.videoHeight,
      wants: this.wantsMediaLayer(this.projection) ? 1 : 0,
      gen,
      mediaGen: this.mediaGen,
    });
    vrLog.flushNow();
    if (
      this.session &&
      !this.usingMediaLayer &&
      v.videoWidth > 0 &&
      this.wantsMediaLayer(this.projection) &&
      gen === this.mediaGen
    ) {
      this.rebuildVideoProjection();
    }
  };
  private tmpVec = new THREE.Vector3();
  private tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");

  // Collapsible Handy (interactive device) sub-panel, toggled from the bar.
  private handyPanel: VRHandyPanel | null = null;
  private handyPanelOpen = false;
  // Scene-info side panel (performers, tags, chapters), toggled via Browse.
  private infoPanel: VRInfoPanel | null = null;
  // VR scenes side panel with scene cards, toggled via Browse.
  private scenesPanel: VRScenesPanel | null = null;
  private browseOpen = false;
  // Server-paged data source behind the Browse "Scenes" carousel (VR-only,
  // newest first, excluding the now-playing scene). Replaces the old fixed-50
  // in-memory list + client-side splice.
  private carouselData = new VRCarouselLibrary();
  private previewVideo: HTMLVideoElement | null = null;
  private previewSceneId: string | null = null;
  // Hover-preview debounce: the card the ray is currently over and the timer
  // that commits its <video> load only after the hover settles. Sweeping the
  // ray across the wall must not thrash the media element (see updateHoverPreview).
  private previewPendingId: string | null = null;
  private previewHoverTimer: number | null = null;
  private hittables: IHittable[] = [];
  private baseHittables: IHittable[] = [];
  // Immersive Home wall (with merged filter rail) + ambient backdrop (Option 2).
  private homePanel: VRHomePanel | null = null;
  private backdrop: VRLobbyBackdrop | null = null;
  // XR gallery viewer (thumbnail grid + lightbox), shown over the Home wall when
  // a gallery is opened from the Galleries content mode.
  private galleryViewer: VRGalleryViewerPanel | null = null;
  private galleryData: IVRGalleryDataSource | null = null;
  // True while the gallery viewer is showing (Home wall hidden behind it).
  private galleryOpen = false;
  // Server-backed Movies (groups) library. The Movies grid pages movie posters
  // and, once a movie is drilled into in-wall, that movie's scenes — both
  // through this source. There is no separate viewer panel: the Home wall itself
  // swaps to the movie's scene grid.
  private groupData: IVRGroupDataSource | null = null;
  // Server-backed FapTap library (premium add-on). Swapped in for `homeData`
  // behind the scene grid while the FapTap content mode is active.
  private faptapData: IVRHomeDataSource | null = null;
  // True while the FapTap content mode is showing (its source feeds the grid).
  private faptapMode = false;
  // Cinema room shown when a flat (non-VR) scene is playing.
  private lobbyMode = false;
  // Server-backed Home library (paged). The manager owns the live query state
  // (sort + media + studio/performer) and orchestrates page/count/rail fetches.
  private homeData: IVRHomeDataSource | null = null;
  private homeFilter: {
    kind: "studio" | "performer" | "tag";
    id: string;
  } | null = null;
  private mediaFilter: VRMediaFilter = "all";
  private sortMode: VRSortMode = "recent";
  // Cached rail lists, kept for resolving a tapped filter's display label.
  private railStudios: IVRFilterEntry[] = [];
  private railPerformers: IVRFilterEntry[] = [];
  // Thumbstick lobby-nav edge-trigger arms.
  private lobbyHArmed = true;
  private lobbyVArmed = true;
  // Reused per-frame draw payload (avoids allocating an object every frame).
  private drawInput: IDrawInput;

  // Auto-hide fade state. The UI is world-anchored (never head-follows) and is
  // moved only by grabbing it; it just fades out after a spell of no input.
  private uiOpacity = 1;
  private lastActivity = 0;
  private placed = false;

  // XR frame-time telemetry (only computed while vrLog is active). Distinguishes
  // a render-side hitch (long JS frames here) from a compositor/cadence stutter
  // (frames stay smooth here but the headset still judders).
  private frameLast = 0;
  private frameAccum = 0;
  private frameCount = 0;
  private frameMax = 0;
  private frameLong = 0;
  private frameReportAt = 0;

  // ── Jitter profiler (active only when vrLog.profile === "jitter") ─────────
  // Splits each frame's wall-time into render (our scene draw + texture upload)
  // vs everything-else (compositor/decode/GC between callbacks), adds the GPU
  // time of the render, and tracks decode-frame drops — so a playback hitch can
  // be attributed to a concrete cause rather than guessed at. Inert otherwise.
  private gpuTimer: GpuTimer | null = null;
  private jFrameLast = 0;
  private jReportAt = 0;
  private jDt: number[] = [];
  private jRender: number[] = [];
  private jOutside: number[] = [];
  private jGpu: number[] = [];
  private jHitchN = 0;
  private jUploadN = 0;
  private jDropLast = -1;
  private jDropSum = 0;
  // Scene-switch leak probe: counts in-VR switches so a resource snapshot can be
  // tied to "after the Nth switch". The crash repro is a hard OOM after 2–3
  // switches, so we log GL-resource + JS-heap counts to prove which class climbs.
  private jSwitchCount = 0;
  // Previous frame's phase split — the work that filled the interval ending at
  // the current frame, so a hitch is attributed to what actually caused it.
  private jPrev = { input: 0, ui: 0, render: 0, total: 0, upload: false };

  /**
   * Performance auto-throttle: tracks a rolling window of frame durations and
   * downgrades visual quality when sustained hitches are detected. This keeps
   * the experience playable on Quest 3 under load (fisheye190, 4K video, many
   * UI panels open). Throttle levels:
   *   0 = full quality (default)
   *   1 = reduced — skip dome texture uploads every other frame
   *   2 = minimum — force single-buffer canvas panels, skip backdrop
   */
  private throttleLevel = 0;
  private throttleHitches = 0;
  private throttleWindowStart = 0;
  // Throttle timer: reduce level by 1 every THROTTLE_DECAY_MS of smooth frames.
  private throttleDecayAccum = 0;

  // Video frame dedup: skip redundant VideoTexture.needsUpdate when the decoded
  // frame hasn't advanced, sparing the GPU upload pipeline. Tracks whether
  // video.currentTime has increased since the last upload.
  private lastUploadedFrame = -1;
  private uploadSkipCount = 0;

  // Scrubber-hover thumbnail preview (floats above the panel scrubber).
  private thumbPreview: THREE.Mesh;
  private thumbCanvas: HTMLCanvasElement;
  private thumbCtx: CanvasRenderingContext2D | null;
  private thumbTexture: THREE.CanvasTexture;
  private getThumb: ((time: number) => IThumbnailCrop | null) | null;
  private lastThumbKey: string | null = null;

  constructor(opts: IXRSessionManagerOptions) {
    this.opts = opts;
    this.projection = opts.projection;
    this.debug = readVrDebug();
    if (this.debug.size) {
      // eslint-disable-next-line no-console
      console.info("[VR debug] flags:", [...this.debug].join(", "));
    }

    // Transparent context so three's XR projection layer (UI + controllers) can
    // be alpha-composited ON TOP of the WebXR media video layer. The clear ALPHA
    // is set per-frame-path in syncRenderStateLayers: 0 only while the media
    // layer is actually compositing beneath, else opaque black — a transparent
    // buffer makes the Quest compositor show black tiles in disoccluded regions
    // when it reprojects a late frame, so we keep the dome/lobby paths opaque.
    // The `opaque` debug flag forces the pre-media-layer renderer for A/B.
    const transparent = !this.debug.has("opaque");
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.debug.has("noaa"),
      alpha: transparent,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, transparent ? 0 : 1);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType("local-floor");
    this.renderer.domElement.style.display = "none";
    opts.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
    // So the flat (non-immersive) preview shows the left eye.
    this.camera.layers.enable(1);

    this.videoGroup = new THREE.Group();
    this.uiGroup = new THREE.Group();
    this.scene.add(this.videoGroup);
    this.scene.add(this.uiGroup);

    this.videoTexture = new THREE.VideoTexture(opts.video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.videoTexture.magFilter = THREE.LinearFilter;
    this.videoTexture.generateMipmaps = false;

    // The control bar is now the single consolidated UI surface: it carries the
    // performers carousel and the tag/chapter strips that used to be separate
    // side "monitor" panels.
    this.panel = new VRControlPanel();
    this.uiGroup.add(this.panel.object);
    this.drawInput = {
      state: opts.getState(),
      projection: this.projection,
      markers: opts.getMarkers(),
      chapterTitle: null,
      caption: null,
      handyOpen: false,
      browseOpen: false,
      handy: undefined,
    };

    // Compact Handy panel — LEFT side, angled inward (+Y rotation).
    const handy = new VRHandyPanel();
    this.handyPanel = handy;
    this.uiGroup.add(handy.object);
    this.layoutHandyPanel(handy);
    handy.setRenderState(0);

    // Info panel — RIGHT peripheral slot (performers + tags).
    const infoPane = new VRInfoPanel(opts.info);
    this.infoPanel = infoPane;
    this.uiGroup.add(infoPane.object);
    this.layoutSidePanel(infoPane, "right");
    infoPane.setRenderState(0);

    // Scenes panel — LEFT peripheral slot (vertical carousel). Both peripheral
    // panels show together when Browse is open, flanking the main bar.
    const scenesPane = new VRScenesPanel();
    this.scenesPanel = scenesPane;
    this.uiGroup.add(scenesPane.object);
    this.layoutSidePanel(scenesPane, "left");
    scenesPane.setRenderState(0);
    // Server-page the carousel: the panel pulls pages lazily through this
    // requester as the user scrolls. The exclude (now-playing scene) + the
    // initial page-0 load are kicked from updateCurrentSceneId.
    scenesPane.setPageRequester((pageIndex) =>
      this.fetchCarouselPage(pageIndex)
    );

    // Home wall — large curved central gallery for lobby mode (Option 2).
    const home = new VRHomePanel();
    this.homePanel = home;
    this.uiGroup.add(home.object);
    this.layoutHomePanel(home);
    home.setRenderState(0);
    if (opts.homeSettings) home.setSettings(opts.homeSettings);

    this.lobbyMode = !!opts.lobby;

    // Slideshow backdrop — additive environment (never touches the main dome).
    this.backdrop = new VRLobbyBackdrop();
    this.scene.add(this.backdrop.object);
    this.backdrop.setVisible(this.lobbyMode);

    // Flat (2D) scenes play on a bare curved screen floating in darkness — no
    // theatre dressing or glow frame (intentionally minimal for comfort).

    // Wire the server-backed Home library: inject the page requester, seed the
    // initial query (so counts/pages start loading) and fetch the filter rail.
    this.homeData = opts.homeData ?? null;
    home.setPageRequester((pageIndex) => this.fetchHomePage(pageIndex));
    if (this.homeData) {
      this.applyHomeQuery();
      this.loadHomeRail();
    }

    // Premium FapTap content mode. Probe the sidecar status once; the tab stays
    // locked until/unless its database is present.
    this.faptapData = opts.faptapData ?? null;
    if (this.faptapData) {
      fetchFaptapStatus()
        .then((s) => this.homePanel?.setFaptapAvailable(s.available))
        .catch(() => undefined);
    }

    // Galleries content mode + XR gallery viewer. The Home wall pages galleries
    // through this requester; the viewer pages an active gallery's images.
    this.galleryData = opts.galleryData ?? null;
    home.setGalleryPageRequester((pageIndex) =>
      this.fetchGalleryPage(pageIndex)
    );
    const viewer = new VRGalleryViewerPanel();
    this.galleryViewer = viewer;
    this.uiGroup.add(viewer.object);
    this.layoutHomePanel(viewer);
    viewer.setRenderState(0);
    viewer.setPageRequester((pageIndex) =>
      this.fetchGalleryImagePage(pageIndex)
    );

    // Movies content mode. The Home wall pages movie posters through one
    // requester and a drilled-in movie's scenes through the other; the query is
    // seeded lazily when the user switches into Movies mode (see dispatchAction).
    this.groupData = opts.groupData ?? null;
    home.setGroupPageRequester((pageIndex) => this.fetchGroupPage(pageIndex));
    home.setGroupScenePageRequester((pageIndex) =>
      this.fetchGroupScenePage(pageIndex)
    );

    // Preview video for scenes hover — one element, reassigned on hover change.
    this.previewVideo = document.createElement("video");
    this.previewVideo.muted = true;
    this.previewVideo.loop = true;
    this.previewVideo.playsInline = true;

    this.input = new VRControllerInput(this.renderer, this.scene, {
      onHover: (hit) => this.routeHover(hit),
      onSelect: (hit) => this.routeSelect(hit),
      onSelectMove: (hit) => this.routeSelectMove(hit),
      onSelectEnd: (hit) => this.routeSelectEnd(hit),
      onScrub: (seconds) =>
        this.opts.onAction({ type: "seekRelative", seconds }),
      onRecenter: () => this.recenter(),
      onClap: () => {
        // Clap gesture: show the UI panels immediately.  This is the primary
        // way users bring the controls back up during playback — unlike hand
        // movement (which is constant during VR playback), a deliberate two-
        // hand-together gesture is unambiguous.
        this.lastActivity = performance.now();
        this.uiOpacity = 1;
      },
    });

    // Visible Touch controllers + tracked-hand meshes. Purely cosmetic — pointing
    // and select still flow through VRControllerInput's target-ray pipeline above
    // (which Meta also drives for hands via the emulated ray + pinch button).
    this.deviceModels = new VRDeviceModels(this.renderer, this.scene);

    // Base hittables: bar + handy always present. The active Browse panels (or,
    // in lobby mode, the Home wall) are layered on top by rebuildBrowseHittables.
    this.baseHittables = [
      {
        target: this.panel.hitTarget,
        hover: (uv) => this.panel.setHovered(uv),
        select: (uv) => this.panel.activate(uv),
      },
    ];
    if (this.handyPanel) {
      const hp = this.handyPanel;
      this.baseHittables.push({
        target: hp.hitTarget,
        hover: (uv: THREE.Vector2 | null) => hp.setHovered(uv),
        select: (uv: THREE.Vector2) => hp.activate(uv),
        move: (uv: THREE.Vector2) => hp.pointerMove(uv),
        up: (uv: THREE.Vector2) => hp.pointerUp(uv),
      });
    }
    this.rebuildBrowseHittables();
    // Pinned by default → grip grabs/drags the UI group (squeeze elsewhere
    // still recenters).
    this.input.setDraggable(this.uiGroup, true);

    // Thumbnail preview quad (child of the UI group so it rides the panel).
    this.getThumb = opts.getThumbnail ?? null;
    this.thumbCanvas = document.createElement("canvas");
    this.thumbCanvas.width = THUMB_CANVAS_W;
    this.thumbCanvas.height = THUMB_CANVAS_H;
    this.thumbCtx = this.thumbCanvas.getContext("2d");
    this.thumbTexture = new THREE.CanvasTexture(this.thumbCanvas);
    this.thumbTexture.colorSpace = THREE.SRGBColorSpace;
    this.thumbTexture.minFilter = THREE.LinearFilter;
    this.thumbTexture.magFilter = THREE.LinearFilter;
    this.thumbTexture.generateMipmaps = false;
    this.thumbPreview = new THREE.Mesh(
      new THREE.PlaneGeometry(THUMB_W_M, THUMB_H_M),
      new THREE.MeshBasicMaterial({
        map: this.thumbTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      })
    );
    this.thumbPreview.renderOrder = 12;
    this.thumbPreview.frustumCulled = false;
    this.thumbPreview.visible = false;
    this.uiGroup.add(this.thumbPreview);

    // Seed throttle timestamps so the first second of startup doesn't trigger
    // false escalations from the initialisation burst (longtasks, dome build,
    // video metadata load).
    this.throttleWindowStart = performance.now();

    this.buildDome();
  }

  /** Handy panel: centred below the main bar, tilted up toward the viewer. */
  private layoutHandyPanel(panel: VRHandyPanel) {
    const barHalfH = this.panel.heightMeters / 2;
    const gapM = 0.06;
    panel.object.position.set(
      0,
      -(barHalfH + gapM + panel.heightMeters / 2),
      SIDE_PANEL_FORWARD * 0.5
    );
    // Tilt the top edge back so a below-eye-level panel faces up at the viewer.
    panel.object.rotation.set(HANDY_TILT, 0, 0);
  }

  /**
   * Place a peripheral panel beside the bar, angled ~40° inward. Both side
   * panels share dimensions, so left/right are mirror images for symmetry.
   */
  private layoutSidePanel(
    panel: VRInfoPanel | VRScenesPanel,
    side: "left" | "right"
  ) {
    const sign = side === "left" ? -1 : 1;
    const angle = Math.PI / 4.5; // inward yaw (~40°)
    const barHalf = this.panel.widthMeters / 2;
    const gapM = 0.02;
    // Inward rotation foreshortens the panel's X footprint, so offset by the
    // *projected* half-width — this lets the inner edge sit nearly touching the
    // bar rather than floating out at the full half-width.
    const x = barHalf + gapM + (panel.widthMeters / 2) * Math.cos(angle);
    panel.object.position.set(sign * x, 0, SIDE_PANEL_FORWARD);
    // Left panel faces right (+Y), right panel faces left (−Y) — both inward.
    panel.object.rotation.set(0, -sign * angle, 0);
  }

  /** Place the Home wall / gallery viewer centred in front of the viewer. */
  private layoutHomePanel(panel: VRCanvasPanel) {
    // uiGroup is dropped PANEL_DROP below eye level for the control bar; raise the
    // wall back toward eye height (but a touch *below* it, so its top doesn't
    // overshoot the gaze and force an upward head tilt) and push it a touch
    // further than the bar so the large surface sits in the central field of view.
    panel.object.position.set(0, PANEL_DROP - 0.15, -0.25);
  }

  /**
   * The lobby environment is now provided by [VRLobbyBackdrop] — a video
   * slideshow dome with gradient sky shell and floor grid. The old static
   * `buildLobbyEnv()` and `makeGradientTexture()` were removed; VRLobbyBackdrop
   * owns those in a self-contained class.
   */

  private rebuildBrowseHittables() {
    // Lobby mode: only the Home wall is interactable (the hidden bar/side panels
    // must leave the raycast target set — three.js raycasts invisible meshes too).
    if (this.lobbyMode) {
      // The Home wall is the only interactable surface (it now hosts the filter
      // rail too) — unless a gallery is open, in which case the gallery viewer
      // takes over. The hidden bar/side panels must leave the raycast target set.
      const active: VRCanvasPanel | null = this.galleryOpen
        ? this.galleryViewer
        : this.homePanel;
      this.hittables = active
        ? [
            {
              target: active.hitTarget,
              hover: (uv: THREE.Vector2 | null) => active.setHovered(uv),
              select: (uv: THREE.Vector2) => active.activate(uv),
              move: (uv: THREE.Vector2) => active.pointerMove(uv),
              up: (uv: THREE.Vector2) => active.pointerUp(uv),
            },
          ]
        : [];
      this.input.setTargets(this.hittables.map((h) => h.target));
      return;
    }
    // Playback: bar + handy always; both peripheral Browse panels when open.
    this.hittables = [...this.baseHittables];
    if (this.browseOpen) {
      for (const panel of [this.scenesPanel, this.infoPanel]) {
        if (!panel) continue;
        const ap = panel;
        this.hittables.push({
          target: ap.hitTarget,
          hover: (uv: THREE.Vector2 | null) => ap.setHovered(uv),
          select: (uv: THREE.Vector2) => ap.activate(uv),
          move: (uv: THREE.Vector2) => ap.pointerMove(uv),
          up: (uv: THREE.Vector2) => ap.pointerUp(uv),
        });
      }
    }
    this.input.setTargets(this.hittables.map((h) => h.target));
  }

  /** Attach an already-requested immersive session and start rendering. */
  async init(session: XRSession): Promise<void> {
    this.session = session;
    session.addEventListener("end", this.onSessionEnd);
    await this.renderer.xr.setSession(session);
    this.input.setSession(session);
    // Re-attempt the media layer once the video has dimensions / on scene switch.
    this.opts.video.addEventListener("loadedmetadata", this.onVideoReady);
    this.opts.video.addEventListener("loadeddata", this.onVideoReady);
    this.opts.video.addEventListener("resize", this.onVideoReady);
    try {
      this.renderer.xr.setFoveation(this.debug.has("nofov") ? 0 : 0.5);
    } catch {
      /* not supported — ignore */
    }
    // The session, reference space and three's projection layer all exist now,
    // so pick the video path: WebXR media layer (default) or the shader dome.
    this.rebuildVideoProjection();
    // Spin up the GPU timer-query only when the jitter profiler is active, so
    // the normal render path never issues a single extra GL call.
    if (vrLog.profile === "jitter") {
      const gl = this.renderer.getContext();
      this.gpuTimer = new GpuTimer(gl);
      vrLog.note("jprofile", {
        gpu: this.gpuTimer.supported,
        webgl2:
          typeof WebGL2RenderingContext !== "undefined" &&
          gl instanceof WebGL2RenderingContext,
      });
    }
    // Pre-warm the floating UI before the render loop starts, so opening the menu
    // doesn't pay shader-compile + first-rasterize + first-upload on a live frame
    // (was a ~650ms hitch on first open). Cost is hidden behind the session fade-in.
    await this.prewarmUI();
    this.renderer.setAnimationLoop(this.render);
  }

  /**
   * Eagerly compile every material's shader program and force the first draw +
   * texture upload of each hidden Browse panel. Panels stay `mesh.visible=false`
   * until opened, which otherwise defers all of that GPU work to the single XR
   * frame the user opens the menu on. Run once during init while the loader is up.
   */
  private async prewarmUI(): Promise<void> {
    // Side/Browse/Handy/Home panels: parameterless draw() — safe to rasterize +
    // upload now. (The control bar is driven by sync(input) each frame and is
    // visible from the start, so its first draw lands on an early hidden frame;
    // its shader is still covered by compileAsync below.)
    for (const p of [
      this.infoPanel,
      this.scenesPanel,
      this.handyPanel,
      this.homePanel,
      this.galleryViewer,
    ]) {
      try {
        p?.prewarm(this.renderer);
      } catch {
        /* a panel without seeded data — first render will draw it lazily */
      }
    }
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* compileAsync unsupported on this runtime — lazy compile on first render */
    }
  }

  setProjection(projection: IProjectionSettings) {
    this.projection = projection;
    this.rebuildVideoProjection();
  }

  /**
   * Release the live compositor video layer BEFORE the React layer drains and
   * re-points the <video> element on an in-VR scene switch.
   *
   * A WebXR media layer samples the <video> directly, so tearing the element's
   * source out from under a bound layer (`removeAttribute('src'); load()`) hard-
   * crashes the Quest compositor — proven via vrlog: a media→media switch faults
   * synchronously at the drain, with the stale layer still in renderState and no
   * teardown logged (`buildMediaLayer` defers on the 0×0 video before reaching
   * `destroyMediaLayer`, and `onVideoReady`'s `!usingMediaLayer` guard blocks the
   * rebuild). Dropping to the shader dome here detaches the compositor; the new
   * stream's `onVideoReady` then rebuilds a fresh media layer — the same path the
   * known-good first scene load already takes.
   *
   * No-op on the dome path (the VideoTexture upload tolerates an emptied video).
   */
  prepareSourceSwap() {
    if (!this.usingMediaLayer) return;
    // Invalidate any in-flight onVideoReady from the outgoing stream.
    this.mediaGen++;
    this.destroyMediaLayer();
    this.usingMediaLayer = false;
    // Fall back to the dome so there's always an active video path (never a
    // black void) while the new source loads; onVideoReady promotes it back to
    // the media layer once metadata arrives.
    this.buildDome();
    // Push the video-less layer stack so the compositor stops referencing the
    // <video> the React layer is about to drain.
    this.syncRenderStateLayers();
    vrLog.note("source_swap_prep", {});
    vrLog.flushNow();
  }

  /** Update the info panel with new scene metadata after an in-VR scene switch. */
  updateSceneInfo(info: IVRSceneInfo) {
    if (this.infoPanel) {
      // Remove the old object from the scene BEFORE disposing its GPU resources,
      // otherwise the disposed mesh lingers in uiGroup for one frame and causes
      // the "flicker between old and new scene info" visual glitch.
      this.uiGroup.remove(this.infoPanel.object);
      this.infoPanel.dispose();
      const newPane = new VRInfoPanel(info);
      this.uiGroup.add(newPane.object);
      this.layoutSidePanel(newPane, "right");
      newPane.setRenderState(this.browseOpen ? this.uiOpacity : 0);
      // Rasterize + upload the new panel's texture now (its shader is already
      // compiled from init), so re-opening Browse after a switch stays cheap.
      try {
        newPane.prewarm(this.renderer);
      } catch {
        /* not yet drawable — falls back to lazy first-render */
      }
      this.infoPanel = newPane;
      this.rebuildBrowseHittables();
    }
    // Leak probe: this runs once per in-VR scene switch. Snapshot GL + heap
    // counts right after the old panel/dome were disposed and the new ones
    // built, so a monotonic climb across switches pinpoints the undisposed
    // class before the OOM crash (repro: hard crash after 2–3 switches).
    this.jSwitchCount++;
    this.emitResourceSnapshot("switch");
  }

  /** Fetch a carousel page from the pager and append it (gen-guarded). */
  private fetchCarouselPage(pageIndex: number) {
    this.carouselData
      .getPage(pageIndex)
      .then((res) => {
        // Drop stale results that resolve after the now-playing scene changed.
        if (res.gen !== this.carouselData.gen) return;
        this.scenesPanel?.appendPage(res.pageIndex, res.scenes, res.totalCount);
      })
      .catch(() => undefined);
  }

  /** Close the Browse side panels (called after an in-VR scene switch). */
  closeBrowse() {
    if (this.browseOpen) {
      this.browseOpen = false;
      this.rebuildBrowseHittables();
    }
  }

  /** Tell the scenes panel which scene is currently playing (for the Now Playing badge). */
  updateCurrentSceneId(id: string) {
    this.scenesPanel?.setCurrentSceneId(id);
    this.homePanel?.setCurrentSceneId(id);
    // Re-page the carousel to exclude the now-playing scene (server-side), so it
    // never needs the old client-side splice. Only reset the panel when the
    // exclude actually changed (resetLibrary clears + lazily re-kicks page 0).
    const before = this.carouselData.gen;
    this.carouselData.setExcludeId(id || null);
    if (this.carouselData.gen !== before) this.scenesPanel?.resetLibrary();
  }

  /**
   * Toggle the immersive Home/lobby wall. Lobby mode shows the Home gallery +
   * gradient environment and hides the playback bar; leaving it reveals the
   * dome + bar for the just-launched scene.
   */
  setLobbyMode(on: boolean) {
    if (this.lobbyMode === on) return;
    this.lobbyMode = on;
    if (on) {
      this.browseOpen = false;
      this.handyPanelOpen = false;
    }
    // Reset the shared hover-preview <video> across the mode change.
    this.previewSceneId = null;
    this.previewPendingId = null;
    if (this.previewHoverTimer !== null) {
      window.clearTimeout(this.previewHoverTimer);
      this.previewHoverTimer = null;
    }
    if (this.previewVideo) this.previewVideo.pause();
    this.backdrop?.setVisible(on);
    if (on) {
      this.thumbPreview.visible = false;
      // Hide the video screen (dome/flat-screen meshes) in lobby so it doesn't
      // bleed through behind the home wall.
      for (const m of this.domeMeshes) m.visible = false;
    } else {
      // Restore the video screen meshes for the just-launched scene.
      for (const m of this.domeMeshes) m.visible = true;
    }
    // Drop/restore the media video layer from the compositor render state so the
    // home wall isn't backed by the (now paused) scene video while in the lobby.
    this.syncRenderStateLayers();
    this.rebuildBrowseHittables();
    this.lastActivity = performance.now();
  }

  /** Fetch a Home grid page from the pager and push it to the wall (gen-guarded). */
  private fetchHomePage(pageIndex: number) {
    const ds = this.sceneData;
    if (!ds) return;
    ds.getPage(pageIndex)
      .then((res) => {
        // Drop stale results that resolve after a query change.
        if (res.gen !== ds.gen) return;
        this.homePanel?.setPageData(res.pageIndex, res.scenes, res.totalCount);
      })
      .catch(() => undefined);
  }

  // ── Galleries content mode + XR gallery viewer ──────────────────────────────

  /** Fetch a Galleries grid page and push it to the Home wall (gen-guarded). */
  private fetchGalleryPage(pageIndex: number) {
    const ds = this.galleryData;
    if (!ds) return;
    ds.getGalleryPage(pageIndex)
      .then((res) => {
        if (res.gen !== ds.gen) return;
        this.homePanel?.setGalleryPageData(
          res.pageIndex,
          res.galleries,
          res.totalCount
        );
      })
      .catch(() => undefined);
  }

  /**
   * Push the current sort + studio/performer/tag filter to the gallery pager and
   * reset the gallery grid. Galleries ignore the media toggle. The first page is
   * pulled lazily by the wall's own page-load loop while in Galleries mode.
   */
  private applyGalleryQuery() {
    const ds = this.galleryData;
    if (!ds) return;
    ds.setQuery({
      sort: this.sortMode,
      mediaFilter: this.mediaFilter,
      filter: this.homeFilter,
    });
    this.homePanel?.resetGalleryLibrary();
  }

  /** Fetch a page of the active gallery's images and push it to the viewer. */
  private fetchGalleryImagePage(pageIndex: number) {
    const ds = this.galleryData;
    if (!ds) return;
    ds.getImagePage(pageIndex)
      .then((res) => {
        if (res.gen !== ds.gen) return;
        this.galleryViewer?.setPageData(
          res.pageIndex,
          res.images,
          res.totalCount
        );
      })
      .catch(() => undefined);
  }

  /** Open the XR gallery viewer for a gallery: scope image paging + show it. */
  private openGallery(galleryId: string, title?: string) {
    const ds = this.galleryData;
    const viewer = this.galleryViewer;
    if (!ds || !viewer) return;
    ds.setActiveGallery(galleryId);
    // Seed the title + a provisional count; the real total arrives with page 0.
    viewer.open(title ?? "Gallery", 0);
    ds.getImageTotal()
      .then((total) => viewer.open(title ?? "Gallery", total))
      .catch(() => undefined);
    this.galleryOpen = true;
    this.rebuildBrowseHittables();
    this.lastActivity = performance.now();
  }

  /** Close the gallery viewer and return to the Home wall. */
  private closeGallery() {
    if (!this.galleryOpen) return;
    this.galleryOpen = false;
    this.galleryData?.setActiveGallery(null);
    this.rebuildBrowseHittables();
    this.lastActivity = performance.now();
  }

  // ── Movies content mode ─────────────────────────────────────────────────────

  /** Fetch a Movies poster page and push it to the Home wall (gen-guarded). */
  private fetchGroupPage(pageIndex: number) {
    const ds = this.groupData;
    if (!ds) return;
    ds.getGroupPage(pageIndex)
      .then((res) => {
        if (res.gen !== ds.gen) return;
        this.homePanel?.setGroupPageData(
          res.pageIndex,
          res.groups,
          res.totalCount
        );
      })
      .catch(() => undefined);
  }

  /** Fetch a page of the active movie's scenes and push it to the Home wall. */
  private fetchGroupScenePage(pageIndex: number) {
    const ds = this.groupData;
    if (!ds) return;
    ds.getScenePage(pageIndex)
      .then((res) => {
        if (res.gen !== ds.gen) return;
        this.homePanel?.setGroupScenePageData(
          res.pageIndex,
          res.scenes,
          res.totalCount
        );
      })
      .catch(() => undefined);
  }

  /**
   * Push the current sort + studio/performer filter to the movie pager and reset
   * the movie poster grid. Movies ignore the media toggle. The first page is
   * pulled lazily by the wall's own page-load loop while in Movies mode.
   */
  private applyGroupQuery() {
    const ds = this.groupData;
    if (!ds) return;
    ds.setQuery({
      sort: this.sortMode,
      mediaFilter: this.mediaFilter,
      filter: this.homeFilter,
    });
    this.homePanel?.resetGroupLibrary();
  }

  /**
   * Push the current sort + media + studio/performer query to the pager, reset
   * the wall's page window, and refresh the media-type counts. The first page
   * (and neighbours) are pulled lazily by the panel's own page-load loop.
   */
  /**
   * The data source currently feeding the scene grid: the FapTap library while
   * its content mode is active, otherwise the Stash Home library. Both satisfy
   * IVRHomeDataSource, so every scene-grid orchestration method (page / counts /
   * rail / next) routes through this transparently.
   */
  private get sceneData(): IVRHomeDataSource | null {
    return this.faptapMode ? this.faptapData : this.homeData;
  }

  private applyHomeQuery() {
    const ds = this.sceneData;
    if (!ds) return;
    ds.setQuery({
      sort: this.sortMode,
      mediaFilter: this.mediaFilter,
      filter: this.homeFilter,
    });
    this.homePanel?.resetLibrary();
    this.refreshHomeCounts();
  }

  /** Refresh the rail media-type counts under the active studio/performer filter. */
  private refreshHomeCounts() {
    const ds = this.sceneData;
    if (!ds) return;
    const { gen } = ds;
    ds.getCounts()
      .then((c) => {
        if (ds.gen !== gen) return;
        this.homePanel?.setSceneCounts(c.all, c.vr, c.flat, c.funscript);
      })
      .catch(() => undefined);
  }

  /** Fetch the top studios + performers for the filter rail (once per session). */
  private loadHomeRail() {
    const ds = this.sceneData;
    if (!ds) return;
    ds.getRail()
      .then((rail) => {
        this.railStudios = rail.studios;
        this.railPerformers = rail.performers;
        this.homePanel?.setFilterData(rail.studios, rail.performers);
      })
      .catch(() => undefined);
  }

  setHeatmap(cssUrl: string | null) {
    this.panel.setHeatmap(cssUrl);
  }

  /** Push updated immersive-Home preferences to the Home wall. */
  setHomeSettings(settings: IVRHomeSettings) {
    this.homePanel?.setSettings(settings);
  }

  /** Forward stroke-zone confirmation state to the Handy panel (React-driven). */
  setHandyStrokeStatus(status: VRStrokeStatus) {
    this.handyPanel?.setStrokeStatus(status);
  }

  /**
   * Apply a home-filter (studio/performer/tag) and re-query the wall.
   * `explicitLabel` is used for filters that can't be resolved from the cached
   * rail lists (tags, or a performer/studio outside the top-N rail) — e.g. a
   * drill-down tap on an info-panel chip, which passes the name directly.
   */
  private applyHomeFilter(
    filter: { kind: "studio" | "performer" | "tag"; id: string } | null,
    explicitLabel?: string
  ) {
    this.homeFilter = filter;
    // Only studio/performer filters highlight a rail tile; tags aren't in the rail.
    this.homePanel?.setActiveFilter(
      filter && filter.kind !== "tag" ? filter.id : null
    );
    // Prefer an explicit label; otherwise resolve from the cached rail lists.
    let label: string | null = explicitLabel ?? null;
    if (!label && filter && filter.kind !== "tag") {
      const list =
        filter.kind === "studio" ? this.railStudios : this.railPerformers;
      label = list.find((e) => e.id === filter.id)?.name ?? null;
    }
    this.homePanel?.setFilterLabel(label);
    this.applyHomeQuery();
  }

  /**
   * Returns the ID of the scene that comes after `currentId` in the current
   * filtered + sorted home list — used by ImmersiveVRPlayer for auto-advance.
   */
  getNextSceneId(currentId: string): Promise<string | null> {
    const ds = this.sceneData;
    if (!currentId || !ds) return Promise.resolve(null);
    return ds.getNextSceneId(currentId);
  }

  /** Re-orient the video so the current gaze direction becomes its centre. */
  recenter() {
    const cam = this.renderer.xr.getCamera();
    this.tmpEuler.setFromQuaternion(cam.quaternion, "YXZ");
    this.videoYaw = this.tmpEuler.y;
    // Shader-dome path: rotate the mesh group.
    this.videoGroup.rotation.y = this.videoYaw;
    // Media-layer path: rotate the equirect layer's transform (the flat quad is
    // a fixed screen in front of the viewer and isn't recentred).
    if (
      this.usingMediaLayer &&
      this.mediaLayer &&
      this.projection.fov !== "flat"
    ) {
      (this.mediaLayer as XREquirectLayer).transform = this.equirectTransform();
    }
  }

  end() {
    this.session?.end().catch(() => undefined);
  }

  // --- hit routing ----------------------------------------------------------

  private routeHover(hit: IPanelHit | null) {
    for (const h of this.hittables) {
      h.hover(hit && hit.object === h.target ? hit.uv : null);
    }
    // Drive the hover-preview video for whichever scene-card surface is active.
    if (this.lobbyMode) {
      this.updateHoverPreview(
        this.homePanel,
        this.homePanel?.allLoadedScenes() ?? [],
        true
      );
    } else {
      this.updateHoverPreview(
        this.scenesPanel,
        this.scenesPanel?.allLoadedScenes() ?? [],
        this.browseOpen
      );
    }
  }

  /** Lazily (re)point the shared preview <video> at the hovered card's stream. */
  private updateHoverPreview(
    panel: {
      hoveredSceneId: string | null;
      setPreviewVideo: (v: HTMLVideoElement | null) => void;
    } | null,
    scenes: IVRSceneEntry[],
    active: boolean
  ) {
    if (!panel || !active || !this.previewVideo) return;
    const hoveredId = panel.hoveredSceneId;
    // Already loaded (or already scheduled) for this card — nothing to do.
    if (
      hoveredId === this.previewSceneId &&
      this.previewPendingId === hoveredId
    )
      return;
    if (hoveredId === this.previewPendingId) return;

    // Hover moved to a different target: cancel any load pending for the old one.
    if (this.previewHoverTimer !== null) {
      window.clearTimeout(this.previewHoverTimer);
      this.previewHoverTimer = null;
    }
    this.previewPendingId = hoveredId;

    if (!hoveredId) {
      // Left every card — stop the preview at once (no load, so it's cheap).
      this.previewSceneId = null;
      this.previewVideo.pause();
      panel.setPreviewVideo(null);
      return;
    }

    // Defer the actual src swap until the hover holds on this card for a beat.
    // Assigning `<video>.src` + play() tears down and re-inits the decode
    // pipeline on the main thread — measured as an interaction hitch — so doing
    // it for every card the ray sweeps across thrashes playback. Loading only
    // once the hover settles eliminates the thrash while still previewing on dwell.
    const targetId = hoveredId;
    this.previewHoverTimer = window.setTimeout(() => {
      this.previewHoverTimer = null;
      // Hover moved on (or the panel changed) before the dwell elapsed — skip.
      if (this.previewPendingId !== targetId || !this.previewVideo) return;
      const entry = scenes.find((s) => s.id === targetId);
      // For the Home wall (lobby), use the short preview clip when available
      // (previewUrl) rather than the full stream — faster to load on hover.
      const previewSrc = entry?.previewUrl || entry?.streamUrl;
      if (previewSrc) {
        this.previewSceneId = targetId;
        this.previewVideo.src = previewSrc;
        this.previewVideo.play().catch(() => undefined);
        panel.setPreviewVideo(this.previewVideo);
      }
    }, HOVER_PREVIEW_DWELL_MS);
  }

  private routeSelect(hit: IPanelHit) {
    const h = this.hittables.find((x) => x.target === hit.object);
    if (!h) return;
    const action = h.select(hit.uv);
    if (action) this.dispatchAction(action);
  }

  /** Trigger held + dragged: forward to the pressed panel for drag-scrolling. */
  private routeSelectMove(hit: IPanelHit) {
    const h = this.hittables.find((x) => x.target === hit.object);
    h?.move?.(hit.uv);
  }

  /** Trigger released: a tap on a panel may resolve to an action (navigate). */
  private routeSelectEnd(hit: IPanelHit | null) {
    if (!hit) return;
    const h = this.hittables.find((x) => x.target === hit.object);
    const action = h?.up?.(hit.uv);
    if (action) this.dispatchAction(action);
  }

  private dispatchAction(action: VRControlAction) {
    if (action.type === "handyPanelToggle") {
      this.handyPanelOpen = !this.handyPanelOpen;
      this.lastActivity = performance.now();
      return;
    }
    if (action.type === "browsePanelToggle") {
      this.browseOpen = !this.browseOpen;
      // The carousel self-loads page 0 lazily from its draw loop while Browse is
      // open (no seeding needed — see VRScenesPanel.ensureLoaded).
      this.rebuildBrowseHittables();
      this.lastActivity = performance.now();
      return;
    }
    if (action.type === "setHomeFilter") {
      this.applyHomeFilter(
        action.kind ? { kind: action.kind, id: action.id! } : null,
        action.label
      );
      // Galleries honour the same studio/performer/tag filter as scenes.
      this.applyGalleryQuery();
      // Movies honour the studio/performer filter too.
      this.applyGroupQuery();
      // Drill-down from an info-panel chip happens during playback: surface the
      // now-filtered Home wall so the user actually sees the result. The rail's
      // own filter taps come from lobby mode, where this is a no-op.
      if (!this.lobbyMode) this.opts.onAction({ type: "goHome" });
      this.lastActivity = performance.now();
      return;
    }
    if (action.type === "setMediaFilter") {
      this.mediaFilter = action.filter;
      this.homePanel?.setMediaFilter(action.filter);
      this.applyHomeQuery();
      this.lastActivity = performance.now();
      return;
    }
    if (action.type === "setHomeSort") {
      this.sortMode = action.sort;
      // The panel already reset its page window; re-query all grids under the
      // new sort (galleries + movies share the sort mode).
      this.applyHomeQuery();
      this.applyGalleryQuery();
      this.applyGroupQuery();
      this.lastActivity = performance.now();
      return;
    }
    if (action.type === "setContentMode") {
      // The Home panel already flipped its own mode; seed the relevant query so
      // its grid pages start loading when switching modes.
      this.faptapMode = action.mode === "faptap";
      if (action.mode === "galleries") this.applyGalleryQuery();
      else if (action.mode === "movies") this.applyGroupQuery();
      else {
        // Scenes and FapTap share the scene grid but draw from different
        // sources; reset + re-seed from the now-active source (this.sceneData)
        // and refresh the rail to match (Tags/Creators vs Studios/Performers).
        this.applyHomeQuery();
        this.loadHomeRail();
      }
      this.lastActivity = performance.now();
      return;
    }
    if (action.type === "switchScene" && this.faptapMode) {
      // FapTap rows aren't Stash scenes — route the launch to the FapTap player
      // path, which synthesizes a playable scene from the sidecar catalog.
      this.opts.onAction({ type: "switchFapScene", videoId: action.sceneId });
      this.lastActivity = performance.now();
      return;
    }
    if (action.type === "openGallery") {
      this.openGallery(action.galleryId, action.title);
      return;
    }
    if (action.type === "closeGallery") {
      this.closeGallery();
      return;
    }
    if (action.type === "openGroup") {
      // The Home wall already drilled into the movie's scene grid; scope the
      // group library's scene paging so those pages resolve to this movie.
      this.groupData?.setActiveGroup(action.groupId);
      this.lastActivity = performance.now();
      return;
    }
    if (action.type === "closeGroup") {
      this.groupData?.setActiveGroup(null);
      this.lastActivity = performance.now();
      return;
    }
    if (
      action.type === "galleryImageOpen" ||
      action.type === "galleryImageNav" ||
      action.type === "galleryImageClose"
    ) {
      // Lightbox state is handled in-panel; nothing to do at the session level.
      this.lastActivity = performance.now();
      return;
    }
    this.opts.onAction(action);
  }

  // --- video projection (media layer vs shader dome) ------------------------

  /** Is the WebXR Media Binding usable in this build/runtime? */
  private mediaLayersAvailable(): boolean {
    return (
      !this.debug.has("nomedialayer") &&
      typeof XRMediaBinding !== "undefined" &&
      typeof XRRigidTransform !== "undefined"
    );
  }

  /**
   * Is three driving the session through the WebXR Layers API (an
   * `XRProjectionLayer`)? Only then can we add a media layer beneath it; on
   * legacy `XRWebGLLayer` devices we must leave the render state to three and
   * fall back to the shader-dome path.
   */
  private layersApiActive(): boolean {
    const bl = this.renderer.xr.getBaseLayer();
    return (
      typeof XRProjectionLayer !== "undefined" &&
      bl instanceof XRProjectionLayer
    );
  }

  /** Whether this projection should use the compositor media-layer path. */
  private wantsMediaLayer(p: IProjectionSettings): boolean {
    // Only the equirect projections (180 / 360, mono or stereo) use the media
    // layer. Two projections stay on the shader dome:
    //   • fisheye190 — dual-fisheye can't be expressed as a composition layer.
    //   • flat       — the compositor flat layer (quad/cylinder) renders nothing
    //                  on Quest here, and because the layer *constructs* OK we'd
    //                  set usingMediaLayer and never fall back → black void. The
    //                  dome's makeFlatScreen() draws the same curved cinema
    //                  screen via the proven VideoTexture path instead.
    return (
      p.fov !== "fisheye190" &&
      p.fov !== "flat" &&
      this.mediaLayersAvailable() &&
      this.layersApiActive()
    );
  }

  /** Rigid transform encoding the current recenter yaw for the equirect layer. */
  private equirectTransform(): XRRigidTransform {
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, this.videoYaw, 0, "YXZ")
    );
    return new XRRigidTransform(
      { x: 0, y: 0, z: 0 },
      { x: q.x, y: q.y, z: q.z, w: q.w }
    );
  }

  /**
   * Choose and (re)build the active video path. Media layer is the default;
   * fisheye190 (and Layers-less devices) fall back to the shader dome. Called
   * on session entry and whenever the projection settings change in-headset.
   */
  private rebuildVideoProjection() {
    // Bump the media generation so any pending onVideoReady callbacks from
    // stale video metadata events are discarded.
    this.mediaGen++;
    let mediaOk = false;
    if (this.session && this.wantsMediaLayer(this.projection)) {
      try {
        this.buildMediaLayer();
        mediaOk = !!this.mediaLayer;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          "[VR] media layer build failed — falling back to dome",
          err
        );
        vrLog.note("medialayer_error", {
          msg: String((err as Error)?.message ?? err),
          fov: this.projection.fov,
        });
        this.destroyMediaLayer();
      }
    }
    if (mediaOk) {
      // Media layer is live → drop the eye-buffer dome meshes entirely.
      this.clearDome();
      this.usingMediaLayer = true;
    } else {
      // Fisheye, Layers-less runtime, or a build failure → shader dome. Built
      // ONLY once we know the media path won't be used, so we never end up with
      // neither path (which renders as a black void).
      this.destroyMediaLayer();
      this.usingMediaLayer = false;
      this.buildDome();
    }
    vrLog.note("path", {
      path: this.usingMediaLayer ? "media" : "dome",
      fov: this.projection.fov,
      stereo: this.projection.stereo,
      swap: this.projection.swapEyes,
      layersApi: this.layersApiActive(),
      mediaBinding: typeof XRMediaBinding !== "undefined",
    });
    vrLog.flushNow();
    // Diagnostic (visible over chrome://inspect) — which video path won and why.
    // Gated behind any vrDebug flag so production stays quiet.
    if (this.debug.size) {
      // eslint-disable-next-line no-console
      console.info(
        `[VR] video path = ${
          this.usingMediaLayer ? "MEDIA-LAYER" : "shader-dome"
        } ` +
          `(fov=${this.projection.fov}, stereo=${this.projection.stereo}, ` +
          `swap=${
            this.projection.swapEyes
          }, layersApi=${this.layersApiActive()}, ` +
          `mediaBinding=${typeof XRMediaBinding !== "undefined"})`
      );
    }
    this.syncRenderStateLayers();
  }

  /**
   * Create the compositor video layer for the current projection: an equirect
   * layer for 180/360 (with the stereo layout + swap handled natively by the
   * compositor). Flat and fisheye190 never reach here — wantsMediaLayer() keeps
   * them on the shader dome. The viewer's per-frame video upload is skipped
   * while this path is active — the compositor samples the <video> directly.
   *
   * NOTE: forward-facing calibration and the SBS/TB→eye and vertical mapping are
   * the parts most likely to need on-device tuning on Quest 3 (mirrors the
   * fisheye shader's similar note); the equirect default centres on -Z (forward).
   */
  private buildMediaLayer() {
    const session = this.session;
    if (!session) return;
    const refSpace = this.renderer.xr.getReferenceSpace();
    if (!refSpace) {
      // eslint-disable-next-line no-console
      console.warn("[VR] media layer: no reference space yet — using dome");
      return;
    }
    const vid = this.opts.video;
    if (!vid.videoWidth || !vid.videoHeight) {
      // Layer constructors throw on a zero-size video. Defer — onVideoReady
      // re-runs this once metadata loads; we stay on the dome until then.
      vrLog.note("medialayer_defer", {
        vw: vid.videoWidth,
        vh: vid.videoHeight,
      });
      vrLog.flushNow();
      return;
    }
    if (!this.mediaBinding) this.mediaBinding = new XRMediaBinding(session);
    // Switch-crash probe: record whether a previous 8K layer is still live at
    // the instant we destroy + recreate (the transient 2×surface that can OOM
    // the Quest compositor). Flushed so it survives a hard GPU-process kill.
    vrLog.note("medialayer_rebuild", {
      hadLayer: this.mediaLayer ? 1 : 0,
      vw: vid.videoWidth,
      vh: vid.videoHeight,
      fov: this.projection.fov,
      stereo: this.projection.stereo,
    });
    vrLog.flushNow();
    this.destroyMediaLayer();

    const p = this.projection;
    if (this.debug.size) {
      const v = this.opts.video;
      // eslint-disable-next-line no-console
      console.info(
        `[VR] creating media layer: ${p.fov}/${p.stereo} ` +
          `video[ready=${v.readyState}, paused=${v.paused}, ` +
          `${v.videoWidth}x${v.videoHeight}, src=${
            v.currentSrc ? "yes" : "NONE"
          }]`
      );
    }
    vrLog.note("build_medialayer", { fov: p.fov, stereo: p.stereo });
    vrLog.flushNow();
    // Only 180 / 360 reach here — wantsMediaLayer() keeps flat and fisheye190 on
    // the shader dome. The equirect layer handles the stereo layout + swap
    // natively in the compositor; recenter yaw rides in via equirectTransform().
    this.mediaLayer = this.mediaBinding.createEquirectLayer(this.opts.video, {
      space: refSpace,
      layout: layoutForStereo(p.stereo),
      invertStereo: p.swapEyes,
      radius: 0, // 0 = infinite sphere (standard for immersive video)
      centralHorizontalAngle: p.fov === "360" ? 2 * Math.PI : Math.PI,
      upperVerticalAngle: Math.PI / 2,
      lowerVerticalAngle: -Math.PI / 2,
      transform: this.equirectTransform(),
    });
  }

  /** Destroy the current media layer (if any) and forget it. */
  private destroyMediaLayer() {
    if (this.mediaLayer) {
      // Switch-crash probe: confirm destroy() actually fires (and doesn't throw)
      // before a new 8K layer is allocated. Flushed for crash-survival.
      vrLog.note("medialayer_destroy", {});
      vrLog.flushNow();
      try {
        (this.mediaLayer as { destroy?: () => void }).destroy?.();
      } catch {
        /* layer already gone with the session — ignore */
      }
      this.mediaLayer = null;
    }
  }

  /**
   * Push the current layer stack to the session: the media video layer at the
   * bottom (compositor-sampled) with three's projection layer (UI + controllers)
   * on top, or just the projection layer when the video is on the shader dome /
   * hidden in the lobby. No-op on legacy XRWebGLLayer devices (three owns the
   * base layer there).
   */
  private syncRenderStateLayers() {
    const session = this.session;
    if (!session) return;
    const showVideoLayer =
      this.usingMediaLayer && !!this.mediaLayer && !this.lobbyMode;
    // Clear the projection layer transparent ONLY while the media layer is
    // compositing beneath it; otherwise opaque black, so the dome / fisheye /
    // lobby paths don't expose a transparent buffer (which the compositor fills
    // with black tiles when it reprojects a dropped frame). `opaque` flag pins it.
    if (!this.debug.has("opaque")) {
      this.renderer.setClearColor(0x000000, showVideoLayer ? 0 : 1);
    }
    const threeLayer = this.renderer.xr.getBaseLayer();
    if (
      typeof XRProjectionLayer === "undefined" ||
      !(threeLayer instanceof XRProjectionLayer)
    ) {
      return;
    }
    session.updateRenderState({
      layers: showVideoLayer ? [this.mediaLayer!, threeLayer] : [threeLayer],
    });
  }

  // --- resource leak probe --------------------------------------------------

  /**
   * Snapshot of everything that could grow unbounded across in-VR scene
   * switches. `renderer.info` is three's own live GPU-resource accounting:
   * geometries/textures/programs that climb monotonically across switches mean
   * something isn't being disposed. `performance.memory` (Chromium/Quest
   * browser) catches a JS-heap leak that wouldn't show in the GL counts —
   * retained closures, Image objects, detached video pipelines. dome/scene
   * graph sizes are included so a runaway mesh/child count is visible too.
   */
  private resourceSnapshot(): Record<string, number | null> {
    const info = this.renderer.info;
    const mem = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
      }
    ).memory;
    const mb = (b: number) => +(b / 1048576).toFixed(1);
    return {
      geo: info.memory.geometries,
      tex: info.memory.textures,
      prog: info.programs?.length ?? 0,
      calls: info.render.calls,
      domes: this.domeMeshes.length,
      vkids: this.videoGroup.children.length,
      ukids: this.uiGroup.children.length,
      media: this.usingMediaLayer ? 1 : 0,
      heap: mem ? mb(mem.usedJSHeapSize) : null,
      heapLim: mem ? mb(mem.jsHeapSizeLimit) : null,
    };
  }

  /**
   * Emit a leak-probe snapshot and force it to disk immediately — the crash is a
   * hard OOM, so the last snapshot before it must survive (the periodic flush
   * timer may not fire in time).
   */
  private emitResourceSnapshot(tag: string) {
    vrLog.note("leakprobe", {
      tag,
      sw: this.jSwitchCount,
      ...this.resourceSnapshot(),
    });
    vrLog.flushNow();
  }

  // --- dome construction ----------------------------------------------------

  private clearDome() {
    for (const m of this.domeMeshes) {
      this.videoGroup.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.domeMeshes = [];
  }

  private buildDome() {
    this.clearDome();
    const p = this.projection;

    if (p.fov === "fisheye190") {
      // Dual-fisheye SBS: a forward dome per eye, sampling its own circle via a
      // shader that un-distorts the equidistant projection. Additive path —
      // leaves the equirect/flat logic below untouched.
      if (isStereo(p) && !this.debug.has("mono")) {
        this.domeMeshes.push(this.makeFisheyeMesh("left", 1));
        this.domeMeshes.push(this.makeFisheyeMesh("right", 2));
      } else {
        this.domeMeshes.push(this.makeFisheyeMesh("left", 0));
      }
    } else if (p.fov === "flat") {
      // Snap the flat screen to the viewer's current gaze direction at switch
      // time. this.videoYaw is stale (captured at the last recenter press, not
      // at this scene switch). Reading the live XR camera pose here puts the
      // screen directly in front of wherever the viewer is looking when they
      // tap the card. Falls back to videoYaw if the XR pose isn't ready yet.
      const xrCam = this.renderer.xr.getCamera();
      this.tmpEuler.setFromQuaternion(xrCam.quaternion, "YXZ");
      this.videoGroup.rotation.y = this.tmpEuler.y;
      this.domeMeshes.push(this.makeFlatScreen(p.zoom));
    } else if (isStereo(p) && !this.debug.has("mono")) {
      this.domeMeshes.push(this.makeDomeMesh(uvTransformForEye(p, "left"), 1));
      this.domeMeshes.push(this.makeDomeMesh(uvTransformForEye(p, "right"), 2));
    } else {
      // mono — single mesh on the default layer (visible to both eyes)
      this.domeMeshes.push(
        this.makeDomeMesh({ scaleX: 1, offsetX: 0, scaleY: 1, offsetY: 0 }, 0)
      );
    }

    for (const m of this.domeMeshes) {
      this.videoGroup.add(m);
      // Stay hidden if we're in the lobby — setLobbyMode(false) will reveal them.
      if (this.lobbyMode) m.visible = false;
    }
  }

  private makeDomeMesh(uv: IUVTransform, layer: number): THREE.Mesh {
    const coverage = horizontalCoverage(this.projection); // PI (180) or 2PI (360)
    const is180 = this.projection.fov === "180";
    // For 180, span the front hemisphere; phiStart calibrated so the centre
    // faces forward after the -PI/2 mesh rotation below. Full sphere for 360.
    const phiStart = is180 ? Math.PI / 2 : 0;
    const geometry = new THREE.SphereGeometry(
      DOME_RADIUS,
      DOME_SEG_W,
      DOME_SEG_H,
      phiStart,
      coverage
    );
    // Render the inside without mirroring the texture (proven recipe).
    geometry.scale(-1, 1, 1);
    this.applyUv(geometry, uv);

    const material = this.debug.has("solid")
      ? new THREE.MeshBasicMaterial({ color: 0x224466 })
      : new THREE.MeshBasicMaterial({ map: this.videoTexture });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = -Math.PI / 2;
    mesh.layers.set(layer);
    // Never frustum-cull: the viewer is inside this dome, so a marginal
    // bounding-sphere test must never blank the whole video as the head turns.
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * One eye of a dual-fisheye SBS source. A forward hemisphere dome is sampled
   * by a fragment shader that maps each view direction back into the encoded
   * 190° equidistant circle (r = θ / θmax), reading from this eye's half of the
   * frame. This is the one projection that can't be a linear UV transform, so it
   * lives in its own additive code path rather than touching `makeDomeMesh`.
   */
  private makeFisheyeMesh(eye: "left" | "right", layer: number): THREE.Mesh {
    // Forward hemisphere centred on -Z (content space). Baking the orientation
    // into the geometry means the shader can derive the view direction straight
    // from `position`, and BackSide handles inside-out viewing without the
    // texture-mirroring scale(-1,1,1) trick the equirect path relies on.
    const geometry = new THREE.SphereGeometry(
      DOME_RADIUS,
      DOME_SEG_W,
      DOME_SEG_H,
      Math.PI / 2,
      Math.PI
    );
    geometry.rotateY(Math.PI / 2); // centre the hemisphere on -Z (forward)

    // This eye's half of the SBS frame. The encoded circle fills its half-frame
    // square: in UV the radius is 0.25 horizontally (half of a half-width) but
    // 0.5 vertically, because the full frame is 2:1 — getting these unequal is
    // what keeps the image from being squashed.
    const uv = uvTransformForEye(this.projection, eye);
    const isOff = this.projection.stereo === "off";
    const centerU = isOff ? 0.25 : uv.offsetX + 0.25;
    const center = new THREE.Vector2(centerU, 0.5);
    const radius = new THREE.Vector2(0.25, 0.5);

    const material = this.debug.has("solid")
      ? new THREE.MeshBasicMaterial({ color: 0x224466, side: THREE.BackSide })
      : new THREE.ShaderMaterial({
          side: THREE.BackSide,
          uniforms: {
            uTex: { value: this.videoTexture },
            uCenter: { value: center },
            uRadius: { value: radius },
            uMaxTheta: { value: FISHEYE190_MAX_THETA },
            uZoom: { value: this.projection.zoom || 1 },
          },
          vertexShader: `
            varying vec3 vDir;
            void main() {
              vDir = normalize(position);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            precision highp float;
            uniform sampler2D uTex;
            uniform vec2 uCenter;
            uniform vec2 uRadius;
            uniform float uMaxTheta;
            uniform float uZoom;
            varying vec3 vDir;
            void main() {
              vec3 d = normalize(vDir);
              // Optical axis is -Z; angle from it gives the equidistant radius.
              float theta = acos(clamp(-d.z, -1.0, 1.0));
              float r = (theta / uMaxTheta) / uZoom;
              if (r > 1.0) {
                gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                return;
              }
              float phi = atan(d.y, d.x);
              // NOTE: vertical sign may need flipping on-device depending on the
              // source's circle orientation; negate uRadius.y if it's upside down.
              vec2 uv = uCenter + r * uRadius * vec2(cos(phi), sin(phi));
              gl_FragColor = texture2D(uTex, uv);
            }
          `,
        });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.layers.set(layer);
    mesh.frustumCulled = false;
    return mesh;
  }

  private makeFlatScreen(zoom: number): THREE.Mesh {
    const w = 4 * zoom;
    const h = 2.25 * zoom; // 16:9

    // Gently curved cylindrical screen — concave toward viewer for a cinematic
    // wrap feel without the flatness of a PlaneGeometry.
    const R = 5.0; // cylinder radius; larger = flatter curve
    const thetaHalf = Math.asin(Math.min(w / 2 / R, 1.0));
    const N = 40; // horizontal segments
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= 1; j++) {
      const y = (j - 0.5) * h;
      for (let i = 0; i <= N; i++) {
        const theta = -thetaHalf + (i / N) * 2 * thetaHalf;
        // Cylinder centre is at local +z (toward viewer); surface curves inward.
        pos.push(R * Math.sin(theta), y, R * (1 - Math.cos(theta)));
        uvs.push(i / N, j);
      }
    }
    const cols = N + 1;
    for (let i = 0; i < N; i++) {
      const b = i,
        t = cols + i;
      idx.push(b, b + 1, t + 1, b, t + 1, t);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();

    const material = this.debug.has("solid")
      ? new THREE.MeshBasicMaterial({ color: 0x224466 })
      : new THREE.MeshBasicMaterial({ map: this.videoTexture });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 1.55, -3.2);
    mesh.layers.set(0);
    mesh.frustumCulled = false;
    return mesh;
  }

  private applyUv(geometry: THREE.BufferGeometry, t: IUVTransform) {
    const { uv } = geometry.attributes;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(
        i,
        uv.getX(i) * t.scaleX + t.offsetX,
        uv.getY(i) * t.scaleY + t.offsetY
      );
    }
    uv.needsUpdate = true;
  }

  // --- render loop ----------------------------------------------------------

  private render = (time: number) => {
    const jitter = vrLog.profile === "jitter";
    let didUpload = false;
    // XR frame-time telemetry (only when ?vrlog is active). A hitch here = a long
    // JS/render frame (our code, GC, texture upload); if these stay smooth but
    // the headset still judders, the stutter is compositor/cadence, not render.
    if (vrLog.active) {
      if (this.frameLast) {
        const dt = time - this.frameLast;
        this.frameAccum += dt;
        this.frameCount++;
        if (dt > this.frameMax) this.frameMax = dt;
        if (dt > 25) {
          this.frameLong++;
          if (!jitter)
            vrLog.note("hitch", {
              dt: +dt.toFixed(1),
              path: this.usingMediaLayer ? "media" : "dome",
              fov: this.projection.fov,
              lobby: this.lobbyMode,
            });
        }
        if (time - this.frameReportAt > 1000) {
          const span = time - this.frameReportAt;
          if (!jitter)
            vrLog.note("frames", {
              fps: +((this.frameCount * 1000) / span).toFixed(1),
              avg: +(this.frameAccum / this.frameCount).toFixed(1),
              max: +this.frameMax.toFixed(1),
              long: this.frameLong,
              path: this.usingMediaLayer ? "media" : "dome",
            });
          this.frameAccum = 0;
          this.frameCount = 0;
          this.frameMax = 0;
          this.frameLong = 0;
          this.frameReportAt = time;
        }
      } else {
        this.frameReportAt = time;
      }
      this.frameLast = time;
    }

    // Force the video texture to upload the latest decoded frame every XR
    // render cycle to prevent desync with the XR compositor's frame pacing.
    // Guard on readyState >= HAVE_CURRENT_DATA: if the decoder is mid-stall
    // (segment boundary, buffer refill) skip the update so Three.js holds the
    // last good GPU frame rather than uploading an empty buffer → black flash.
    //
    // Frame dedup: skip redundant uploads when the decoded frame hasn't
    // advanced. video.currentTime is an approximation of which frame the
    // decoder has — if it's the same as last upload the texture hasn't changed.
    // This counteracts the intentional per-frame-update (needed to prevent
    // Quest compositor desync) by at least skipping truly identical frames.
    // At throttle≥1, skip stale uploads on stall to cut bus pressure.
    // Only needed for the shader-dome path (fisheye / Layers-less fallback):
    // when the media layer is active the compositor samples the <video> itself.
    if (this.domeMeshes.length > 0 && this.opts.video.readyState >= 2) {
      const ct = this.opts.video.currentTime;
      const frameChanged = Math.abs(ct - this.lastUploadedFrame) > 0.01;
      if (frameChanged || this.opts.video.paused) {
        this.videoTexture.needsUpdate = true;
        this.lastUploadedFrame = ct;
        this.uploadSkipCount = 0;
        didUpload = true;
      } else if (this.throttleLevel < 1 || this.uploadSkipCount < 3) {
        // Keep the "steady per-frame refire" alive at throttle 0 or for up
        // to 3 consecutive identical frames (so a micro-stall recovers fast).
        this.videoTexture.needsUpdate = true;
        this.uploadSkipCount++;
        didUpload = true;
      }
      // At throttle≥2 with a stalled frame: skip entirely.
    }

    // Performance auto-throttle evaluation. Runs on every render frame and
    // tracks a rolling window of hitches (frames > THROTTLE_HITCH_MS). When
    // the count exceeds THROTTLE_ESCALATE_AT within the window, quality is
    // dialled down a notch. Smooth frames gradually decay the level back.
    const dt = this.frameLast ? time - this.frameLast : 0;
    if (dt > THROTTLE_HITCH_MS) {
      this.throttleHitches++;
      if (time - this.throttleWindowStart > THROTTLE_WINDOW_MS) {
        this.throttleHitches = 1;
        this.throttleWindowStart = time;
      }
      if (
        this.throttleHitches >= THROTTLE_ESCALATE_AT &&
        this.throttleLevel < 2
      ) {
        this.throttleLevel++;
        this.throttleHitches = 0;
        this.throttleWindowStart = time;
        vrLog.note("throttle_escalate", { level: this.throttleLevel });
      }
    }
    // Decay: after THROTTLE_DECAY_MS of no new hitches, drop one level.
    if (this.throttleLevel > 0 && dt > 0 && dt <= THROTTLE_HITCH_MS) {
      this.throttleDecayAccum += dt;
      if (this.throttleDecayAccum >= THROTTLE_DECAY_MS) {
        this.throttleLevel--;
        this.throttleDecayAccum = 0;
        this.throttleHitches = 0;
        this.throttleWindowStart = time;
        vrLog.note("throttle_decay", { level: this.throttleLevel });
      }
    } else if (dt > THROTTLE_HITCH_MS) {
      this.throttleDecayAccum = 0;
    }

    // Apply throttle level: at ≥2, skip the backdrop update.
    const skipBackdrop = this.throttleLevel >= 2;

    // Ensure the XR sub-cameras see their stereo eye layers.
    const xrCam = this.renderer.xr.getCamera() as THREE.ArrayCamera;
    if (xrCam.cameras && xrCam.cameras.length >= 2) {
      xrCam.cameras[0].layers.enable(1);
      xrCam.cameras[1].layers.enable(2);
    }

    // Snap the UI in front of the viewer once on entry, then leave it world-
    // anchored — it never head-follows; the user repositions it by grabbing it
    // with the grip. Wait for a valid viewer pose first — on the very first
    // frame(s) the headset pose may not be acquired yet (camera at the origin)
    // and we'd place it off to a side.
    if (!this.placed) {
      this.tmpVec.setFromMatrixPosition(xrCam.matrixWorld);
      if (this.tmpVec.lengthSq() > 0.01) {
        this.placeUiInstant(xrCam);
        this.placed = true;
        this.lastActivity = time;
      }
    }

    // Drive controllers (hover/scrub/drag) and gather this-frame activity.
    // Auto-hide is driven purely by hand/controller activity (movement, stick,
    // buttons) — never by head direction or where the laser happens to point.
    const pIn0 = jitter ? performance.now() : 0;
    this.input.update();
    // Pick up newly-loaded controller/hand meshes and give them the white rim.
    this.deviceModels?.update();
    const pInputMs = jitter ? performance.now() - pIn0 : 0;
    if (this.input.consumeActivity()) {
      this.lastActivity = time;
    }
    // A controller actively pointing at a panel counts as interaction: keep the
    // UI visible for as long as the user is aiming at it (without requiring a
    // press), so they have time to read and target elements.
    if (this.input.isHoveringPanel) {
      this.lastActivity = time;
    }

    const pUi0 = jitter ? performance.now() : 0;
    // Auto-hide: fade the whole UI group toward visible/hidden. Debug flags can
    // pin it fully hidden or fully shown to isolate UI rendering vs the dome.
    const lobby = this.lobbyMode;
    if (lobby) {
      // The Home wall is always visible (no auto-hide) while in the lobby.
      this.uiOpacity = 1;
    } else if (this.debug.has("hideui")) {
      this.uiOpacity = 0;
    } else if (this.debug.has("noautohide")) {
      this.uiOpacity = 1;
    } else {
      const idle = time - this.lastActivity > AUTO_HIDE_MS;
      this.uiOpacity += ((idle ? 0 : 1) - this.uiOpacity) * FADE_LERP;
    }
    const op = this.uiOpacity;

    if (lobby) {
      // Lobby: show the Home wall, or the gallery viewer when a gallery is open;
      // playback bar + side panels stay hidden.
      this.panel.setRenderState(0);
      this.handyPanel?.setRenderState(0);
      this.infoPanel?.setRenderState(0);
      this.scenesPanel?.setRenderState(0);
      this.homePanel?.setRenderState(this.galleryOpen ? 0 : op);
      this.galleryViewer?.setRenderState(this.galleryOpen ? op : 0);
      this.input.setRaysVisible(true);
    } else {
      this.panel.setRenderState(op);
      // Show laser rays only when the UI is visible — no point beaming through
      // an invisible panel, and it avoids visual clutter during immersive play.
      this.input.setRaysVisible(op > 0.05);
      // Side panels only render (and are only interactable) while open. Browse
      // shows both peripheral panels together (Scenes left, Info right).
      // Filter panel is lobby-only — hidden during playback.
      this.handyPanel?.setRenderState(this.handyPanelOpen ? op : 0);
      this.infoPanel?.setRenderState(this.browseOpen ? op : 0);
      this.scenesPanel?.setRenderState(this.browseOpen ? op : 0);
      this.homePanel?.setRenderState(0);
      this.galleryViewer?.setRenderState(0);
    }

    const state = this.opts.getState();
    if (op > 0.02) {
      if (lobby) {
        // Drive whichever wall is active (Home grid, or the gallery viewer when
        // a gallery is open).
        const activeWall = this.galleryOpen
          ? this.galleryViewer
          : this.homePanel;
        activeWall?.update();
        // Drive the ambient backdrop (slow starfield drift) each lobby frame.
        // At throttle level ≥2, skip the backdrop update to save GPU work.
        if (!skipBackdrop) this.backdrop?.update();

        // Thumbstick navigation: horizontal paginates the active grid / steps the
        // lightbox; vertical scrolls the Home filter rail (no-op in the viewer).
        if (activeWall) {
          const { h, v } = this.input.getLobbyAxes();
          const NAV_FIRE = 0.65;
          const NAV_REARM = 0.25;
          if (Math.abs(h) < NAV_REARM) this.lobbyHArmed = true;
          else if (Math.abs(h) > NAV_FIRE && this.lobbyHArmed) {
            this.lobbyHArmed = false;
            activeWall.nudgePage(h > 0 ? 1 : -1);
          }
          if (Math.abs(v) < NAV_REARM) this.lobbyVArmed = true;
          else if (Math.abs(v) > NAV_FIRE && this.lobbyVArmed) {
            this.lobbyVArmed = false;
            activeWall.nudgeRail(v > 0 ? 1 : -1);
          }
        }
        // Poll for gaze-dwell launch (Home wall only — scene/gallery cards).
        const pa = this.homePanel?.takePendingAction();
        if (pa) this.dispatchAction(pa);
      } else {
        const d = this.drawInput;
        d.state = state;
        d.projection = this.projection;
        d.markers = this.opts.getMarkers();
        d.chapterTitle = this.opts.getChapterTitle();
        d.caption = this.opts.getCaption();
        d.handyOpen = this.handyPanelOpen;
        d.browseOpen = this.browseOpen;
        if (this.opts.getHandyState) {
          const hs = this.opts.getHandyState();
          d.handy = {
            connected: hs.status === "ready",
            funscriptLoaded: !!(
              this.opts.getFunscriptLoaded && this.opts.getFunscriptLoaded()
            ),
          };
        }
        this.panel.sync(d);
        // Push the latest Handy connection state to the VR panel each frame.
        if (this.handyPanelOpen && this.handyPanel) {
          if (this.opts.getHandyState) {
            this.handyPanel.setHandyState(this.opts.getHandyState());
          }
          this.handyPanel.update();
        }
        if (this.browseOpen) {
          this.infoPanel?.update();
          this.scenesPanel?.update();
        }
      }
    }

    if (!lobby) this.updateThumbnailPreview(state.duration, op);

    const pUiMs = jitter ? performance.now() - pUi0 : 0;
    const pR0 = jitter ? performance.now() : 0;
    if (jitter && this.gpuTimer) this.gpuTimer.begin();
    this.renderer.render(this.scene, this.camera);
    if (jitter && this.gpuTimer) this.gpuTimer.end();

    if (jitter) {
      this.recordJitterFrame(
        time,
        pInputMs,
        pUiMs,
        performance.now() - pR0,
        didUpload
      );
    }
  };

  /**
   * Jitter profiler: attribute each frame's wall-time to a concrete cause.
   *
   * `dt` is the interval between consecutive XR callbacks — the cadence the
   * headset actually sees. The work that filled that interval is the PREVIOUS
   * frame's callback (`jPrev`), so a hitch is charged to the render/UI/input
   * that caused it; `outside = dt - prevWork` is the time spent between our
   * callbacks (compositor submit, vsync wait, decode, GC). Combined with the
   * GPU time of the render and the decode-drop delta, a hitch line is
   * self-explanatory:
   *   high `r` (+ high `gpu`, scales with `res`) → render/upload bound (dome)
   *   high `out` with low `r`/`gpu` and `dd`>0   → decode-bound
   *   high `out` with low everything             → compositor / thermal
   */
  private recordJitterFrame(
    time: number,
    inputMs: number,
    uiMs: number,
    renderMs: number,
    didUpload: boolean
  ) {
    const dt = this.jFrameLast ? time - this.jFrameLast : 0;
    this.jFrameLast = time;
    if (this.jReportAt === 0) this.jReportAt = time;
    const prev = this.jPrev;
    const outside = dt > 0 ? Math.max(0, dt - prev.total) : 0;

    // Decode-frame drops since the last frame (the decoder falling behind).
    const q = (
      this.opts.video as HTMLVideoElement & {
        getVideoPlaybackQuality?: () => { droppedVideoFrames: number };
      }
    ).getVideoPlaybackQuality?.();
    const dropped = q ? q.droppedVideoFrames : 0;
    if (this.jDropLast < 0) this.jDropLast = dropped;
    const ddrop = dropped - this.jDropLast;
    this.jDropLast = dropped;

    // Drain any GPU timer-query results that have become available.
    if (this.gpuTimer && this.gpuTimer.results.length) {
      for (const ms of this.gpuTimer.results) this.jGpu.push(ms);
      this.gpuTimer.results.length = 0;
    }

    if (dt > 0) {
      this.jDt.push(dt);
      this.jRender.push(prev.render);
      this.jOutside.push(outside);
      if (didUpload) this.jUploadN++;
      this.jDropSum += ddrop;
      if (dt > 33) {
        this.jHitchN++;
        vrLog.note("jhitch", {
          dt: +dt.toFixed(1),
          r: +prev.render.toFixed(1),
          ui: +prev.ui.toFixed(1),
          in: +prev.input.toFixed(1),
          out: +outside.toFixed(1),
          up: prev.upload,
          dd: ddrop,
          rs: this.opts.video.readyState,
          res: `${this.opts.video.videoWidth}x${this.opts.video.videoHeight}`,
          fov: this.projection.fov,
          path: this.usingMediaLayer ? "media" : "dome",
        });
      }
    }
    this.jPrev = {
      input: inputMs,
      ui: uiMs,
      render: renderMs,
      total: inputMs + uiMs + renderMs,
      upload: didUpload,
    };

    if (time - this.jReportAt >= 1000 && this.jDt.length) {
      const span = time - this.jReportAt;
      const avg = (a: number[]) =>
        +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
      const pct = (a: number[], p: number) => {
        const s = [...a].sort((x, y) => x - y);
        return +(
          s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0
        ).toFixed(1);
      };
      const mx = (a: number[]) => +Math.max(...a).toFixed(1);
      vrLog.note("jstat", {
        path: this.usingMediaLayer ? "media" : "dome",
        fov: this.projection.fov,
        res: `${this.opts.video.videoWidth}x${this.opts.video.videoHeight}`,
        fps: +((this.jDt.length * 1000) / span).toFixed(1),
        n: this.jDt.length,
        dt50: pct(this.jDt, 0.5),
        dt95: pct(this.jDt, 0.95),
        dtMax: mx(this.jDt),
        r_avg: avg(this.jRender),
        r95: pct(this.jRender, 0.95),
        rMax: mx(this.jRender),
        o_avg: avg(this.jOutside),
        o95: pct(this.jOutside, 0.95),
        gpu_avg: this.jGpu.length ? avg(this.jGpu) : null,
        gpuMax: this.jGpu.length ? mx(this.jGpu) : null,
        hitch: this.jHitchN,
        up: this.jUploadN,
        dd: this.jDropSum,
        // Per-second resource timeline — a steadily climbing geo/tex/prog/heap
        // across the seconds leading up to the crash is the leak fingerprint.
        ...this.resourceSnapshot(),
      });
      this.jDt.length = 0;
      this.jRender.length = 0;
      this.jOutside.length = 0;
      this.jGpu.length = 0;
      this.jHitchN = 0;
      this.jUploadN = 0;
      this.jDropSum = 0;
      this.jReportAt = time;
    }
  }

  /** Snap the UI group directly in front of the viewer (yaw-only). */
  private placeUiInstant(cam: THREE.Camera) {
    this.tmpVec.setFromMatrixPosition(cam.matrixWorld);
    this.tmpEuler.setFromQuaternion(cam.quaternion, "YXZ");
    const yaw = this.tmpEuler.y;
    this.uiGroup.position.set(
      this.tmpVec.x - Math.sin(yaw) * PANEL_DISTANCE,
      this.tmpVec.y - PANEL_DROP,
      this.tmpVec.z - Math.cos(yaw) * PANEL_DISTANCE
    );
    // YXZ order: yaw about world-up first, then pitch about the *yawed* local X
    // axis, so the bar's bottom edge stays level with the horizon. The default
    // XYZ order applies pitch about world-X and induces an apparent roll (the
    // bar tilting to one side) whenever yaw is non-zero.
    this.uiGroup.rotation.set(PANEL_TILT, yaw, 0, "YXZ");
  }

  /** Title of the marker/chapter whose span contains `time`, or null. */
  private markerTitleAt(time: number): string | null {
    const markers = this.opts.getMarkers();
    for (let i = markers.length - 1; i >= 0; i--) {
      if (time >= markers[i].seconds) {
        const end = markers[i].endSeconds;
        if (end != null && time > end) return null;
        return markers[i].title || null;
      }
    }
    return null;
  }

  /** Draw a bottom-anchored marker-name caption onto the preview canvas. */
  private drawThumbCaption(title: string) {
    const ctx = this.thumbCtx;
    if (!ctx) return;
    const barH = 46;
    const grad = ctx.createLinearGradient(
      0,
      THUMB_CANVAS_H - barH,
      0,
      THUMB_CANVAS_H
    );
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.88)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, THUMB_CANVAS_H - barH, THUMB_CANVAS_W, barH);

    ctx.font = "600 24px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    let label = title;
    const maxW = THUMB_CANVAS_W - 28;
    if (ctx.measureText(label).width > maxW) {
      while (label.length > 1 && ctx.measureText(`${label}…`).width > maxW) {
        label = label.slice(0, -1);
      }
      label = `${label}…`;
    }
    ctx.fillText(label, THUMB_CANVAS_W / 2, THUMB_CANVAS_H - 14);
  }

  /**
   * Float a preview above the scrubber while it's being hovered: the VTT
   * thumbnail when available, plus the name of the marker the hovered position
   * sits within. When there's no thumbnail but the position is inside a marker,
   * a name-only plate is shown so hovering still previews the marker.
   */
  private updateThumbnailPreview(duration: number, uiOpacity: number) {
    const frac = this.panel.scrubberHoverFraction;
    if (
      uiOpacity < 0.5 ||
      frac == null ||
      !this.thumbCtx ||
      !duration ||
      !isFinite(duration)
    ) {
      this.thumbPreview.visible = false;
      return;
    }
    const time = frac * duration;
    const title = this.markerTitleAt(time);
    const crop = this.getThumb ? this.getThumb(time) : null;
    if (!crop && !title) {
      this.thumbPreview.visible = false;
      return;
    }

    // Only redraw the preview canvas when the sprite crop or marker name
    // actually changes — holding still costs no texture upload.
    const img = crop ? (crop.image as HTMLImageElement) : null;
    const key = crop
      ? `${img?.src ?? ""}#${crop.sx},${crop.sy},${crop.sw},${crop.sh}#${
          title ?? ""
        }`
      : `nothumb#${title ?? ""}`;
    if (key !== this.lastThumbKey) {
      this.thumbCtx.clearRect(0, 0, THUMB_CANVAS_W, THUMB_CANVAS_H);
      if (crop) {
        try {
          this.thumbCtx.drawImage(
            crop.image,
            crop.sx,
            crop.sy,
            crop.sw,
            crop.sh,
            0,
            0,
            THUMB_CANVAS_W,
            THUMB_CANVAS_H
          );
        } catch {
          // tainted/incomplete image — skip this frame
          this.thumbPreview.visible = false;
          return;
        }
      } else {
        // No thumbnail — solid plate behind the marker name.
        this.thumbCtx.fillStyle = "rgba(12,16,32,0.92)";
        this.thumbCtx.fillRect(0, 0, THUMB_CANVAS_W, THUMB_CANVAS_H);
      }
      this.thumbCtx.strokeStyle = "rgba(255,255,255,0.6)";
      this.thumbCtx.lineWidth = 4;
      this.thumbCtx.strokeRect(0, 0, THUMB_CANVAS_W, THUMB_CANVAS_H);
      if (title) this.drawThumbCaption(title);
      this.thumbTexture.needsUpdate = true;
      this.lastThumbKey = key;
    }

    // Position above the scrubber at the hovered fraction, clamped to the panel.
    const anchor = this.panel.scrubberAnchorLocal(frac);
    const limit = this.panel.widthMeters / 2 - THUMB_W_M / 2;
    const x = Math.min(limit, Math.max(-limit, anchor.x));
    this.thumbPreview.position.set(
      x,
      anchor.y + THUMB_H_M / 2 + 0.06,
      anchor.z + 0.02
    );
    (this.thumbPreview.material as THREE.MeshBasicMaterial).opacity = uiOpacity;
    this.thumbPreview.visible = true;
  }

  private handleEnd() {
    this.opts.onEnd();
  }

  dispose() {
    // Bump mediaGen so any pending onVideoReady callbacks are discarded.
    this.mediaGen++;
    this.renderer.setAnimationLoop(null);
    this.session?.removeEventListener("end", this.onSessionEnd);
    this.opts.video.removeEventListener("loadedmetadata", this.onVideoReady);
    this.opts.video.removeEventListener("loadeddata", this.onVideoReady);
    this.opts.video.removeEventListener("resize", this.onVideoReady);
    this.input.dispose();
    this.deviceModels?.dispose();
    this.panel.dispose();
    this.handyPanel?.dispose();
    this.infoPanel?.dispose();
    this.scenesPanel?.dispose();
    this.homePanel?.dispose();
    this.galleryViewer?.dispose();
    this.backdrop?.dispose();

    if (this.previewHoverTimer !== null) {
      window.clearTimeout(this.previewHoverTimer);
      this.previewHoverTimer = null;
    }
    if (this.previewVideo) {
      this.previewVideo.pause();
      this.previewVideo.src = "";
      this.previewVideo = null;
    }
    this.thumbTexture.dispose();
    (this.thumbPreview.material as THREE.Material).dispose();
    this.thumbPreview.geometry.dispose();
    this.clearDome();
    this.destroyMediaLayer();
    this.gpuTimer = null;
    this.mediaBinding = null;
    this.videoTexture.dispose();
    this.renderer.domElement.remove();
    this.renderer.dispose();
    this.session = null;
  }
}
