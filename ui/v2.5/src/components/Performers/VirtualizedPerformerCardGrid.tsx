/**
 * VirtualizedPerformerCardGrid - A virtualized version of PerformerCardGrid
 * 
 * Uses @tanstack/react-virtual for efficient rendering of large performer lists.
 */

import React, { useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as GQL from "src/core/generated-graphql";
import { IPerformerCardExtraCriteria, PerformerCard } from "./PerformerCard";
import { PerformerCardSkeleton } from "../Shared/Skeletons/PerformerCardSkeleton";
import { CARD_ZOOM_WIDTHS } from "src/constants/grid";
import { PerformerCardGrid } from "./PerformerCardGrid";

interface IVirtualizedPerformerCardGrid {
  performers: GQL.PerformerDataFragment[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  extraCriteria?: IPerformerCardExtraCriteria;
  loading?: boolean;
  itemsPerPage?: number;
}

export const VirtualizedPerformerCardGrid: React.FC<IVirtualizedPerformerCardGrid> = ({
  performers,
  selectedIds,
  zoomIndex,
  onSelectChange,
  extraCriteria,
  loading,
  itemsPerPage,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  
  const columnWidth = CARD_ZOOM_WIDTHS[zoomIndex] || CARD_ZOOM_WIDTHS[0];
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
      const defaultCount = itemsPerPage || 20;
      return Math.ceil(defaultCount / columns);
    }
    return Math.ceil(performers.length / columns);
  }, [performers.length, columns, loading, itemsPerPage]);

  // Estimate row height (2:3 aspect ratio + footer)
  const estimatedRowHeight = useMemo(() => {
    const cardHeight = columnWidth * 1.5 + 60; // 2:3 aspect + ~60px footer
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
      const endIndex = Math.min(startIndex + columns, performers.length);
      return performers.slice(startIndex, endIndex).map((performer, colIndex) => ({
        performer,
        index: startIndex + colIndex,
      }));
    },
    [performers, columns]
  );

  const virtualItems = virtualizer.getVirtualItems();

  const itemWidth = useMemo(() => {
    if (!containerWidth) return columnWidth;
    const availableWidth = containerWidth - padding * 2 - gap * (columns - 1);
    return Math.min(columnWidth, Math.floor(availableWidth / columns));
  }, [containerWidth, columns, columnWidth]);

  if (loading) {
    const skeletonCount = itemsPerPage || 20;
    return (
      <div
        ref={parentRef}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${columnWidth}px, ${columnWidth}px))`,
          gap: `${gap}px`,
          padding: `${padding}px`,
          justifyContent: "center",
        }}
      >
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <PerformerCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      style={{
        position: "relative",
        height: `${virtualizer.getTotalSize()}px`,
        width: "100%",
      }}
    >
      {virtualItems.map((virtualRow) => {
        const rowItems = getRowItems(virtualRow.index);

        return (
          <div
            key={String(virtualRow.key)}
            data-index={virtualRow.index}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
              display: "flex",
              justifyContent: "center",
              gap: `${gap}px`,
              padding: `0 ${padding}px`,
            }}
          >
            {rowItems.map(({ performer }) => (
              <div
                key={performer.id}
                style={{
                  width: itemWidth,
                  flexShrink: 0,
                }}
              >
                <PerformerCard
                  performer={performer}
                  zoomIndex={zoomIndex}
                  selecting={selectedIds.size > 0}
                  selected={selectedIds.has(performer.id)}
                  onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
                    onSelectChange(performer.id, selected, shiftKey)
                  }
                  extraCriteria={extraCriteria}
                />
              </div>
            ))}
            {rowItems.length < columns &&
              Array.from({ length: columns - rowItems.length }).map((_, i) => (
                <div key={`empty-${i}`} style={{ width: itemWidth, flexShrink: 0 }} />
              ))}
          </div>
        );
      })}
    </div>
  );
};

/**
 * Smart component that switches between regular and virtualized grid
 */
export const SmartPerformerCardGrid: React.FC<IVirtualizedPerformerCardGrid & {
  virtualizationThreshold?: number;
}> = ({ virtualizationThreshold = 50, ...props }) => {
  const useVirtualization = props.performers.length >= virtualizationThreshold;

  if (useVirtualization) {
    return <VirtualizedPerformerCardGrid {...props} />;
  }

  return <PerformerCardGrid {...props} />;
};

export default VirtualizedPerformerCardGrid;
