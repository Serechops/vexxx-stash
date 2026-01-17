import React from "react";

interface ITagCardSkeletonProps { }

export const TagCardSkeleton: React.FC<ITagCardSkeletonProps> = () => {
    return (
        <div
            className="tag-card skeleton-card relative rounded-md overflow-hidden shadow-sm bg-card animate-pulse flex flex-col w-full h-full"
        >
            {/* Image Aspect Ratio Placeholder - 2:1 */}
            <div className="w-full aspect-[2/1] bg-zinc-800 flex items-center justify-center">
                <div className="w-12 h-12 bg-zinc-700/50 rounded"></div>
            </div>

            {/* Content Placeholder - Footer (Title + Desc + Meta) */}
            <div className="p-3 flex flex-col gap-2 min-h-[4rem]">
                {/* Title */}
                <div className="h-5 bg-zinc-700 rounded w-1/2 mb-2"></div>

                {/* Description Lines */}
                <div className="h-3 bg-zinc-800 rounded w-full"></div>
                <div className="h-3 bg-zinc-800 rounded w-3/4"></div>
            </div>
        </div>
    );
};
