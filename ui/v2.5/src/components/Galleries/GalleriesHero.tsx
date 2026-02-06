import React, { useEffect, useState } from "react";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { useHistory } from "react-router-dom";

/**
 * Hero banner for the main Galleries listing page.
 * Displays a 3D carousel of random gallery covers.
 */
export const GalleriesHero: React.FC = () => {
    const history = useHistory();
    const [activeIndex, setActiveIndex] = useState(0);

    // Fetch random galleries
    const { data, loading } = GQL.useFindGalleriesQuery({
        variables: {
            filter: {
                per_page: 25,
                sort: "random",
            },
        },
        fetchPolicy: "no-cache",
    });

    const galleries = (data?.findGalleries?.galleries || []).filter(
        (g) => g.paths?.cover
    );

    // Auto-advance carousel
    useEffect(() => {
        if (galleries.length === 0) return;

        const interval = setInterval(() => {
            setActiveIndex((prev) => (prev + 1) % galleries.length);
        }, 3000); // 3 seconds per slide

        return () => clearInterval(interval);
    }, [galleries.length]);

    if (loading || galleries.length === 0) return null;

    const getStyle = (index: number) => {
        const length = galleries.length;
        // Calculate shortest distance handling wrap-around
        let diff = (index - activeIndex + length) % length;
        if (diff > length / 2) diff -= length;

        // Configuration
        const spread = 15; // Percentage / spacing unit
        const scaleStep = 0.1;
        const opacityStep = 0.25;

        const absDiff = Math.abs(diff);

        // Hide items too far away to reduce rendering load/clutter
        if (absDiff > 3) return { display: "none" };

        const zIndex = 10 - absDiff;
        const scale = Math.max(0.4, 1 - absDiff * scaleStep);
        const opacity = Math.max(0, 1 - absDiff * opacityStep);
        // Position: Center (50%) + offset
        const left = 50 + diff * spread;

        return {
            left: `${left}%`,
            zIndex: zIndex,
            transform: `translateX(-50%) translateZ(0) scale(${scale})`,
            opacity: opacity,
        };
    };

    const handleGalleryClick = (galleryId: string) => {
        history.push(`/galleries/${galleryId}`);
    };

    return (
        <div className="fixed top-0 left-0 w-screen h-[56.25vw] md:h-screen z-0 bg-background select-none items-center justify-center perspective-1000 hidden md:flex">
            {/* Gradient Overlay for integration with content below */}
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-background to-transparent z-20" />
            <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent z-20" />

            {galleries.map((gallery, index) => {
                const src = gallery.paths?.cover || "";
                const style = getStyle(index);

                if (style.display === "none") return null;

                const isActive = index === activeIndex;

                return (
                    <div
                        key={gallery.id}
                        className={cx(
                            "absolute top-[-1%] -translate-y-1/2 transition-all duration-700 ease-in-out origin-center h-[100%] w-auto aspect-[2/3] rounded-xl shadow-2xl overflow-hidden bg-gray-900",
                            isActive && "cursor-pointer hover:scale-105"
                        )}
                        style={style}
                        onClick={() => isActive && handleGalleryClick(gallery.id)}
                    >
                        <img
                            src={src}
                            alt={gallery.title || "Gallery"}
                            className="w-full h-full object-cover"
                        />
                        {/* Reflection/Shine effect */}
                        <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-30 pointer-events-none" />
                        
                        {/* Gallery info overlay for active item */}
                        {isActive && (
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-4">
                                {gallery.title && (
                                    <div className="text-white font-semibold text-lg truncate">
                                        {gallery.title}
                                    </div>
                                )}
                                {gallery.image_count !== undefined && (
                                    <div className="text-white/70 text-sm">
                                        {gallery.image_count} {gallery.image_count === 1 ? "image" : "images"}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
