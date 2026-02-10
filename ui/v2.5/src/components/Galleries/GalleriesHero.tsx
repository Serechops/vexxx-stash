import React, { useEffect, useState } from "react";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { useHistory } from "react-router-dom";

/**
 * Hero banner for the main Galleries listing page.
 * Features an elegant split-panel showcase with smooth transitions.
 */
export const GalleriesHero: React.FC = () => {
    const history = useHistory();
    const [activeIndex, setActiveIndex] = useState(0);
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    // Fetch random galleries
    const { data, loading } = GQL.useFindGalleriesQuery({
        variables: {
            filter: {
                per_page: 12,
                sort: "random",
            },
        },
        fetchPolicy: "no-cache",
    });

    const galleries = (data?.findGalleries?.galleries || []).filter(
        (g) => g.paths?.cover
    );

    // Auto-advance with elegant timing
    useEffect(() => {
        if (galleries.length === 0) return;

        const interval = setInterval(() => {
            setActiveIndex((prev) => (prev + 1) % galleries.length);
        }, 6000);

        return () => clearInterval(interval);
    }, [galleries.length]);

    if (loading || galleries.length === 0) return null;

    const featuredGallery = galleries[activeIndex];
    const sideGalleries = galleries.slice(0, 6);

    const handleGalleryClick = (galleryId: string) => {
        history.push(`/galleries/${galleryId}`);
    };

    return (
        <div className="fixed top-0 left-0 w-screen h-screen z-0 bg-gradient-to-br from-black via-gray-900 to-black select-none overflow-hidden hidden md:block">
            {/* Main Featured Gallery - Left Side */}
            <div className="absolute inset-0 flex">
                {/* Large featured area */}
                <div className="relative w-2/3 h-full overflow-hidden group cursor-pointer"
                    onClick={() => handleGalleryClick(featuredGallery.id)}
                >
                    {/* Background image with parallax effect */}
                    <div className="absolute inset-0 transition-transform duration-700 group-hover:scale-105">
                        <img
                            src={featuredGallery.paths?.cover || ""}
                            alt={featuredGallery.title || "Gallery"}
                            className="w-full h-full object-cover"
                        />
                        {/* Gradient overlays for depth */}
                        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-black/80" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/40" />
                    </div>

                    {/* Content overlay */}
                    <div className="absolute inset-0 flex flex-col justify-end p-12 z-10">
                        <div className="max-w-2xl space-y-4 transform transition-all duration-500 group-hover:translate-y-[-8px]">
                            <div className="inline-block px-4 py-1.5 bg-primary/20 backdrop-blur-sm border border-primary/30 rounded-full text-primary text-sm font-medium mb-2">
                                Featured Gallery
                            </div>
                            {featuredGallery.title && (
                                <h2 className="text-5xl font-bold text-white leading-tight drop-shadow-2xl">
                                    {featuredGallery.title}
                                </h2>
                            )}
                            {featuredGallery.image_count !== undefined && (
                                <p className="text-xl text-white/80 font-light">
                                    {featuredGallery.image_count} {featuredGallery.image_count === 1 ? "image" : "images"}
                                </p>
                            )}
                            <div className="pt-4">
                                <span className="inline-flex items-center gap-2 text-white/70 group-hover:text-white transition-colors">
                                    <span>View Gallery</span>
                                    <svg className="w-5 h-5 transform group-hover:translate-x-2 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                    </svg>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Elegant sidebar grid */}
                <div className="relative w-1/3 h-full bg-black/50 backdrop-blur-md">
                    <div className="h-full overflow-hidden p-6 space-y-4">
                        {sideGalleries.map((gallery, index) => {
                            const isHovered = hoveredId === gallery.id;
                            const delay = index * 50;
                            
                            return (
                                <div
                                    key={gallery.id}
                                    className={cx(
                                        "relative h-[calc(100%/6-1rem)] rounded-xl overflow-hidden",
                                        "transform transition-all duration-500 cursor-pointer",
                                        "hover:scale-105 hover:shadow-2xl hover:shadow-primary/30",
                                        "opacity-0 animate-fade-in-up"
                                    )}
                                    style={{
                                        animationDelay: `${delay}ms`,
                                        animationFillMode: 'forwards',
                                    }}
                                    onClick={() => handleGalleryClick(gallery.id)}
                                    onMouseEnter={() => setHoveredId(gallery.id)}
                                    onMouseLeave={() => setHoveredId(null)}
                                >
                                    <img
                                        src={gallery.paths?.cover || ""}
                                        alt={gallery.title || ""}
                                        className={cx(
                                            "w-full h-full object-cover transition-transform duration-700",
                                            isHovered && "scale-110"
                                        )}
                                    />
                                    {/* Overlay */}
                                    <div className={cx(
                                        "absolute inset-0 bg-gradient-to-r from-black/80 to-transparent",
                                        "transition-opacity duration-300",
                                        isHovered ? "opacity-90" : "opacity-60"
                                    )} />
                                    
                                    {/* Info */}
                                    <div className="absolute inset-0 flex flex-col justify-end p-4">
                                        {gallery.title && (
                                            <h3 className="text-white font-semibold text-sm truncate mb-1">
                                                {gallery.title}
                                            </h3>
                                        )}
                                        {gallery.image_count !== undefined && (
                                            <p className="text-white/60 text-xs">
                                                {gallery.image_count} {gallery.image_count === 1 ? "image" : "images"}
                                            </p>
                                        )}
                                    </div>

                                    {/* Hover indicator */}
                                    {isHovered && (
                                        <div className="absolute top-4 right-4 w-2 h-2 bg-primary rounded-full animate-pulse" />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Elegant bottom gradient */}
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-background via-background/60 to-transparent z-20 pointer-events-none" />
            <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background/80 to-transparent z-20 pointer-events-none" />

            <style jsx>{`
                @keyframes fade-in-up {
                    from {
                        opacity: 0;
                        transform: translateY(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                .animate-fade-in-up {
                    animation: fade-in-up 0.6s ease-out;
                }
            `}</style>
        </div>
    );
};
