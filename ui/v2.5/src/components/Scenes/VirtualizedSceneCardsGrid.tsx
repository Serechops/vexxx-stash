/**
 * VirtualizedSceneCardsGrid - A virtualized version of SceneCardsGrid
 * 
 * Uses @tanstack/react-virtual for efficient rendering of large scene lists.
 * Only renders visible cards, dramatically improving performance for 100+ scenes.
 * 
 * Use this component when:
 * - Displaying 100+ scenes
 * - Performance is critical
 * - Users have large libraries
 * 
 * For smaller lists (<100 items), use the regular SceneCardsGrid
 * as the virtualization overhead may not be worth it.
 */

import React, { useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as GQL from "src/core/generated-graphql";
import { SceneQueue } from "src/models/sceneQueue";
import { SceneCard } from "./SceneCard";
import { SceneCardSkeleton } from "../Shared/Skeletons/SceneCardSkeleton";
import { CARD_ZOOM_WIDTHS } from "src/constants/grid";
import { SceneCardsGrid } from "./SceneCardsGrid";

interface IVirtualizedSceneCardsGrid {
  scenes: GQL.SlimSceneDataFragment[];
  queue?: SceneQueue;
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  fromGroupId?: string;
  loading?: boolean;
  itemsPerPage?: number;
}

export const VirtualizedSceneCardsGrid: React.FC<IVirtualizedSceneCardsGrid> = ({
  scenes,
  queue,
  selectedIds,
  zoomIndex,
  onSelectChange,
  fromGroupId,
  loading,
  itemsPerPage,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  
  const columnWidth = CARD_ZOOM_WIDTHS[zoomIndex] || CARD_ZOOM_WIDTHS[0];
  const gap = 24; // 1.5rem
  const padding = 16; // 1rem

  // Calculate number of columns based on container width
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
    return Math.ceil(scenes.length / columns);
  }, [scenes.length, columns, loading, itemsPerPage]);

  // Estimate row height based on card aspect ratio (16:9 + footer ~50px)
  const estimatedRowHeight = useMemo(() => {
    const cardHeight = columnWidth * (9 / 16) + 80; // 16:9 aspect + ~80px footer
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
    // Initial measurement
    setContainerWidth(element.getBoundingClientRect().width);
    
    return () => resizeObserver.disconnect();
  }, []);

  // Set up virtualizer
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current?.parentElement ?? null,
    estimateSize: useCallback(() => estimatedRowHeight, [estimatedRowHeight]),
    overscan: 3, // Render 3 extra rows above/below viewport
  });

  // Get items for a specific row
  const getRowItems = useCallback(
    (rowIndex: number) => {
      const startIndex = rowIndex * columns;
      const endIndex = Math.min(startIndex + columns, scenes.length);
      return scenes.slice(startIndex, endIndex).map((scene, colIndex) => ({
        scene,
        index: startIndex + colIndex,
      }));
    },
    [scenes, columns]
  );

  const virtualItems = virtualizer.getVirtualItems();

  // Calculate actual item width to fill space evenly
  const itemWidth = useMemo(() => {
    if (!containerWidth) return columnWidth;
    const availableWidth = containerWidth - padding * 2 - gap * (columns - 1);
    return Math.min(columnWidth, Math.floor(availableWidth / columns));
  }, [containerWidth, columns, columnWidth]);

  if (loading) {
    // Show skeletons while loading
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
          <SceneCardSkeleton key={i} />
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
            {rowItems.map(({ scene, index }) => (
              <div
                key={scene.id}
                style={{
                  width: itemWidth,
                  flexShrink: 0,
                }}
              >
                <SceneCard
                  scene={scene}
                  queue={queue}
                  index={index}
                  zoomIndex={zoomIndex}
                  selecting={selectedIds.size > 0}
                  selected={selectedIds.has(scene.id)}
                  onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
                    onSelectChange(scene.id, selected, shiftKey)
                  }
                  fromGroupId={fromGroupId}
                />
              </div>
            ))}
            {/* Fill empty cells in last row */}
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
 * based on the number of items
 */
export const SmartSceneCardsGrid: React.FC<IVirtualizedSceneCardsGrid & {
  /** Threshold for switching to virtualized mode */
  virtualizationThreshold?: number;
}> = ({ virtualizationThreshold = 100, ...props }) => {
  const useVirtualization = props.scenes.length >= virtualizationThreshold;

  if (useVirtualization) {
    return <VirtualizedSceneCardsGrid {...props} />;
  }

  return <SceneCardsGrid {...props} />;
};

export default VirtualizedSceneCardsGrid;
