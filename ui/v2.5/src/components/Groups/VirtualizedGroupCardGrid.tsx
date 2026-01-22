/**
 * VirtualizedGroupCardGrid - A virtualized version of GroupCardGrid
 * 
 * Uses @tanstack/react-virtual for efficient rendering of large group lists.
 */

import React, { useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as GQL from "src/core/generated-graphql";
import { GroupCard } from "./GroupCard";
import { GroupCardSkeleton } from "../Shared/Skeletons/GroupCardSkeleton";
import { GroupCardGrid } from "./GroupCardGrid";
import { CARD_ZOOM_WIDTHS } from "src/constants/grid";

interface IVirtualizedGroupCardGrid {
  groups: GQL.ListGroupDataFragment[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  fromGroupId?: string;
  onMove?: (srcIds: string[], targetId: string, after: boolean) => void;
  loading?: boolean;
  itemsPerPage?: number;
}

export const VirtualizedGroupCardGrid: React.FC<IVirtualizedGroupCardGrid> = ({
  groups,
  selectedIds,
  zoomIndex,
  onSelectChange,
  fromGroupId,
  onMove,
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
    return Math.ceil(groups.length / columns);
  }, [groups.length, columns, loading, itemsPerPage]);

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
      const endIndex = Math.min(startIndex + columns, groups.length);
      return groups.slice(startIndex, endIndex).map((group, colIndex) => ({
        group,
        index: startIndex + colIndex,
      }));
    },
    [groups, columns]
  );

  const virtualItems = virtualizer.getVirtualItems();

  // Loading state with skeletons
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
          <GroupCardSkeleton key={i} />
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
                  gridTemplateColumns: `repeat(${columns}, minmax(${columnWidth}px, ${columnWidth}px))`,
                  gap: `${gap}px`,
                  padding: `0 ${padding}px`,
                  justifyContent: "center",
                }}
              >
                {rowItems.map(({ group }) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    zoomIndex={zoomIndex}
                    selecting={selectedIds.size > 0}
                    selected={selectedIds.has(group.id)}
                    onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
                      onSelectChange(group.id, selected, shiftKey)
                    }
                    fromGroupId={fromGroupId}
                    onMove={onMove}
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
 * SmartGroupCardGrid - Automatically switches between regular and virtualized grid
 * based on item count for optimal performance
 */
interface ISmartGroupCardGrid extends IVirtualizedGroupCardGrid {
  virtualizationThreshold?: number;
}

export const SmartGroupCardGrid: React.FC<ISmartGroupCardGrid> = ({
  groups,
  virtualizationThreshold = 50,
  ...props
}) => {
  // Use virtualization for large lists
  if (groups.length >= virtualizationThreshold) {
    return <VirtualizedGroupCardGrid groups={groups} {...props} />;
  }
  
  // Use regular grid for smaller lists
  return <GroupCardGrid groups={groups} {...props} />;
};
