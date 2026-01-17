import React from "react";

interface IStudioCardSkeletonProps { }

export const StudioCardSkeleton: React.FC<IStudioCardSkeletonProps> = () => {
    return (
        <div
            className="studio-card skeleton-card relative rounded-md overflow-hidden shadow-sm bg-card animate-pulse flex flex-col w-full h-full"
        >
            {/* Studio Image - Banner Aspect 2:1 */}
            <div className="w-full aspect-[2/1] bg-zinc-800 flex items-center justify-center relative">
                {/* Logo placeholder center */}
                <div className="w-16 h-16 bg-zinc-700/50 rounded-full"></div>
            </div>

            {/* Content Placeholder - Footer (Title + Meta) */}
            <div className="p-3 flex flex-col gap-2">
                <div className="h-5 bg-zinc-700 rounded w-1/2"></div>

                {/* Meta / Parent Wrapper */}
                <div className="mt-2 space-y-2">
                    <div className="h-3 bg-zinc-800 rounded w-3/4"></div>
                    <div className="h-3 bg-zinc-800 rounded w-1/4"></div>
                </div>
            </div>
        </div>
    );
};
