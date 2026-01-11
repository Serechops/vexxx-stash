import React from "react";
import cx from "classnames";

export const SceneCardSkeleton: React.FC = () => {
    return (
        <div className="scene-card skeleton-card relative w-full bg-card rounded-lg overflow-hidden shadow-sm animate-pulse">
            {/* Image Aspect Ratio Placeholder */}
            <div className="w-full aspect-video bg-gray-700/50 relative">
                <div className="absolute bottom-2 right-2 w-12 h-4 bg-gray-600 rounded"></div>
            </div>

            {/* Content Placeholder */}
            <div className="p-3">
                {/* Title */}
                <div className="h-5 bg-gray-600 rounded w-3/4 mb-2"></div>

                {/* Date / Metadata */}
                <div className="flex gap-2 mb-2">
                    <div className="h-3 bg-gray-700 rounded w-1/4"></div>
                    <div className="h-3 bg-gray-700 rounded w-1/4"></div>
                </div>

                {/* Footer / Tags */}
                <div className="flex gap-1 mt-auto">
                    <div className="h-4 bg-gray-700 rounded w-8"></div>
                    <div className="h-4 bg-gray-700 rounded w-8"></div>
                    <div className="h-4 bg-gray-700 rounded w-8"></div>
                </div>
            </div>
        </div>
    );
};
