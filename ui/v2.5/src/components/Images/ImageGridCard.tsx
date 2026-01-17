import React, { useState, useCallback, useMemo } from "react";
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
  itemsPerPage?: number;
}

const zoomWidths = [280, 340, 420, 560, 800];

export const ImageGridCard: React.FC<IImageCardGrid> = ({
  images,
  selectedIds,
  zoomIndex,
  onSelectChange,
  onPreview,
  loading,
  itemsPerPage,
}) => {
  // Use column-width based on zoom level to let browser handle column count
  const columnWidth = zoomWidths[zoomIndex] || zoomWidths[0];

  // Grid hooks (always run to keep hooks consistent)
  const [componentRef, { width: containerWidth }] = useContainerDimensions();
  const cardWidth = useCardWidth(containerWidth, zoomIndex, zoomWidths);

  // Calculate how many skeletons we need to fill the viewport
  const skeletonCount = useMemo(() => {
    if (!containerWidth || !columnWidth) return 20;
    const gap = 16; // 1rem
    const cols = Math.floor(containerWidth / (columnWidth + gap)) || 1;
    const rows = Math.ceil(window.innerHeight / (columnWidth * 0.75 + gap)) || 1;
    const viewportFill = cols * rows;
    return Math.max(viewportFill, itemsPerPage || 12);
  }, [containerWidth, columnWidth, itemsPerPage]);

  return (
    <div
      className="image-grid"
      ref={componentRef}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${columnWidth}px, 1fr))`,
        gap: "1rem",
        justifyContent: "center",
      }}
    >
      {loading ? (
        Array.from({ length: skeletonCount }).map((_, i) => (
          <ImageCardSkeleton key={i} />
        ))
      ) : (
        images.map((image, index) => {
          return (
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
            />
          );
        })
      )}
    </div>
  );
};
