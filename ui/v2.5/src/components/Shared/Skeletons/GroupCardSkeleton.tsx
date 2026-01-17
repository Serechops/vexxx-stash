import React from "react";

export const GroupCardSkeleton: React.FC = () => {
    return (
        <div
            className={`group-card skeleton-card relative rounded-xl overflow-hidden shadow-sm bg-zinc-900 animate-pulse`}
        >
            {/* Image Aspect Ratio Placeholder - Groups are Portrait 2:3 */}
            <div className="w-full aspect-[2/3] bg-zinc-800 relative">
                <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-black/80 to-transparent"></div>

                {/* Content Placeholder (Overlay) */}
                <div className="absolute bottom-3 left-3 right-3 flex flex-col gap-2">
                    <div className="h-6 bg-white/10 rounded w-3/4 shadow-sm"></div>
                    <div className="h-3 bg-white/5 rounded w-1/2"></div>
                </div>
            </div>
        </div>
    );
};
