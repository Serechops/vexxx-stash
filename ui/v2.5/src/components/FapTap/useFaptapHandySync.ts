import { useContext, useEffect, useRef, useState } from "react";
import { InteractiveContext } from "src/hooks/Interactive/context";

/**
 * useFaptapHandySync — drives the Handy from a plain HTML5 `<video>` element,
 * mirroring the event wiring the VR player uses (useVRPlayback): upload the
 * funscript once the InteractiveContext is initialised, start motion on
 * `playing`/`seeking`, pause on `pause`, and piggyback drift correction on
 * `timeupdate` via ensurePlaying (the client throttles the sync ops itself).
 *
 * Unlike the VR player there is no explicit arming step — this matches the 2D
 * ScenePlayer, which auto-uploads whenever the content is interactive and a
 * device is connected. With no device connected the hook is inert and the
 * video just plays.
 *
 * Returns whether the script is uploaded and actively driving the device.
 */
export function useFaptapHandySync(
  video: HTMLVideoElement | null,
  funscriptUrl: string | null
): boolean {
  const { interactive, initialised, uploadScript } =
    useContext(InteractiveContext);
  const ready = useRef(false);
  const [armed, setArmed] = useState(false);

  // Upload the script once a device session exists. On unmount (or script
  // change) stop motion — the device must never keep stroking to a script
  // whose video is gone.
  useEffect(() => {
    ready.current = false;
    setArmed(false);
    if (!funscriptUrl || !initialised) return;
    let cancelled = false;
    uploadScript(funscriptUrl).then(() => {
      if (cancelled) return;
      ready.current = true;
      setArmed(true);
      if (video && !video.paused) {
        interactive.play(video.currentTime);
      }
    });
    return () => {
      cancelled = true;
      ready.current = false;
      interactive.pause();
    };
  }, [funscriptUrl, initialised, uploadScript, interactive, video]);

  useEffect(() => {
    if (!video || !funscriptUrl) return;

    const onPlaying = () => {
      if (ready.current) interactive.play(video.currentTime);
    };
    const onPause = () => {
      if (ready.current) interactive.pause();
    };
    const onSeeking = () => {
      if (ready.current && !video.paused) interactive.play(video.currentTime);
    };
    const onTimeUpdate = () => {
      if (ready.current && !video.paused) {
        interactive.ensurePlaying(video.currentTime);
      }
    };
    const onEnded = () => {
      if (ready.current) interactive.pause();
    };

    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
    };
  }, [video, funscriptUrl, interactive]);

  return armed;
}
