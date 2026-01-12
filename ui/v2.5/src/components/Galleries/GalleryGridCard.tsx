import React, { useState, useCallback } from "react";
import * as GQL from "src/core/generated-graphql";
import { GalleryCard } from "./GalleryCard";
import {
  useCardWidth,
  useContainerDimensions,
} from "../Shared/GridCard/GridCard";

interface IGalleryCardGrid {
  galleries: GQL.SlimGalleryDataFragment[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  isMasonry?: boolean;
}

const zoomWidths = [280, 340, 480, 640];

export const GalleryCardGrid: React.FC<IGalleryCardGrid> = ({
  galleries,
  selectedIds,
  zoomIndex,
  onSelectChange,
  isMasonry = true,
}) => {
  // Grid hooks (always run)
  const [componentRef, { width: containerWidth }] = useContainerDimensions();
  const cardWidth = useCardWidth(containerWidth, zoomIndex, zoomWidths);

  // Use column-width based on zoom level to let browser handle column count
  const columnWidth = zoomWidths[zoomIndex] || zoomWidths[0];

  // Track orientation - though less critical for layout flow in masonry,
  // still useful for the card's internal rendering if needed.
  const [orientations, setOrientations] = useState<Record<string, boolean>>({});

  const handleOrientationDetected = useCallback((galleryId: string, isLandscape: boolean) => {
    setOrientations(prev => {
      if (prev[galleryId] === isLandscape) return prev;
      return { ...prev, [galleryId]: isLandscape };
    });
  }, []);

  if (isMasonry) {
    return (
      <div
        className="gallery-magazine-grid"
        style={{
          columnWidth: `${columnWidth}px`,
          columnGap: "1rem",
          display: "block",
        }}
      >
        {galleries.map((gallery) => (
          <GalleryCard
            key={gallery.id}
            gallery={gallery}
            zoomIndex={zoomIndex}
            selecting={selectedIds.size > 0}
            selected={selectedIds.has(gallery.id)}
            onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
              onSelectChange(gallery.id, selected, shiftKey)
            }
            onOrientationDetected={handleOrientationDetected}
            isLandscape={orientations[gallery.id]}
            isMasonry={isMasonry}
          />
        ))}
      </div>
    );
  }

  // Standard Grid Layout
  return (
    <div
      className="gallery-grid"
      ref={componentRef}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${cardWidth ?? zoomWidths[zoomIndex] ?? 280}px, 1fr))`,
        gap: "1rem",
        padding: "0 1rem",
      }}
    >
      {galleries.map((gallery) => (
        <GalleryCard
          key={gallery.id}
          cardWidth={cardWidth}
          gallery={gallery}
          zoomIndex={zoomIndex}
          selecting={selectedIds.size > 0}
          selected={selectedIds.has(gallery.id)}
          onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
            onSelectChange(gallery.id, selected, shiftKey)
          }
          // We might not need orientation tracking for Grid if we want rigid squares, 
          // but keeping it doesn't hurt.
          onOrientationDetected={handleOrientationDetected}
          isLandscape={orientations[gallery.id]}
          isMasonry={isMasonry}
        />
      ))}
    </div>
  );
};
