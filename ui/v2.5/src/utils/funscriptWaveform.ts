/**
 * Generates a funscript waveform SVG data URL using the clipPath+polygon technique.
 *
 * A polygon encodes the waveform silhouette (trace along the top, closed at the
 * bottom). It is used as a clipPath over a dark translucent grey rect, producing
 * a solid filled waveform shape — the same approach used by popular interactive sites.
 * A subtle lighter-grey polyline is drawn over the top edge as an outline.
 */

export interface FunscriptAction {
  /** Timestamp in milliseconds */
  at: number;
  /** Position value 0–100 */
  pos: number;
}

const SVG_WIDTH = 1200;
const SVG_HEIGHT = 24;
const MAX_POINTS = 600;

/**
 * Returns a CSS `url(...)` value for use as a background-image, or an empty
 * string if the actions list is unusable (< 2 points, zero duration, etc.).
 */
export function generateFunscriptWaveform(
  actions: FunscriptAction[],
  width = SVG_WIDTH,
  height = SVG_HEIGHT,
): string {
  if (!actions || actions.length < 2) return "";

  const sorted = [...actions].sort((a, b) => a.at - b.at);
  const duration = sorted[sorted.length - 1].at;
  if (duration <= 0) return "";

  // Downsample to keep the SVG size reasonable
  const step = Math.max(1, Math.floor(sorted.length / MAX_POINTS));
  const sampled: FunscriptAction[] = [];
  for (let i = 0; i < sorted.length; i += step) sampled.push(sorted[i]);
  const last = sorted[sorted.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);

  // Map to SVG coordinates: pos=100 → y=0 (top), pos=0 → y=height (bottom)
  const pts = sampled.map((a) => ({
    x: (a.at / duration) * width,
    y: height - (a.pos / 100) * height,
  }));

  // Polygon: bottom-left anchor → waveform trace → bottom-right anchor.
  // The polygon auto-closes back to (0,height), forming the solid waveform silhouette.
  const polyPoints = [
    `0,${height}`,
    ...pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `${width},${height}`,
  ].join(" ");

  const clipId = "wfclip";
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`,
    `<defs>`,
    `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">`,
    `<polygon points="${polyPoints}"/>`,
    `</clipPath>`,
    `</defs>`,
    // Solid translucent light-grey fill clipped to the waveform silhouette
    `<g clip-path="url(#${clipId})">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="rgba(190,190,190,0.52)"/>`,
    `</g>`,
    `</svg>`,
  ].join("");

  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}
