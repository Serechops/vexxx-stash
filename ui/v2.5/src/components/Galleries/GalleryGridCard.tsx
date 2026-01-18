import React, { useState, useCallback, useMemo } from "react";
import { Box } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { GalleryCard } from "./GalleryCard";
import {
  useCardWidth,
  useContainerDimensions,
} from "../Shared/GridCard/GridCard";

import { GalleryCardSkeleton } from "../Shared/Skeletons/GalleryCardSkeleton";

interface IGalleryCardGrid {
  galleries: GQL.SlimGalleryDataFragment[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  loading?: boolean;
  itemsPerPage?: number;
}

const zoomWidths = [280, 340, 420, 560, 800];

export const GalleryCardGrid: React.FC<IGalleryCardGrid> = ({
  galleries,
  selectedIds,
  zoomIndex,
  onSelectChange,
  loading,
  itemsPerPage,
}) => {
  // Grid hooks (always run)
  const [componentRef, { width: containerWidth }] = useContainerDimensions();
  const cardWidth = useCardWidth(containerWidth, zoomIndex, zoomWidths);

  // Use column-width based on zoom level to let browser handle column count
  const columnWidth = zoomWidths[zoomIndex] || zoomWidths[0];

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
    <Box
      className="gallery-grid"
      ref={componentRef}
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${columnWidth}px, ${columnWidth}px))`,
        gap: "1rem",
        padding: "0 1rem",
        justifyContent: "center",
      }}
    >
      {loading ? (
        Array.from({ length: skeletonCount }).map((_, i) => (
          <GalleryCardSkeleton key={i} />
        ))
      ) : (
        galleries.map((gallery) => (
          <GalleryCard
            key={gallery.id}
            gallery={gallery}
            zoomIndex={zoomIndex}
            selecting={selectedIds.size > 0}
            selected={selectedIds.has(gallery.id)}
            onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
              onSelectChange(gallery.id, selected, shiftKey)
            }
          />
        ))
      )}
    </Box>
  );
};
