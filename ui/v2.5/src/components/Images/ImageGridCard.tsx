import React, { useState, useCallback, useMemo } from "react";
import * as GQL from "src/core/generated-graphql";
import { ImageCard } from "./ImageCard";
import {
  useCardWidth,
  useContainerDimensions,
} from "../Shared/GridCard/GridCard";
import { ImageCardSkeleton } from "../Shared/Skeletons/ImageCardSkeleton";
import { CARD_ZOOM_WIDTHS } from "src/constants/grid";

interface IImageCardGrid {
  images: GQL.SlimImageDataFragment[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  onPreview: (index: number, ev: React.MouseEvent<Element, MouseEvent>) => void;
  loading?: boolean;
  itemsPerPage?: number;
}

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
  const columnWidth = CARD_ZOOM_WIDTHS[zoomIndex] || CARD_ZOOM_WIDTHS[0];

  // Grid hooks (always run to keep hooks consistent)
  const [componentRef, { width: containerWidth }] = useContainerDimensions();
  const cardWidth = useCardWidth(containerWidth, zoomIndex, CARD_ZOOM_WIDTHS);

  // Calculate how many skeletons we need to fill the viewport
  const skeletonCount = useMemo(() => {
    const defaultCount = itemsPerPage || 20;
    if (!containerWidth || !columnWidth) return defaultCount;
    const gap = 16; // 1rem
    const cols = Math.floor(containerWidth / (columnWidth + gap)) || 1;
    const rows = Math.ceil(window.innerHeight / (columnWidth * 0.75 + gap)) || 1;
    const viewportFill = cols * rows;
    return Math.max(viewportFill, defaultCount);
  }, [containerWidth, columnWidth, itemsPerPage]);

  return (
    <div
      className="image-grid"
      ref={componentRef}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${columnWidth}px, ${columnWidth}px))`,
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
