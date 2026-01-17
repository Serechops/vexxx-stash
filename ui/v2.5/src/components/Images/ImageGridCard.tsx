import React, { useState, useCallback } from "react";
import * as GQL from "src/core/generated-graphql";
import { ImageCard } from "./ImageCard";
import {
  useCardWidth,
  useContainerDimensions,
} from "../Shared/GridCard/GridCard";
import { ImageCardSkeleton } from "../Shared/Skeletons/ImageCardSkeleton";

interface IImageCardGrid {
  images: GQL.SlimImageDataFragment[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  onPreview: (index: number, ev: React.MouseEvent<Element, MouseEvent>) => void;
  loading?: boolean;
}

const zoomWidths = [280, 340, 420, 560, 800];

export const ImageGridCard: React.FC<IImageCardGrid> = ({
  images,
  selectedIds,
  zoomIndex,
  onSelectChange,
  onPreview,
  loading,
}) => {
  // Use column-width based on zoom level to let browser handle column count
  const columnWidth = zoomWidths[zoomIndex] || zoomWidths[0];

  // Grid hooks (always run to keep hooks consistent)
  const [componentRef, { width: containerWidth }] = useContainerDimensions();
  const cardWidth = useCardWidth(containerWidth, zoomIndex, zoomWidths);

  // Track orientation for each image by ID
  const [orientations, setOrientations] = useState<Record<string, boolean>>({});

  const handleOrientationDetected = useCallback((imageId: string, isLandscape: boolean) => {
    setOrientations(prev => {
      if (prev[imageId] === isLandscape) return prev;
      return { ...prev, [imageId]: isLandscape };
    });
  }, []);

  return (
    <div
      className="image-magazine-grid"
      style={{
        columnWidth: `${columnWidth}px`,
        columnGap: "1rem",
        display: "block",
      }}
    >
      {loading ? (
        Array.from({ length: 20 }).map((_, i) => (
          <ImageCardSkeleton key={i} zoomIndex={zoomIndex} />
        ))
      ) : (
        images.map((image, index) => (
          <ImageCard
            key={image.id}
            // cardWidth is handled by the column responsive width
            image={image}
            zoomIndex={zoomIndex}
            selecting={selectedIds.size > 0}
            selected={selectedIds.has(image.id)}
            onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
              onSelectChange(image.id, selected, shiftKey)
            }
            onPreview={
              selectedIds.size < 1 ? (ev) => onPreview(index, ev) : undefined
            }
            onOrientationDetected={handleOrientationDetected}
            isLandscape={orientations[image.id]}
          />
        ))
      )}
    </div>
  );
};
