/**
 * Decode-support hints for VR source selection.
 *
 * The candidate list plays the direct stream first and only discovers an
 * undecodable codec through the <video> error → transcode fallback chain — a
 * visible multi-second stall in the headset. MediaCapabilities can answer
 * "can this device decode that file at all?" up front, so an AV1/HEVC/VP9
 * original the headset can't handle starts straight on a transcode instead.
 *
 * Deliberately conservative: sources are only *reordered* (direct stream
 * demoted to last), never dropped — the error-fallback chain still walks
 * everything, so a wrong verdict costs nothing new. Verdicts are cached per
 * codec/resolution/fps for the session, so in-VR scene switches resolve from
 * the cache after the first query.
 */
import * as GQL from "src/core/generated-graphql";
import { vrLog } from "./vrLog";

/**
 * Canonical contentType per ffprobe codec name. Representative high-tier
 * codec strings — this asks "is there a decoder for this codec family at
 * this resolution", not an exact profile match (Stash doesn't record
 * profiles).
 */
const CODEC_CONTENT_TYPES: Record<string, string> = {
  h264: 'video/mp4; codecs="avc1.640033"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L153.B0"',
  h265: 'video/mp4; codecs="hvc1.1.6.L153.B0"',
  av1: 'video/mp4; codecs="av01.0.12M.08"',
  vp9: 'video/webm; codecs="vp09.00.50.08"',
  vp8: 'video/webm; codecs="vp8"',
};

/** codec|WxH|fps → decodable verdict, cached for the session. */
const verdictCache = new Map<string, boolean>();

/**
 * Whether this device can decode the scene's primary file, or null when it
 * can't be determined (no MediaCapabilities, no file info, unmapped codec) —
 * null means "don't reorder", not "unsupported".
 */
async function directStreamDecodable(
  scene: GQL.SceneDataFragment
): Promise<boolean | null> {
  const file = scene.files?.[0];
  const codec = file?.video_codec?.toLowerCase();
  const contentType = codec ? CODEC_CONTENT_TYPES[codec] : undefined;
  const caps = navigator.mediaCapabilities as MediaCapabilities | undefined;
  if (!file || !codec || !contentType || !caps?.decodingInfo) return null;

  const key = `${codec}|${file.width}x${file.height}|${file.frame_rate}`;
  const cached = verdictCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const info = await caps.decodingInfo({
      type: "file",
      video: {
        contentType,
        width: file.width || 3840,
        height: file.height || 1920,
        // VideoConfiguration requires bitrate/framerate; substitute plausible
        // VR-tier values when the file record lacks them.
        bitrate: file.bit_rate || 20_000_000,
        framerate: file.frame_rate || 30,
      },
    });
    verdictCache.set(key, info.supported);
    vrLog.note("decodehint", {
      key,
      supported: info.supported,
      efficient: info.powerEfficient,
    });
    return info.supported;
  } catch {
    // Malformed config / UA quirk — stay neutral and let the error-fallback
    // chain handle this source like before.
    return null;
  }
}

/**
 * Candidate sources reordered by decode support: when the direct stream leads
 * the list but MediaCapabilities says its codec can't be decoded here, it is
 * moved to the end (the transcodes lead instead). Everything else — including
 * any error or unknown verdict — returns the list unchanged.
 */
export async function orderSourcesByDecodeSupport(
  scene: GQL.SceneDataFragment,
  sources: string[]
): Promise<string[]> {
  if (sources.length < 2) return sources;
  if (!scene.paths?.stream || sources[0] !== scene.paths.stream) return sources;
  const decodable = await directStreamDecodable(scene);
  if (decodable !== false) return sources;
  vrLog.note("decodehint_demote", { src: sources[0] });
  return [...sources.slice(1), sources[0]];
}
