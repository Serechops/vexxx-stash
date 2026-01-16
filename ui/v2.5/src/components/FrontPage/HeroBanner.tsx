
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useFindScenes } from "src/core/StashService";
import { ListFilterModel } from "src/models/list-filter/filter";
import * as GQL from "src/core/generated-graphql";
import { useConfigurationContext } from "src/hooks/Config";
import {
    Play,
    Info,
    VolumeX,
    Volume2,
} from "lucide-react";
import cx from "classnames";

export const HeroBanner: React.FC = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isMuted, setIsMuted] = useState(true);
    const [currentIndex, setCurrentIndex] = useState(0);
    const { configuration } = useConfigurationContext();

    // Create a filter to fetch 40 random scenes (increased to ensure we find ones with previews)
    const filter = useMemo(() => {
        const f = new ListFilterModel(GQL.FilterMode.Scenes, configuration);
        f.itemsPerPage = 40;
        f.sortBy = "random";
        f.sortDirection = GQL.SortDirectionEnum.Desc;
        return f;
    }, [configuration]);

    const { data, loading } = useFindScenes(filter);

    // Filter scenes to only include those with a valid video preview
    const scenes = useMemo(() => {
        return (data?.findScenes.scenes || []).filter(s => s.has_preview);
    }, [data]);

    const scene = scenes[currentIndex];

    useEffect(() => {
        if (videoRef.current && scene) {
            videoRef.current.load(); // Reload video source
            videoRef.current.play().catch(() => { });
        }
    }, [scene]);

    const toggleMute = () => {
        if (videoRef.current) {
            videoRef.current.muted = !videoRef.current.muted;
            setIsMuted(videoRef.current.muted);
        }
    };

    const handleVideoEnded = () => {
        setCurrentIndex((prev) => (prev + 1) % scenes.length);
    };

    if (loading || !scene) return null;

    const image = scene.paths.screenshot;
    const video = scene.paths.preview;

    return (
        <div className="relative w-screen h-[56.25vw] md:h-screen bg-black left-[calc(50%-50vw)] right-[calc(50%-50vw)]">
            {/* Background Media */}
            <div className="absolute top-0 left-0 w-full h-full animate-in fade-in duration-1000">
                {video ? (
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
                    />
                ) : (
                    <img
                        src={image ?? undefined}
                        alt={scene.title ?? "Scene"}
                        className="w-full h-full object-cover"
                    />
                )}
                {/* Gradient Overlay */}
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
                <h1 className="text-2xl md:text-6xl font-bold text-white max-w-3xl drop-shadow-lg line-clamp-2 md:line-clamp-4 leading-tight pb-1 md:pb-3">
                    {scene.title || "Untitled Scene"}
                </h1>

                <p className="text-sm md:text-xl text-gray-200 max-w-xl line-clamp-3 drop-shadow-md hidden md:block">
                    {scene.details}
                </p>

                <div className="flex gap-4 pt-2 md:pt-4">
                    <Link
                        to={`/scenes/${scene.id}`}
                        className="flex items-center gap-2 px-4 md:px-8 py-1.5 md:py-2 bg-white text-black hover:bg-gray-200 border-none rounded text-sm md:text-lg font-bold transition-colors"
                    >
                        <Play className="mr-2 h-5 w-5 md:h-7 md:w-7 text-black fill-black" strokeWidth={0} /> Play
                    </Link>
                </div>
            </div>

            {/* Volume Control */}
            <div className="absolute bottom-32 right-12 z-20">
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
