/**
 * Projection / stereo geometry for the immersive VR player.
 *
 * Framework-agnostic: maps a scene's stored `vr_mode` (and in-headset overrides)
 * to the parameters the dome renderer needs. The dome itself (three.js geometry)
 * is built in [xrSession.ts] from the values computed here.
 *
 * We deliberately key off `GQL.VrMode` directly rather than reusing the
 * videojs-specific `VRType` enum from [../vrmode.ts], to keep this immersive
 * module fully decoupled from the 2D VideoJS player.
 */
import * as GQL from "src/core/generated-graphql";

/** How much of the sphere the video covers. */
export type FovMode = "flat" | "180" | "360";

/** Stereo packing of the source video. */
export type StereoMode = "off" | "sbs" | "tb"; // sbs = side-by-side (L|R), tb = top|bottom

export interface IProjectionSettings {
  fov: FovMode;
  stereo: StereoMode;
  /** Swap which half feeds which eye (corrects reversed-stereo encodes). */
  swapEyes: boolean;
  /** Angular zoom multiplier; 1 = native coverage. Range clamped 0.5..1.5. */
  zoom: number;
}

export const DEFAULT_PROJECTION: IProjectionSettings = {
  fov: "180",
  stereo: "sbs",
  swapEyes: false,
  zoom: 1,
};

export const FLAT_PROJECTION: IProjectionSettings = {
  fov: "flat",
  stereo: "off",
  swapEyes: false,
  zoom: 1,
};

/** Initial projection derived from the scene's stored VR mode. */
export function projectionForVrMode(
  vrMode: GQL.VrMode | null | undefined
): IProjectionSettings {
  switch (vrMode) {
    case GQL.VrMode.Lr180:
      return { fov: "180", stereo: "sbs", swapEyes: false, zoom: 1 };
    case GQL.VrMode.Tb360:
      return { fov: "360", stereo: "tb", swapEyes: false, zoom: 1 };
    case GQL.VrMode.Mono360:
      return { fov: "360", stereo: "off", swapEyes: false, zoom: 1 };
    default:
      // No stored VR mode: assume the common 180° SBS layout, which the user
      // can correct in-headset via the projection controls.
      return { ...DEFAULT_PROJECTION };
  }
}

/** Horizontal coverage of the dome, in radians. */
export function horizontalCoverage(s: IProjectionSettings): number {
  if (s.fov === "360") return 2 * Math.PI;
  return Math.PI; // 180 (flat handled separately by the renderer)
}

export interface IUVTransform {
  scaleX: number;
  offsetX: number;
  scaleY: number;
  offsetY: number;
}

const IDENTITY_UV: IUVTransform = {
  scaleX: 1,
  offsetX: 0,
  scaleY: 1,
  offsetY: 0,
};

/**
 * UV sub-rect this eye should sample from the (mono-packed or stereo-packed)
 * source frame. Applied to the dome geometry's uv attribute per eye.
 *
 * Conventions: SBS → left eye = left half; TB → left eye = top half. Both are
 * invertible via `swapEyes` since real-world encodes vary.
 */
export function uvTransformForEye(
  s: IProjectionSettings,
  eye: "left" | "right"
): IUVTransform {
  if (s.stereo === "off") return { ...IDENTITY_UV };

  let primaryHalf = eye === "left";
  if (s.swapEyes) primaryHalf = !primaryHalf;

  if (s.stereo === "sbs") {
    return {
      scaleX: 0.5,
      offsetX: primaryHalf ? 0 : 0.5,
      scaleY: 1,
      offsetY: 0,
    };
  }
  // tb: three.js sphere UVs put v=1 at the top, so the top half is offsetY 0.5.
  return {
    scaleX: 1,
    offsetX: 0,
    scaleY: 0.5,
    offsetY: primaryHalf ? 0.5 : 0,
  };
}

/** Whether this projection requires two separate per-eye dome meshes. */
export function isStereo(s: IProjectionSettings): boolean {
  return s.stereo !== "off";
}

// --- UI cycle helpers (wired to the panel's projection buttons) -------------

const FOV_ORDER: FovMode[] = ["180", "360", "flat"];
const STEREO_ORDER: StereoMode[] = ["off", "sbs", "tb"];

export function cycleFov(s: IProjectionSettings): IProjectionSettings {
  const i = FOV_ORDER.indexOf(s.fov);
  return { ...s, fov: FOV_ORDER[(i + 1) % FOV_ORDER.length] };
}

export function cycleStereo(s: IProjectionSettings): IProjectionSettings {
  const i = STEREO_ORDER.indexOf(s.stereo);
  return { ...s, stereo: STEREO_ORDER[(i + 1) % STEREO_ORDER.length] };
}

export function clampZoom(z: number): number {
  return Math.min(1.5, Math.max(0.5, z));
}

export function fovLabel(s: IProjectionSettings): string {
  switch (s.fov) {
    case "flat":
      return "Flat";
    case "180":
      return "180°";
    case "360":
      return "360°";
  }
}

export function stereoLabel(s: IProjectionSettings): string {
  switch (s.stereo) {
    case "off":
      return "Mono";
    case "sbs":
      return "SBS";
    case "tb":
      return "TB";
  }
}
