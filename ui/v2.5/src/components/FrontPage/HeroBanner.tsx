
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useFindScenes } from "src/core/StashService";
import { ListFilterModel } from "src/models/list-filter/filter";
import SceneQueue from "src/models/sceneQueue";
import * as GQL from "src/core/generated-graphql";
import { useConfigurationContext } from "src/hooks/Config";
import { IUIConfig } from "src/core/config";
import { SFWHeroPlaceholder } from "src/components/Shared/SFWHeroPlaceholder";
import { Play, Info, VolumeX, Volume2 } from "lucide-react";
import { TruncatedText } from "../Shared/TruncatedText";

const IMAGE_SLIDE_DURATION_MS = 8000;
// Safety net: a real preview ends well before this. Guards against a preview
// that plays but never fires `ended` (e.g. a truncated/looping segment).
const VIDEO_MAX_DURATION_MS = 30000;
// If a preview that we expected to play hasn't delivered a single frame within
// this window, treat it as failed and fall back to the still image. Covers the
// common case where `paths.preview` is a non-empty URL but no preview file
// exists, so the <video> silently stalls on its poster without firing `error`.
const VIDEO_STALL_TIMEOUT_MS = 6000;

function formatDuration(seconds: number): string {
    if (seconds < 3600) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, "0")}`;
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

export const HeroBanner: React.FC = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isMuted, setIsMuted] = useState(true);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [videoErrored, setVideoErrored] = useState(false);

    const { configuration } = useConfigurationContext();

    const filter = useMemo(() => {
        const f = new ListFilterModel(GQL.FilterMode.Scenes, configuration);
        f.itemsPerPage = 40;
        f.sortBy = "random";
        f.sortDirection = GQL.SortDirectionEnum.Desc;
        return f;
    }, [configuration]);

    const { data, loading } = useFindScenes(filter);

    const scenes = useMemo(() => data?.findScenes.scenes || [], [data]);
    const scene = scenes[currentIndex];
    const hasVideo = !!scene?.paths.preview && !videoErrored;

    const sceneQueue = useMemo(() => SceneQueue.fromListFilterModel(filter), [filter]);

    useEffect(() => {
        setVideoErrored(false);
        if (videoRef.current && scene) {
            videoRef.current.load();
            videoRef.current.play().catch(() => {});
        }
    }, [scene]);

    const handleVideoEnded = () => {
        setCurrentIndex((prev) => (prev + 1) % scenes.length);
    };

    const handleVideoError = () => {
        setVideoErrored(true);
    };

    // Detect a preview that never actually starts playing (silent 404 / stall).
    // If no frame is available after the stall window, fall back to the image.
    useEffect(() => {
        if (!scene || !hasVideo) return;
        const stall = window.setTimeout(() => {
            const v = videoRef.current;
            // readyState < HAVE_CURRENT_DATA (2) means nothing has decoded yet.
            if (!v || v.readyState < 2) setVideoErrored(true);
        }, VIDEO_STALL_TIMEOUT_MS);
        return () => window.clearTimeout(stall);
    }, [scene, hasVideo]);

    // Always keep an advance timer running so the banner can never freeze on a
    // slide. A playing preview advances early via `onEnded`; the still image and
    // any silently-stuck video advance when this timer fires.
    useEffect(() => {
        if (!scene || scenes.length === 0) return;
        const dwell = hasVideo ? VIDEO_MAX_DURATION_MS : IMAGE_SLIDE_DURATION_MS;
        const timer = window.setTimeout(handleVideoEnded, dwell);
        return () => window.clearTimeout(timer);
    }, [scene, hasVideo, scenes.length]);

    const toggleMute = () => {
        if (videoRef.current) {
            videoRef.current.muted = !videoRef.current.muted;
            setIsMuted(videoRef.current.muted);
        }
    };

    const uiConfig = configuration?.ui as IUIConfig | undefined;
    if (configuration?.interface?.sfwContentMode && (uiConfig?.sfwBlurScenes ?? true))
        return <SFWHeroPlaceholder className="w-full h-full bg-black" />;

    if (loading || !scene) return null;

    const image = scene.paths.screenshot;
    const video = scene.paths.preview;
    const duration = scene.files[0]?.duration;
    const performers = scene.performers?.slice(0, 3) ?? [];
    const ratingStars = scene.rating100 ? Math.round(scene.rating100 / 20) : null;

    return (
        <div className="relative w-screen h-[56.25vw] md:h-screen bg-black left-[calc(50%-50vw)] right-[calc(50%-50vw)]">
            {/* Background Media */}
            <div className="absolute top-0 left-0 w-full h-full animate-in fade-in duration-1000">
                {video && !videoErrored ? (
                    <video
                        ref={videoRef}
                        className="w-full h-full object-cover"
                        poster={image ?? undefined}
                        src={video}
                        autoPlay
                        loop={false}
                        muted={isMuted}
                        playsInline
                        onEnded={handleVideoEnded}
                        onError={handleVideoError}
                    />
                ) : (
                    <img
                        src={image ?? undefined}
                        alt={scene.title ?? "Scene"}
                        className="w-full h-full object-cover"
                    />
                )}
                {/* Gradient Overlays */}
                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
                <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-background to-transparent" />
            </div>

            {/* Content */}
            <div className="absolute top-0 left-0 w-full h-full flex flex-col justify-center px-6 md:px-16 z-10 space-y-2 md:space-y-4">
                {scene.studio?.image_path && (
                    <img
                        src={scene.studio.image_path}
                        alt={scene.studio.name ?? "Studio"}
                        className="h-10 md:h-16 w-auto object-contain mb-2 drop-shadow-lg self-start"
                    />
                )}

                <h1 className="text-2xl md:text-6xl font-bold text-white max-w-3xl drop-shadow-lg line-clamp-4 md:line-clamp-3 leading-tight pb-1 md:pb-3">
                    {scene.title || "Untitled Scene"}
                </h1>

                {/* Metadata strip */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-300">
                    {ratingStars !== null && (
                        <span className="flex items-center gap-0.5 text-yellow-400 text-xs tracking-wide">
                            {"★".repeat(ratingStars)}
                            {"☆".repeat(5 - ratingStars)}
                        </span>
                    )}
                    {duration !== undefined && (
                        <span className="text-gray-400">{formatDuration(duration)}</span>
                    )}
                    {performers.length > 0 && (
                        <>
                            <span className="text-gray-600">·</span>
                            <span>{performers.map((p) => p.name).join(" · ")}</span>
                        </>
                    )}
                </div>

                <div className="hidden md:block max-w-xl text-sm md:text-xl text-gray-200 drop-shadow-md">
                    <TruncatedText text={scene.details} lineCount={4} />
                </div>

                <div className="flex gap-3 pt-2 md:pt-4">
                    <Link
                        to={sceneQueue.makeLink(scene.id, { sceneIndex: currentIndex, autoPlay: true })}
                        className="flex items-center gap-2 px-4 md:px-8 py-1.5 md:py-2 bg-white text-black hover:bg-gray-200 border-none rounded text-sm md:text-lg font-bold transition-colors"
                    >
                        <Play className="mr-2 h-5 w-5 md:h-7 md:w-7 text-black fill-black" strokeWidth={0} /> Play
                    </Link>
                    <Link
                        to={`/scenes/${scene.id}`}
                        className="flex items-center gap-2 px-4 md:px-8 py-1.5 md:py-2 bg-white/10 hover:bg-white/20 text-white border border-white/30 rounded text-sm md:text-lg font-semibold transition-colors backdrop-blur-sm"
                    >
                        <Info className="h-5 w-5 md:h-6 md:w-6" /> More Info
                    </Link>
                </div>
            </div>

            {/* Volume control */}
            <div className="absolute bottom-36 right-6 md:right-16 z-20">
                <button
                    onClick={toggleMute}
                    className="p-3 rounded-full border border-gray-400/50 bg-black/20 hover:bg-black/40 text-white transition backdrop-blur-sm"
                >
                    {isMuted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
                </button>
            </div>

        </div>
    );
};
