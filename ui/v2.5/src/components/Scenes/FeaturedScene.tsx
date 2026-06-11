
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useFindScenes } from "src/core/StashService";
import { ListFilterModel } from "src/models/list-filter/filter";
import * as GQL from "src/core/generated-graphql";
import { useConfigurationContext } from "src/hooks/Config";
import { IUIConfig } from "src/core/config";
import { SFWHeroPlaceholder } from "src/components/Shared/SFWHeroPlaceholder";
import { Play, Volume2, VolumeX } from "lucide-react";
import { TruncatedText } from "../Shared/TruncatedText";
import TextUtils from "src/utils/text";

export const FeaturedScene: React.FC = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isMuted, setIsMuted] = useState(true);

    const { configuration } = useConfigurationContext();
    const [currentIndex, setCurrentIndex] = useState(0);

    const filter = useMemo(() => {
        const f = new ListFilterModel(GQL.FilterMode.Scenes, configuration);
        f.itemsPerPage = 20;
        f.sortBy = "random";
        f.sortDirection = GQL.SortDirectionEnum.Desc;
        return f;
    }, [configuration]);

    const { data, loading } = useFindScenes(filter);

    const scenes = useMemo(() => data?.findScenes.scenes || [], [data]);
    const scene = scenes[currentIndex];

    useEffect(() => {
        if (videoRef.current && scene) {
            videoRef.current.load();
            videoRef.current.play().catch(() => {});
        }
    }, [scene]);

    const uiConfig = configuration?.ui as IUIConfig | undefined;
    if (configuration?.interface?.sfwContentMode && (uiConfig?.sfwBlurScenes ?? true))
        return <SFWHeroPlaceholder className="fixed top-0 left-0 w-screen h-[56.25vw] md:h-screen z-0 bg-black pointer-events-none" />;

    if (loading || !scene) return null;

    const handleVideoEnded = () => {
        setCurrentIndex((prev) => (prev + 1) % scenes.length);
    };

    const toggleMute = () => {
        if (videoRef.current) {
            videoRef.current.muted = !videoRef.current.muted;
            setIsMuted(videoRef.current.muted);
        }
    };

    const image = scene.paths.screenshot;
    const video = scene.paths.preview;
    const duration = scene.files[0]?.duration;
    const performers = scene.performers?.slice(0, 3) ?? [];
    const ratingStars = scene.rating100 ? Math.round(scene.rating100 / 20) : null;

    return (
        <div className="fixed top-0 left-0 w-screen h-[56.25vw] md:h-screen z-0 bg-black pointer-events-none md:pointer-events-auto">
            {/* Media Background */}
            <div className="absolute top-0 left-0 w-full h-full animate-in fade-in duration-1000">
                {video ? (
                    <video
                        ref={videoRef}
                        className="w-full h-full object-cover transition-opacity duration-700"
                        poster={image ?? undefined}
                        src={video}
                        autoPlay
                        loop={false}
                        muted={isMuted}
                        playsInline
                        onEnded={handleVideoEnded}
                    />
                ) : (
                    <img
                        src={image ?? undefined}
                        alt={scene.title ?? "Scene"}
                        className="w-full h-full object-cover"
                    />
                )}
                {/* Gradient Overlays */}
                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-black/90 via-black/40 to-transparent" />
                <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-background to-transparent" />
            </div>

            {/* Content Container */}
            <div className="absolute top-0 left-0 w-full h-full flex flex-col justify-center px-6 md:px-16 z-20 space-y-2 md:space-y-4 pointer-events-auto">
                {/* Studio row */}
                <div className="flex items-center gap-3 mb-1">
                    <span className="text-[10px] font-bold tracking-widest text-white/40 uppercase px-2 py-1 rounded border border-white/10">
                        Featured
                    </span>
                    {scene.studio && (
                        scene.studio.image_path ? (
                            <img
                                src={scene.studio.image_path}
                                alt={scene.studio.name}
                                className="h-5 w-auto max-w-[80px] object-contain opacity-70"
                            />
                        ) : (
                            <span className="text-xs font-semibold text-gray-400">{scene.studio.name}</span>
                        )
                    )}
                </div>

                <h2 className="text-2xl md:text-6xl font-bold text-white max-w-3xl line-clamp-4 md:line-clamp-2 drop-shadow-md leading-tight">
                    {scene.title || "Untitled Scene"}
                </h2>

                {/* Metadata strip */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-300">
                    {ratingStars !== null && (
                        <span className="flex items-center gap-0.5 text-yellow-400 text-xs tracking-wide">
                            {"★".repeat(ratingStars)}
                            {"☆".repeat(5 - ratingStars)}
                        </span>
                    )}
                    {duration !== undefined && (
                        <span className="text-gray-400">{TextUtils.secondsToTimestamp(duration)}</span>
                    )}
                    {performers.length > 0 && (
                        <>
                            <span className="text-gray-600">·</span>
                            <span>{performers.map((p) => p.name).join(" · ")}</span>
                        </>
                    )}
                </div>

                <div className="hidden md:block max-w-xl text-sm md:text-xl text-gray-200 drop-shadow-sm leading-relaxed">
                    <TruncatedText text={scene.details} lineCount={4} />
                </div>

                <div className="pt-2 md:pt-4 flex items-center gap-4 relative z-30">
                    <Link
                        to={`/scenes/${scene.id}`}
                        className="inline-flex items-center gap-2 px-4 md:px-8 py-1.5 md:py-2 bg-white hover:bg-white/90 text-black border-none rounded-full text-sm md:text-lg font-bold transition-colors shadow-lg"
                    >
                        <Play className="h-4 w-4 md:h-6 md:w-6 text-black fill-black" strokeWidth={0} />
                        Watch Now
                    </Link>

                    <button
                        onClick={toggleMute}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-all"
                    >
                        {isMuted ? <VolumeX className="h-5 w-5 md:h-6 md:w-6" /> : <Volume2 className="h-5 w-5 md:h-6 md:w-6" />}
                    </button>
                </div>
            </div>

        </div>
    );
};
