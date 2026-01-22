/**
 * VirtualizedTagCardGrid - A virtualized version of TagCardGrid
 * 
 * Uses @tanstack/react-virtual for efficient rendering of large tag lists.
 */

import React, { useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as GQL from "src/core/generated-graphql";
import { TagCard } from "./TagCard";
import { TagCardSkeleton } from "../Shared/Skeletons/TagCardSkeleton";
import { TagCardGrid } from "./TagCardGrid";

const zoomWidths = [280, 340, 420, 560, 800];

interface IVirtualizedTagCardGrid {
  tags: (GQL.TagDataFragment | GQL.TagListDataFragment)[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  loading?: boolean;
  itemsPerPage?: number;
}

export const VirtualizedTagCardGrid: React.FC<IVirtualizedTagCardGrid> = ({
  tags,
  selectedIds,
  zoomIndex,
  onSelectChange,
  loading,
  itemsPerPage,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  
  const columnWidth = zoomWidths[zoomIndex] || zoomWidths[0];
  const gap = 16; // 1rem
  const padding = 16;

  // Calculate number of columns
  const columns = useMemo(() => {
    if (!containerWidth) return 1;
    const availableWidth = containerWidth - padding * 2;
    return Math.max(1, Math.floor((availableWidth + gap) / (columnWidth + gap)));
  }, [containerWidth, columnWidth]);

  // Calculate number of rows
  const rowCount = useMemo(() => {
    if (loading) {
      const defaultCount = itemsPerPage || 40;
      return Math.ceil(defaultCount / columns);
    }
    return Math.ceil(tags.length / columns);
  }, [tags.length, columns, loading, itemsPerPage]);

  // Estimate row height (2:1 aspect ratio + footer)
  const estimatedRowHeight = useMemo(() => {
    const cardHeight = columnWidth * 0.6 + 60; // 2:1 aspect + ~60px footer
    return cardHeight + gap;
  }, [columnWidth]);

  // Set up resize observer
  React.useEffect(() => {
    const element = parentRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(element);
    setContainerWidth(element.getBoundingClientRect().width);
    
    return () => resizeObserver.disconnect();
  }, []);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current?.parentElement ?? null,
    estimateSize: useCallback(() => estimatedRowHeight, [estimatedRowHeight]),
    overscan: 3,
  });

  const getRowItems = useCallback(
    (rowIndex: number) => {
      const startIndex = rowIndex * columns;
      const endIndex = Math.min(startIndex + columns, tags.length);
      return tags.slice(startIndex, endIndex).map((tag, colIndex) => ({
        tag,
        index: startIndex + colIndex,
      }));
    },
    [tags, columns]
  );

  const virtualItems = virtualizer.getVirtualItems();

  // Loading state with skeletons
  if (loading) {
    const skeletonCount = itemsPerPage || 40;
    return (
      <div
        ref={parentRef}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fit, minmax(${columnWidth}px, 1fr))`,
          gap: `${gap}px`,
          padding: `0 ${padding}px`,
          justifyContent: "center",
        }}
      >
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <TagCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      style={{
        height: "100%",
        overflow: "auto",
        contain: "strict",
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualRow) => {
          const rowItems = getRowItems(virtualRow.index);
          return (
            <div
              key={String(virtualRow.key)}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${columns}, 1fr)`,
                  gap: `${gap}px`,
                  padding: `0 ${padding}px`,
                }}
              >
                {rowItems.map(({ tag }) => (
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
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * SmartTagCardGrid - Automatically switches between regular and virtualized grid
 * based on item count for optimal performance
 */
interface ISmartTagCardGrid extends IVirtualizedTagCardGrid {
  virtualizationThreshold?: number;
}

export const SmartTagCardGrid: React.FC<ISmartTagCardGrid> = ({
  tags,
  virtualizationThreshold = 50,
  ...props
}) => {
  // Use virtualization for large lists
  if (tags.length >= virtualizationThreshold) {
    return <VirtualizedTagCardGrid tags={tags} {...props} />;
  }
  
  // Use regular grid for smaller lists
  return <TagCardGrid tags={tags} {...props} />;
};
