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

  // Time-domain interpolation: sample the funscript at `width` evenly-spaced
  // time points and linearly interpolate between adjacent actions. This produces
  // the smooth oscillating trace (the waveform "wave" appearance) while being
  // immune to the index-aliasing bug of the old step-2 downsampler. The old
  // approach sampled every Nth *action* by index; with alternating 0/80 patterns
  // and step=2, every sample landed on the pos=0 phase → flat dead zones despite
  // real activity. Sampling by time with interpolation always reflects the actual
  // position at that moment in the timeline.
  const N = width;
  const samples = new Float32Array(N);
  let ai = 0;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * duration;
    while (ai < sorted.length - 2 && sorted[ai + 1].at <= t) ai++;
    const a0 = sorted[ai];
    const a1 = sorted[Math.min(ai + 1, sorted.length - 1)];
    const frac =
      a1.at > a0.at ? Math.min(1, (t - a0.at) / (a1.at - a0.at)) : 0;
    samples[i] = a0.pos + frac * (a1.pos - a0.pos);
  }

  // Trace polygon along interpolated positions, closed at the bottom.
  const pts: string[] = [`0,${height}`];
  for (let i = 0; i < N; i++) {
    pts.push(`${i},${(height - (samples[i] / 100) * height).toFixed(1)}`);
  }
  pts.push(`${width},${height}`);

  const polyPoints = pts.join(" ");

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
