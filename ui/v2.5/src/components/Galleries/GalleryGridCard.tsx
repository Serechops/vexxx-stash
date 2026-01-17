import React, { useState, useCallback } from "react";
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
}

const zoomWidths = [280, 340, 420, 560, 800];

export const GalleryCardGrid: React.FC<IGalleryCardGrid> = ({
  galleries,
  selectedIds,
  zoomIndex,
  onSelectChange,
  loading,
}) => {
  // Grid hooks (always run)
  const [componentRef, { width: containerWidth }] = useContainerDimensions();
  const cardWidth = useCardWidth(containerWidth, zoomIndex, zoomWidths);

  // Use column-width based on zoom level to let browser handle column count
  const columnWidth = zoomWidths[zoomIndex] || zoomWidths[0];

  return (
    <Box
      className="gallery-grid"
      ref={componentRef}
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${columnWidth}px, 1fr))`,
        gap: "1rem",
        padding: "0 1rem",
        justifyContent: "center",
      }}
    >
      {loading ? (
        Array.from({ length: 20 }).map((_, i) => (
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
