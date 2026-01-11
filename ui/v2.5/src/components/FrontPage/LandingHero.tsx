import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useFindScenes } from "src/core/StashService";
import { ListFilterModel } from "src/models/list-filter/filter";
import * as GQL from "src/core/generated-graphql";
import { useConfigurationContext } from "src/hooks/Config";

export const LandingHero: React.FC = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [currentIndex, setCurrentIndex] = useState(0);
    const { configuration } = useConfigurationContext();

    // Create a filter to fetch 10 random scenes
    const filter = useMemo(() => {
        const f = new ListFilterModel(GQL.FilterMode.Scenes, configuration);
        f.itemsPerPage = 10;
        f.sortBy = "random";
        f.sortDirection = GQL.SortDirectionEnum.Desc;
        return f;
    }, [configuration]);

    const { data } = useFindScenes(filter);
    const scenes = data?.findScenes.scenes || [];
    const scene = scenes[currentIndex];

    useEffect(() => {
        if (videoRef.current && scene) {
            videoRef.current.load();
            videoRef.current.play().catch(() => { });
        }
    }, [scene]);

    const handleVideoEnded = () => {
        setCurrentIndex((prev) => (prev + 1) % scenes.length);
    };

    const image = scene?.paths.screenshot;
    const video = scene?.paths.preview;

    return (
        <div className="relative w-full h-[85vh] min-h-[600px] overflow-hidden mb-12 bg-black">
            {/* Background Media */}
            <div className="absolute inset-0 animate-in fade-in duration-1000">
                {video ? (
                    <video
                        ref={videoRef}
                        className="w-full h-full object-cover opacity-60" // Lower opacity for better text contrast
                        poster={image ?? undefined}
                        src={video}
                        autoPlay
                        loop={false}
                        muted={true}
                        playsInline
                        onEnded={handleVideoEnded}
                    />
                ) : (
                    // Fallback to gradient if no video loaded yet
                    <div className="w-full h-full bg-gradient-to-br from-gray-900 via-gray-950 to-black" />
                )}

                {/* Gradient Overlays for Readability/Style */}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-transparent to-black/80" />
            </div>

            {/* Content Container */}
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center z-10">

                {/* Logo & Branding */}
                <div className="mb-8 animate-in slide-in-from-bottom-4 duration-1000 delay-100">
                    <img
                        src="/vexxx.png"
                        alt="Vexxx"
                        className="w-128 h-96 lg:w-auto lg:h-auto object-contain drop-shadow-[0_0_25px_rgba(255,255,255,0.2)]"
                    />
                </div>

                <div className="max-w-2xl mx-auto space-y-6 animate-in slide-in-from-bottom-8 duration-1000 delay-200">

                </div>
            </div>

            {/* Bottom Fade transition to content */}
            <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        </div>
    );
};
