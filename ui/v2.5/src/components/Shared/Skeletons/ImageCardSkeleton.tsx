import React from "react";

interface IImageCardSkeletonProps {
    zoomIndex?: number;
}

export const ImageCardSkeleton: React.FC<IImageCardSkeletonProps> = ({ zoomIndex = 0 }) => {
    // Random height for masonry look simulation
    const height = Math.random() > 0.5 ? '300px' : '400px';

    return (
        <div
            className="image-card skeleton-card relative rounded-lg overflow-hidden bg-zinc-900 animate-pulse mb-4 break-inside-avoid shadow-sm"
            style={{ height }}
        >
            <div className="absolute inset-0 bg-zinc-800"></div>
        </div>
    );
};
