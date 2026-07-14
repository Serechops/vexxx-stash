import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import { PatchComponent } from "src/patch";
import {
  RawDetail,
  RawSources,
  faptapFavorites,
  faptapURL,
  getJSON,
} from "src/components/ScenePlayer/VR/faptapLibrary";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { useFaptapHandySync } from "./useFaptapHandySync";

/**
 * FapTapPlayerPage — flat 2D playback for a FapTap video, no headset needed.
 * Streams straight from the CDN with fallback cycling and drives the Handy
 * through the shared InteractiveContext when the video has a funscript.
 */
export const FapTapPlayerPage = PatchComponent("FapTap.PlayerPage", () => {
  const { id } = useParams<{ id: string }>();
  const history = useHistory();

  const [detail, setDetail] = useState<RawDetail | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [srcIdx, setSrcIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  const [fav, setFav] = useState(false);

  // state-based ref so the sync hook re-wires when the element mounts
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const videoRef = useCallback((el: HTMLVideoElement | null) => setVideoEl(el), []);

  useEffect(() => {
    setDetail(null);
    setSources([]);
    setSrcIdx(0);
    setFailed(false);
    setFav(faptapFavorites.has(id));
    Promise.all([
      getJSON<RawDetail>(`videos/${id}`),
      getJSON<RawSources>(`videos/${id}/sources`),
    ])
      .then(([det, srcs]) => {
        setDetail(det);
        setSources([srcs.stream, ...(srcs.fallbacks ?? [])].filter(Boolean));
      })
      .catch(() => setFailed(true));
  }, [id]);

  const funscriptUrl = useMemo(
    () => (detail?.has_funscript ? faptapURL(`videos/${id}/funscript`) : null),
    [detail?.has_funscript, id]
  );
  const handyArmed = useFaptapHandySync(videoEl, funscriptUrl);

  // Cycle to the next CDN source when the current one errors out. Guard with a
  // ref so a burst of error events can't skip past working fallbacks.
  const advancing = useRef(false);
  const onVideoError = () => {
    if (advancing.current) return;
    if (srcIdx + 1 < sources.length) {
      advancing.current = true;
      setSrcIdx((i) => i + 1);
      window.setTimeout(() => {
        advancing.current = false;
      }, 500);
    } else if (sources.length > 0) {
      setFailed(true);
    }
  };

  if (failed) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center text-zinc-400">
        <p className="mb-4">This video could not be loaded.</p>
        <button
          onClick={() => history.push("/faptap")}
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700"
        >
          ‹ Back to FapTap
        </button>
      </div>
    );
  }
  if (!detail || sources.length === 0) {
    return <LoadingIndicator />;
  }

  return (
    <div className="min-h-screen w-full bg-zinc-950 px-4 py-4 text-zinc-100 md:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-3 flex items-center gap-3">
          <button
            onClick={() => history.push("/faptap")}
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 transition hover:bg-zinc-700"
          >
            ‹ Back
          </button>
          {detail.has_funscript && (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                handyArmed
                  ? "bg-emerald-600/20 text-emerald-400"
                  : "bg-zinc-800 text-zinc-500"
              }`}
              title={
                handyArmed
                  ? "Funscript loaded — the Handy follows this video"
                  : "Funscript available — connect the Handy in Settings to sync"
              }
            >
              {handyArmed ? "● Handy synced" : "○ Handy idle"}
            </span>
          )}
          <button
            className={`ml-auto rounded-full px-2.5 py-1 text-sm ${
              fav ? "bg-rose-600/20 text-rose-400" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
            onClick={() => setFav(faptapFavorites.toggle(id))}
          >
            {fav ? "♥ Favorited" : "♡ Favorite"}
          </button>
        </div>

        <video
          key={sources[srcIdx]}
          ref={videoRef}
          src={sources[srcIdx]}
          controls
          autoPlay
          playsInline
          onError={onVideoError}
          className="aspect-video w-full rounded-lg bg-black"
        />

        <div className="mt-4">
          <h1 className="text-xl font-semibold">{detail.name || `FapTap ${id}`}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-400">
            {detail.creator && <span>{detail.creator}</span>}
            {detail.views > 0 && <span>{detail.views.toLocaleString()} views</span>}
            {detail.vr && <span className="text-indigo-400">VR (flat view)</span>}
          </div>
          {detail.tags?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {detail.tags.map((t) => (
                <span
                  key={t.id}
                  className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-300"
                >
                  {t.name}
                </span>
              ))}
            </div>
          )}
          {detail.description && (
            <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm text-zinc-400">
              {detail.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});
