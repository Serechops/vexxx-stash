import React, { useEffect, useState } from "react";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { useFindImages } from "src/core/StashService";
import { useHistory } from "react-router-dom";

/**
 * Hero banner for the main Images listing page.
 * Features an elegant grid mosaic with smooth transitions.
 */
export const ImagesHero: React.FC = () => {
    const history = useHistory();
    const [activeIndex, setActiveIndex] = useState(0);
    const [isTransitioning, setIsTransitioning] = useState(false);

    // Fetch random images
    const { data, loading } = GQL.useFindImagesQuery({
        variables: {
            filter: {
                per_page: 15,
                sort: "random",
            },
            image_filter: {},
        },
        fetchPolicy: "no-cache",
    });

    const images = data?.findImages?.images || [];

    // Auto-advance with elegant transition
    useEffect(() => {
        if (images.length === 0) return;

        const interval = setInterval(() => {
            setIsTransitioning(true);
            setTimeout(() => {
                setActiveIndex((prev) => (prev + 1) % images.length);
                setIsTransitioning(false);
            }, 400);
        }, 5000);

        return () => clearInterval(interval);
    }, [images.length]);

    if (loading || images.length === 0) return null;

    const featuredImage = images[activeIndex];
    const thumbnailImages = images.slice(0, 8);

    return (
        <div className="fixed top-0 left-0 w-screen h-screen z-0 bg-black/95 select-none overflow-hidden hidden md:block">
            {/* Main Featured Image with Ken Burns Effect */}
            <div className="absolute inset-0 overflow-hidden">
                <div
                    className={cx(
                        "absolute inset-0 transition-opacity duration-1000",
                        isTransitioning ? "opacity-0" : "opacity-100"
                    )}
                    key={featuredImage?.id}
                >
                    <div className="absolute inset-0 animate-ken-burns">
                        <img
                            src={featuredImage?.paths?.preview || featuredImage?.paths?.thumbnail || ""}
                            alt=""
                            className="w-full h-full object-cover filter blur-sm scale-110"
                        />
                    </div>
                    {/* Vignette overlay */}
                    <div className="absolute inset-0 bg-gradient-radial from-transparent via-black/30 to-black/90" />
                </div>
            </div>

            {/* Elegant Gradient Overlays */}
            <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-background via-background/80 to-transparent z-10" />
            <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-background/90 to-transparent z-10" />
            <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-background/60 to-transparent z-10" />
            <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-background/60 to-transparent z-10" />

            {/* Floating Grid Mosaic */}
            <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                <div className="grid grid-cols-4 gap-3 w-[70%] max-w-5xl opacity-40">
                    {thumbnailImages.map((image, index) => {
                        const delay = index * 100;
                        const isActive = index === activeIndex % thumbnailImages.length;
                        
                        return (
                            <div
                                key={image.id}
                                className={cx(
                                    "aspect-[3/4] rounded-lg overflow-hidden shadow-2xl",
                                    "transform transition-all duration-700 ease-out",
                                    "hover:scale-105 hover:shadow-primary/50",
                                    isActive ? "ring-2 ring-primary/60 scale-105" : "hover:ring-2 hover:ring-white/30"
                                )}
                                style={{
                                    animationDelay: `${delay}ms`,
                                    opacity: isActive ? 0.9 : 0.5,
                                }}
                            >
                                <img
                                    src={image.paths.thumbnail || ""}
                                    alt=""
                                    className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Subtle animated particles/dots for depth */}
            <div className="absolute inset-0 z-15 pointer-events-none opacity-20">
                {[...Array(20)].map((_, i) => (
                    <div
                        key={i}
                        className="absolute w-1 h-1 bg-white rounded-full animate-float"
                        style={{
                            left: `${Math.random() * 100}%`,
                            top: `${Math.random() * 100}%`,
                            animationDelay: `${Math.random() * 5}s`,
                            animationDuration: `${10 + Math.random() * 10}s`,
                        }}
                    />
                ))}
            </div>

            <style jsx>{`
                @keyframes ken-burns {
                    0% {
                        transform: scale(1) translate(0, 0);
                    }
                    50% {
                        transform: scale(1.1) translate(-2%, -2%);
                    }
                    100% {
                        transform: scale(1) translate(0, 0);
                    }
                }
                @keyframes float {
                    0%, 100% {
                        transform: translateY(0) translateX(0);
                        opacity: 0;
                    }
                    50% {
                        opacity: 1;
                    }
                    100% {
                        transform: translateY(-100vh) translateX(10vw);
                        opacity: 0;
                    }
                }
                .animate-ken-burns {
                    animation: ken-burns 20s ease-in-out infinite;
                }
                .animate-float {
                    animation: float linear infinite;
                }
                .bg-gradient-radial {
                    background: radial-gradient(circle at center, var(--tw-gradient-stops));
                }
            `}</style>
        </div>
    );
};
