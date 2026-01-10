import React, { useEffect, useState } from "react";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { useHistory } from "react-router-dom";

/**
 * Hero banner for the main Performers listing page.
 * Displays a 3D carousel of random performers.
 */
export const PerformersHero: React.FC = () => {
    const [activeIndex, setActiveIndex] = useState(0);
    const history = useHistory();

    // Fetch random performers
    const { data, loading } = GQL.useFindPerformersQuery({
        variables: {
            filter: {
                per_page: 50,
                sort: "random",
            },
        },
    });

    const performers = (data?.findPerformers?.performers || [])
        .filter(p => p.image_path)
        .slice(0, 20);

    // Auto-advance
    useEffect(() => {
        if (performers.length === 0) return;
        const interval = setInterval(() => {
            setActiveIndex((prev) => (prev + 1) % performers.length);
        }, 3000); // 3 seconds
        return () => clearInterval(interval);
    }, [performers.length]);

    if (loading || performers.length === 0) return null;

    const getStyle = (index: number) => {
        const length = performers.length;
        let diff = (index - activeIndex + length) % length;
        if (diff > length / 2) diff -= length;

        const absDiff = Math.abs(diff);
        const isActive = diff === 0;

        // Hide items too far away
        if (absDiff > 3) return { display: 'none' };

        // Config
        const spread = 16; // Spacing percentage (reduced for tighter inactive cards)
        const left = 50 + (diff * spread);
        const zIndex = 50 - absDiff;

        // Active item scale
        const scale = isActive ? 2.0 : 2.0;
        const opacity = isActive ? 1 : 0.4;

        // 3D transform for depth
        // Active item is brought forward significantly
        const translateZ = isActive ? 100 : 0;

        // Rotate text logic handled in CSS/className

        return {
            left: `${left}%`,
            zIndex,
            opacity,
            transform: `translateX(-50%) translateZ(${translateZ}px) scale(${scale})`,
        };
    };

    const handlePerformerClick = (id: string) => {
        history.push(`/performers/${id}`);
    };

    return (
        <div className="relative w-full h-[60vh] overflow-hidden bg-[#111113] select-none flex items-center justify-center perspective-1000 mb-6">
            {/* Background Gradients mimicking the CodePen */}
            <div className="absolute inset-0 bg-gradient-radial from-[#950923]/20 to-[#111113] opacity-50 z-0 pointer-events-none" />

            <div className="relative w-full h-full flex items-center justify-center preserve-3d">
                {performers.map((performer, index) => {
                    const style = getStyle(index);
                    if (style.display === 'none') return null;

                    const isActive = style.zIndex === 50;
                    const imagePath = performer.image_path || "";

                    return (
                        <div
                            key={performer.id}
                            className={cx(
                                "absolute top -translate-y-1/2 transition-all duration-1000 ease-in-out cursor-pointer group",
                                "w-[200px] h-[400px] rounded-xl overflow-hidden shadow-2xl bg-gray-900",
                                isActive ? "w-[300px] z-50 brightness-110" : "grayscale-[30%]"
                            )}
                            style={style}
                            onClick={() => handlePerformerClick(performer.id)}
                        >
                            <img
                                src={imagePath}
                                alt={performer.name || ""}
                                className="w-full h-full object-cover transition-transform duration-1000"
                            />

                            {/* Overlay Gradient (purple/red mix) */}
                            <div className="absolute inset-0 bg-gradient-to-br from-[#820d0dcc] to-[#27085ccc] mix-blend-multiply opacity-0 group-[.active]:opacity-0 transition-opacity duration-500" />

                            {/* Active Overlay (lighter) */}
                            {isActive && (
                                <div className="absolute inset-0 bg-black/10 transition-opacity duration-1000" />
                            )}

                            {/* Bottom gradient for text readability */}
                            {isActive && (
                                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent" />
                            )}

                            {/* Text Name - static display */}
                            {isActive && (
                                <div className="absolute left-5 bottom-4 text-white z-10">
                                    <h3
                                        className="text-2xl font-bold italic tracking-wider drop-shadow-lg"
                                        style={{ fontFamily: "'Poppins', sans-serif" }}
                                    >
                                        {performer.name}
                                    </h3>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
