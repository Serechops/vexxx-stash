import React from "react";

interface IImageCardSkeletonProps { }

export const ImageCardSkeleton: React.FC<IImageCardSkeletonProps> = () => {
    return (
        <div
            className="image-card skeleton-card relative rounded-lg overflow-hidden bg-zinc-900 animate-pulse shadow-sm aspect-[4/3] w-full"
        >
            <div className="absolute inset-0 bg-zinc-800"></div>
        </div>
    );
};
