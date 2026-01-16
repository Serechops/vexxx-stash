import React, { useEffect, useState } from "react";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { useFindImages } from "src/core/StashService";

export const ImagesHero: React.FC = () => {
    const [activeIndex, setActiveIndex] = useState(0);

    // Fetch random images
    const { data, loading } = GQL.useFindImagesQuery({
        variables: {
            filter: {
                per_page: 25, // Fetch a few more for better density
                sort: "random",
            },
            image_filter: {},
        },
    });

    const images = data?.findImages?.images || [];

    // Auto-advance carousel
    useEffect(() => {
        if (images.length === 0) return;

        const interval = setInterval(() => {
            setActiveIndex((prev) => (prev + 1) % images.length);
        }, 3000); // 3 seconds per slide

        return () => clearInterval(interval);
    }, [images.length]);

    if (loading || images.length === 0) return null;

    const getStyle = (index: number) => {
        const length = images.length;
        // Calculate shortest distance handling wrap-around
        let diff = (index - activeIndex + length) % length;
        if (diff > length / 2) diff -= length;

        // Configuration
        const spread = 15; // Percentage / spacing unit
        const scaleStep = 0.1;
        const opacityStep = 0.25;

        const absDiff = Math.abs(diff);
        const isActive = diff === 0;

        // Hide items too far away to reduce rendering load/clutter
        if (absDiff > 3) return { display: 'none' };

        const zIndex = 10 - absDiff;
        const scale = Math.max(0.4, 1 - absDiff * scaleStep);
        const opacity = Math.max(0, 1 - absDiff * opacityStep);
        // Position: Center (50%) + offset
        const left = 50 + (diff * spread);

        return {
            left: `${left}%`,
            zIndex: zIndex,
            transform: `translateX(-50%) translateZ(0) scale(${scale})`,
            opacity: opacity,
        };
    };

    return (
        <div className="fixed top-0 left-0 w-screen h-[56.25vw] md:h-screen z-0 bg-background select-none pointer-events-none items-center justify-center perspective-1000 hidden md:flex">
            {/* Gradient Overlay for integration with content below */}
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-background to-transparent z-20" />
            <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent z-20" />

            {images.map((image, index) => {
                // Use preview or thumbnail, fallback to empty string
                const src = image.paths.preview || image.paths.thumbnail || "";
                const style = getStyle(index);

                if (style.display === 'none') return null;

                return (
                    <div
                        key={image.id}
                        className="absolute top-[-1%] -translate-y-1/2 transition-all duration-700 ease-in-out origin-center h-[100%] w-auto aspect-[2/3] rounded-xl shadow-2xl overflow-hidden bg-gray-900"
                        style={style}
                    >
                        <img
                            src={src}
                            alt=""
                            className="w-full h-full object-cover"
                        />
                        {/* Reflection/Shine effect */}
                        <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-30 pointer-events-none" />
                    </div>
                );
            })}
        </div>
    );
};
