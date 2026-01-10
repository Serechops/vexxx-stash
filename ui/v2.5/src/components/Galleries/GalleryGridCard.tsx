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
}

const zoomWidths = [280, 340, 480, 640];

export const GalleryCardGrid: React.FC<IGalleryCardGrid> = ({
  galleries,
  selectedIds,
  zoomIndex,
  onSelectChange,
}) => {
  const [componentRef, { width: containerWidth }] = useContainerDimensions();
  const cardWidth = useCardWidth(containerWidth, zoomIndex, zoomWidths);

  // Track orientation for each gallery by ID
  const [orientations, setOrientations] = useState<Record<string, boolean>>({});

  const handleOrientationDetected = useCallback((galleryId: string, isLandscape: boolean) => {
    setOrientations(prev => {
      if (prev[galleryId] === isLandscape) return prev;
      return { ...prev, [galleryId]: isLandscape };
    });
  }, []);

  return (
    <div
      className="gallery-magazine-grid"
      ref={componentRef}
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${cardWidth}px, 1fr))`,
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
          onOrientationDetected={handleOrientationDetected}
          isLandscape={orientations[gallery.id]}
        />
      ))}
    </div>
  );
};
