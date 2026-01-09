
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "react-bootstrap";
import { useFindScenes } from "src/core/StashService";
import { ListFilterModel } from "src/models/list-filter/filter";
import * as GQL from "src/core/generated-graphql";
import { useConfigurationContext } from "src/hooks/Config";
import { Play, Volume2, VolumeX } from "lucide-react";

export const FeaturedScene: React.FC = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isMuted, setIsMuted] = useState(true);
    const { configuration } = useConfigurationContext();
    const [currentIndex, setCurrentIndex] = useState(0);

    // Fetch 5 random scenes for variety
    const filter = useMemo(() => {
        const f = new ListFilterModel(GQL.FilterMode.Scenes, configuration);
        f.itemsPerPage = 5;
        f.sortBy = "random";
        f.sortDirection = GQL.SortDirectionEnum.Desc;
        return f;
    }, [configuration]);

    const { data, loading } = useFindScenes(filter);
    const scenes = data?.findScenes.scenes || [];
    const scene = scenes[currentIndex];

    useEffect(() => {
        if (videoRef.current && scene) {
            videoRef.current.load();
            videoRef.current.play().catch(() => { });
        }
    }, [scene]);

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

    return (
        <div className="relative w-full h-[40vh] min-h-[300px] overflow-hidden rounded-xl mb-6 bg-card shadow-lg group">
            {/* Media Background */}
            <div className="absolute top-0 left-0 w-full h-full">
                {video ? (
                    <video
                        ref={videoRef}
                        className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity duration-700"
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
                        className="w-full h-full object-cover opacity-60"
                    />
                )}
                {/* Gradient Overlays */}
                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-black/90 via-black/40 to-transparent" />
                <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
            </div>

            {/* Content Container */}
            <div className="absolute top-0 left-0 w-full h-full flex flex-col justify-center px-8 md:px-12 z-10 space-y-3">
                <div className="flex items-center space-x-2 text-xs font-bold tracking-widest text-primary uppercase mb-1">
                    <span className="bg-primary/20 px-2 py-1 rounded text-primary-foreground">Featured</span>
                    {scene.studio?.name && <span className="text-gray-300">• {scene.studio.name}</span>}
                </div>

                <h2 className="text-3xl md:text-4xl font-bold text-white max-w-2xl line-clamp-1 drop-shadow-md">
                    {scene.title || "Untitled Scene"}
                </h2>

                <p className="text-sm md:text-base text-gray-300 max-w-lg line-clamp-2 drop-shadow-sm leading-relaxed">
                    {scene.details}
                </p>

                <div className="pt-2">
                    <Link
                        to={`/scenes/${scene.id}`}
                        className="inline-flex items-center gap-2 px-6 py-2 bg-white hover:bg-white/90 text-black border-none rounded-full text-sm font-bold transition-colors shadow-lg"
                    >
                        <Play className="h-4 w-4 text-black fill-black" strokeWidth={0} />
                        Watch Now
                    </Link>
                </div>
            </div>

            {/* Mute Toggle */}
            <button
                onClick={toggleMute}
                className="absolute bottom-4 right-4 p-2 rounded-full bg-black/30 hover:bg-black/50 text-white/70 hover:text-white backdrop-blur-sm transition-all"
            >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
        </div>
    );
};
