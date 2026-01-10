import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useFindScenes } from "src/core/StashService";
import { ListFilterModel } from "src/models/list-filter/filter";
import * as GQL from "src/core/generated-graphql";
import { useConfigurationContext } from "src/hooks/Config";
import { Play, Volume2, VolumeX } from "lucide-react";
import { PerformersCriterion } from "src/models/list-filter/criteria/performers";

interface IPerformerHeroProps {
    performer: GQL.PerformerDataFragment;
}

/**
 * Context-aware hero banner for the Performer detail page.
 * Fetches and displays a carousel of random scene previews filtered by the current performer.
 * Shown only when the performer has scenes and the page is not in edit mode.
 */
export const PerformerHero: React.FC<IPerformerHeroProps> = ({ performer }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isMuted, setIsMuted] = useState(true);
    const { configuration } = useConfigurationContext();
    const [currentIndex, setCurrentIndex] = useState(0);

    // Fetch 5 random scenes for this performer
    const filter = useMemo(() => {
        const f = new ListFilterModel(GQL.FilterMode.Scenes, configuration);
        f.itemsPerPage = 5;
        f.sortBy = "random";
        f.sortDirection = GQL.SortDirectionEnum.Desc;

        // Filter by specific performer ID
        const performerCriterion = new PerformersCriterion();
        performerCriterion.value = {
            items: [{ id: performer.id, label: performer.name || "" }],
            excluded: [],
        };
        performerCriterion.modifier = GQL.CriterionModifier.Includes;
        f.criteria.push(performerCriterion);

        return f;
    }, [configuration, performer.id]);

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
        <div className="relative w-full h-[50vh] min-h-[400px] overflow-hidden rounded-xl mb-8 bg-card shadow-2xl group">
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
                <div className="absolute bottom-0 left-0 w-full h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
            </div>

            {/* Content Container */}
            <div className="absolute top-0 left-0 w-full h-full flex flex-col justify-center px-8 md:px-16 z-10 space-y-4">
                <div className="flex items-center space-x-2 text-xs font-bold tracking-widest text-primary uppercase mb-2">
                    <span className="bg-primary/20 px-3 py-1 rounded text-primary-foreground border border-primary/20">
                        Featured Scene
                    </span>
                    {scene.studio?.name && (
                        <span className="text-gray-300 font-medium tracking-normal opacity-80">
                            • {scene.studio.name}
                        </span>
                    )}
                </div>

                <h2
                    className="text-4xl md:text-5xl lg:text-6xl font-bold text-white max-w-4xl line-clamp-2 drop-shadow-xl tracking-tight"
                    style={{ fontFamily: "'Poppins', sans-serif" }}
                >
                    {scene.title || "Untitled Scene"}
                </h2>

                <p
                    className="text-base md:text-lg text-gray-200 max-w-2xl line-clamp-3 drop-shadow-md leading-relaxed opacity-90"
                    style={{ fontFamily: "'Poppins', sans-serif" }}
                >
                    {scene.details}
                </p>

                <div className="pt-4 flex gap-4">
                    <Link
                        to={`/scenes/${scene.id}`}
                        className="inline-flex items-center gap-3 px-8 py-3 bg-white hover:bg-white/90 text-black rounded-full text-base font-bold transition-all transform hover:scale-105 shadow-xl hover:shadow-2xl"
                    >
                        <Play className="h-5 w-5 text-black fill-black" strokeWidth={0} />
                        Watch Now
                    </Link>
                </div>
            </div>

            {/* Mute Toggle */}
            <button
                onClick={toggleMute}
                className="absolute bottom-6 right-6 p-3 rounded-full bg-black/30 hover:bg-black/50 text-white/70 hover:text-white backdrop-blur-md transition-all border border-white/10"
            >
                {isMuted ? (
                    <VolumeX className="h-5 w-5" />
                ) : (
                    <Volume2 className="h-5 w-5" />
                )}
            </button>
        </div>
    );
};
