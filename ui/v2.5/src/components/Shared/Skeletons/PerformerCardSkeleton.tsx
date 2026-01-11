import React from "react";
import { useContainerDimensions } from "../../Shared/GridCard/GridCard";

interface IPerformerCardSkeletonProps {
    cardWidth?: number;
    zoomIndex?: number;
}

export const PerformerCardSkeleton: React.FC<IPerformerCardSkeletonProps> = ({ cardWidth, zoomIndex = 0 }) => {
    return (
        <div
            className={`performer-card skeleton-card zoom-${zoomIndex} relative rounded-xl overflow-hidden shadow-md bg-gray-900 border-none animate-pulse`}
            style={cardWidth ? { width: cardWidth } : undefined}
        >
            <div className="w-full h-full aspect-[2/3] bg-gray-800/50 relative">
                {/* Simulate Gradient Overlay at bottom */}
                <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-gray-900 to-transparent"></div>

                {/* Name Placeholder */}
                <div className="absolute bottom-8 left-4 right-4">
                    <div className="h-6 bg-gray-700 rounded w-2/3 mb-2"></div>
                    <div className="h-3 bg-gray-700/80 rounded w-1/3"></div>
                </div>
            </div>
        </div>
    );
};
