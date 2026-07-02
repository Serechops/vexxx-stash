/**
 * passthrough.ts — mixed-reality passthrough support for the immersive player.
 *
 * Two independent passthrough surfaces share this module:
 *  • Hub passthrough — see the real room while browsing the Home wall
 *    (persisted `passthroughHome` preference, toggled in the gear panel).
 *  • Player passthrough — SLR-style "alpha" encodes (…_FISHEYE190_alpha.mp4)
 *    ship a flat matte background that a chroma-key shader knocks out so the
 *    performer appears to stand in the room (control-bar "PT" toggle).
 *
 * WebXR can only composite the camera feed inside an `immersive-ar` session,
 * and a session's mode cannot change once started — so the Enter-VR buttons
 * request `immersive-ar` whenever the device offers it and fall back to plain
 * `immersive-vr`. An AR session rendered with an opaque background is visually
 * identical to VR, so both toggles are purely about what we render (opaque vs
 * transparent clear + keyed video material) and never touch the live session
 * or the <video> element — playback continues seamlessly across a toggle.
 *
 * Deliberately three.js-free: the Enter-VR buttons import this from the main
 * bundle, and three must stay inside the lazy ImmersiveVRPlayer chunk.
 */

const SESSION_INIT: XRSessionInit = {
  optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "layers"],
};

/** Mirror of xrSession's readVrDebug sources (URL ?vrDebug= / localStorage). */
function debugFlags(): string {
  try {
    const url =
      new URLSearchParams(window.location.search).get("vrDebug") ?? "";
    const ls = window.localStorage.getItem("vrDebug") ?? "";
    return `${url},${ls}`.toLowerCase();
  } catch {
    return "";
  }
}

/** True when either immersive mode is available (shows the Enter-VR buttons). */
export async function immersiveSupported(
  xr: XRSystem | undefined
): Promise<boolean> {
  if (!xr?.isSessionSupported) return false;
  const [vr, ar] = await Promise.all([
    xr.isSessionSupported("immersive-vr").catch(() => false),
    xr.isSessionSupported("immersive-ar").catch(() => false),
  ]);
  return vr || ar;
}

/**
 * Request the best immersive session: AR-first (passthrough-capable), VR
 * fallback. Support is probed BEFORE requesting so a user-cancelled AR prompt
 * never cascades into a second VR prompt. `?vrDebug=noar` forces plain VR
 * for on-device A/B against the pre-passthrough renderer.
 */
export async function requestImmersiveSession(
  xr: XRSystem
): Promise<XRSession> {
  if (!debugFlags().includes("noar")) {
    const arOk = await xr.isSessionSupported("immersive-ar").catch(() => false);
    if (arOk) return xr.requestSession("immersive-ar", SESSION_INIT);
  }
  return xr.requestSession("immersive-vr", SESSION_INIT);
}

/**
 * Whether this live session can composite camera passthrough at all. In an
 * `immersive-ar` session Quest reports "alpha-blend"; plain VR is "opaque".
 */
export function isPassthroughSession(session: XRSession): boolean {
  return (session.environmentBlendMode ?? "opaque") !== "opaque";
}

/**
 * Matches SLR-style alpha-matte encodes by filename/title token, e.g.
 * "SLR_…_4096p_85972_FISHEYE190_alpha.mp4". Word-boundary-ish guards keep
 * "alphabet" / "AlphaStudio" from false-positiving mid-word.
 */
const ALPHA_SOURCE_RE = /(^|[^a-z])(alpha|passthrough)([^a-z]|$)/i;

/** Does this scene's source carry an alpha matte the player can key out? */
export function sceneSupportsAlphaPassthrough(scene: {
  title?: string | null;
  files?: readonly { basename?: string | null; path?: string | null }[] | null;
}): boolean {
  for (const f of scene.files ?? []) {
    if (ALPHA_SOURCE_RE.test(f.basename ?? f.path ?? "")) return true;
  }
  return !!scene.title && ALPHA_SOURCE_RE.test(scene.title);
}

// ── Chroma-key tuning (PT panel) ─────────────────────────────────────────────
// The key colour is user-defined in HSV (Hue / Saturation / Brightness sliders,
// DeoVR's model) and the shader keys on linear-space RGB distance from it.
// `range` / `falloff` (IVRPassthroughSettings) map onto the shader's
// similarity / smoothness uniforms below.

/** HSV (h 0..360, s/v 0..1) → sRGB 0..1. */
export function hsvToRgb(
  h: number,
  s: number,
  v: number
): { r: number; g: number; b: number } {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: f(5), g: f(3), b: f(1) };
}

/** sRGB 0..1 → HSV (h 0..360, s/v 0..1). */
export function rgbToHsv(
  r: number,
  g: number,
  b: number
): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * "Color range" slider (0..1) → weighted-HSV key distance below which a texel
 * is fully keyed out. Scale chosen against measured SLR footage: at default
 * weights the grey stand-in suit sits ≲0.25 from the matte while skin /
 * colored / bright clothing sits ≳0.45, so the slider's mid-range travel
 * lands exactly on the decision boundary.
 */
export function keySimilarity(s: { range: number }): number {
  return s.range * 0.7;
}

/**
 * "Falloff" slider (0..1) → feather band width above the similarity cut.
 * Kept narrow (≤0.15) — with the weighted metric the suit/skin gap is ~0.2,
 * and a feather wider than that turns the performer semi-transparent.
 * Floored so a zero falloff still anti-aliases the matte edge slightly.
 */
export function keySmoothness(s: { falloff: number }): number {
  return Math.max(0.008, s.falloff * 0.15);
}

// ── Embedded alpha-mask edge tuning ("(A)" mode) ─────────────────────────────
// The corner-packed mask is a real H.264/HEVC-encoded region (staircased by
// macroblock quantization), so softening its edge takes two coupled knobs: a
// spatial blur that rounds off the blocky silhouette, and the threshold band
// that turns the blurred sample into alpha. One "Edge softness" slider (0..1)
// drives both; 0.5 reproduces the fixed values this fork originally shipped
// with (blur radius 1.5, threshold band 0.1..0.9).

/**
 * "Edge softness" slider (0..1) → 3x3 blur sample radius in texels. 0 makes
 * every sample land on the same texel (no blur, pixel-hard silhouette).
 */
export function maskBlurRadius(s: { maskEdgeSoftness: number }): number {
  return s.maskEdgeSoftness * 3;
}

/**
 * "Edge softness" slider (0..1) → smoothstep band around the blurred mask
 * sample. Widening the band softens/feathers the boundary; narrowing it
 * toward zero-width sharpens it into a hard cutoff (floored so the two edges
 * never collide, which is undefined for GLSL's smoothstep).
 */
export function maskEdgeBand(s: {
  maskEdgeSoftness: number;
}): { lo: number; hi: number } {
  const half = Math.max(0.01, s.maskEdgeSoftness * 0.8);
  return { lo: 0.5 - half, hi: 0.5 + half };
}
