import React from "react";
import { useContainerDimensions } from "../../Shared/GridCard/GridCard";

interface IPerformerCardSkeletonProps {
    cardWidth?: number;
    zoomIndex?: number;
}

export const PerformerCardSkeleton: React.FC<IPerformerCardSkeletonProps> = ({ cardWidth, zoomIndex = 0 }) => {
    return (
        <div
            className={`performer-card skeleton-card zoom-${zoomIndex} relative rounded-xl overflow-hidden shadow-sm bg-zinc-900 border-none animate-pulse`}
            style={cardWidth ? { width: cardWidth } : undefined}
        >
            <div className="w-full h-full aspect-[2/3] bg-zinc-800 relative">
                {/* Simulate Gradient Overlay at bottom */}
                <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-black/80 to-transparent"></div>

                {/* Name Placeholder (Overlay) */}
                <div className="absolute bottom-3 left-3 right-3 flex flex-col gap-2">
                    <div className="h-5 bg-white/10 rounded w-2/3 shadow-sm"></div>
                    <div className="h-3 bg-white/5 rounded w-1/3"></div>
                </div>
            </div>
        </div>
    );
};
