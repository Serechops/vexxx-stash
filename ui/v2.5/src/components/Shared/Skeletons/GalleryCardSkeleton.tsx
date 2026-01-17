import React from "react";

interface IGalleryCardSkeletonProps {
    isMasonry?: boolean;
}

export const GalleryCardSkeleton: React.FC<IGalleryCardSkeletonProps> = ({ isMasonry }) => {
    // Masonry style random height, otherwise standard aspect ratio
    const style = isMasonry ? { height: Math.random() > 0.5 ? '300px' : '400px' } : {};

    return (
        <div
            className={`gallery-card skeleton-card relative rounded-xl overflow-hidden shadow-sm bg-zinc-900 animate-pulse ${isMasonry ? 'mb-4 break-inside-avoid' : 'h-full w-full'}`}
            style={style}
        >
            {/* Image Placeholder */}
            {!isMasonry && (
                <div className="w-full aspect-[4/3] bg-zinc-800 relative h-full">
                    <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-black/80 to-transparent"></div>
                    <div className="absolute bottom-3 left-3 right-3 flex flex-col gap-2">
                        <div className="h-5 bg-white/10 rounded w-3/4"></div>
                        <div className="h-3 bg-white/5 rounded w-1/2"></div>
                    </div>
                </div>
            )}

            {isMasonry && (
                <div className="absolute inset-0 bg-zinc-800">
                    <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-black/80 to-transparent"></div>
                </div>
            )}
        </div>
    );
};
