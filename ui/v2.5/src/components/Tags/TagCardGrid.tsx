import React, { useMemo } from "react";
import * as GQL from "src/core/generated-graphql";
import {
  useCardWidth,
  useContainerDimensions,
} from "../Shared/GridCard/GridCard";
import { TagCard } from "./TagCard";
import { TagCardSkeleton } from "../Shared/Skeletons/TagCardSkeleton";

interface ITagCardGrid {
  tags: (GQL.TagDataFragment | GQL.TagListDataFragment)[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  loading?: boolean;
  itemsPerPage?: number;
}

const zoomWidths = [280, 340, 420, 560, 800];

export const TagCardGrid: React.FC<ITagCardGrid> = ({
  tags,
  selectedIds,
  zoomIndex,
  onSelectChange,
  loading,
  itemsPerPage,
}) => {
  const [componentRef, { width: containerWidth }] = useContainerDimensions();
  const cardWidth = useCardWidth(containerWidth, zoomIndex, zoomWidths);

  // Use column-width based on zoom level to let browser handle column count
  const columnWidth = zoomWidths[zoomIndex] || zoomWidths[0];

  // Calculate how many skeletons we need to fill the viewport
  const skeletonCount = useMemo(() => {
    const defaultCount = itemsPerPage || 40;
    if (!containerWidth || !columnWidth) return defaultCount;
    const gap = 16; // 1rem
    const cols = Math.floor(containerWidth / (columnWidth + gap)) || 1;
    // Tags/Studios are roughly 2:1 aspect ratio + text footer. Let's assume 0.6 of width for height.
    const rows = Math.ceil(window.innerHeight / (columnWidth * 0.6 + gap)) || 1;
    const viewportFill = cols * rows;
    return Math.max(viewportFill, defaultCount);
  }, [containerWidth, columnWidth, itemsPerPage]);

  return (
    <div
      ref={componentRef}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${columnWidth}px, 1fr))`,
        gap: "1rem",
        padding: "0 1rem",
        justifyContent: "center",
      }}
    >
      {loading ? (
        Array.from({ length: skeletonCount }).map((_, i) => (
          <TagCardSkeleton key={i} />
        ))
      ) : (
        tags.map((tag) => (
          <TagCard
            key={tag.id}
            tag={tag}
            zoomIndex={zoomIndex}
            selecting={selectedIds.size > 0}
            selected={selectedIds.has(tag.id)}
            onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
              onSelectChange(tag.id, selected, shiftKey)
            }
          />
        ))
      )}
    </div>
  );
};
