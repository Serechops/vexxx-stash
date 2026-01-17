import React from "react";
import cx from "classnames";

export const SceneCardSkeleton: React.FC = () => {
    return (
        <div className="scene-card skeleton-card relative w-full bg-card rounded-lg overflow-hidden shadow-sm animate-pulse flex flex-col h-full">
            {/* Image Aspect Ratio Placeholder */}
            <div className="w-full aspect-video bg-zinc-800 relative">
                {/* Video/Image Icon placeholder */}
                <div className="absolute bottom-2 right-2 w-8 h-4 bg-zinc-700/50 rounded"></div>
            </div>

            {/* Content Placeholder - Footer */}
            <div className="p-2 flex flex-col gap-2 flex-grow">
                {/* Header Row (Studio/Date) */}
                <div className="flex justify-between items-center h-4">
                    <div className="h-3 bg-zinc-800 rounded w-1/3"></div>
                    <div className="flex gap-1">
                        <div className="h-3 bg-zinc-800 rounded w-8"></div>
                        <div className="h-3 bg-zinc-800 rounded w-8"></div>
                    </div>
                </div>

                {/* Title */}
                <div className="h-5 bg-zinc-700 rounded w-3/4"></div>

                {/* Meta Row (Rating/Views) */}
                <div className="mt-auto flex justify-end">
                    <div className="h-3 bg-zinc-800 rounded w-8"></div>
                </div>
            </div>
        </div>
    );
};
