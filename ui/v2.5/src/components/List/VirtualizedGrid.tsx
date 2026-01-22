/**
 * VirtualizedGrid - A virtualized grid component for large lists
 * 
 * Uses @tanstack/react-virtual to only render visible items,
 * dramatically improving performance for lists with 100+ items.
 * 
 * Benefits:
 * - Renders only visible items (typically 10-20 vs 500+)
 * - Reduces DOM nodes and memory usage
 * - Smoother scrolling for large datasets
 * 
 * Usage:
 *   <VirtualizedGrid
 *     items={scenes}
 *     renderItem={(scene, index) => <SceneCard scene={scene} />}
 *     estimateSize={300}
 *     columns={4}
 *   />
 */

import React, { useRef, useMemo, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface VirtualizedGridProps<T> {
  /** Array of items to render */
  items: T[];
  /** Function to render each item */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Estimated height of each row in pixels */
  estimateSize?: number;
  /** Number of columns in the grid */
  columns?: number;
  /** Gap between items in pixels */
  gap?: number;
  /** Minimum item width in pixels (for responsive columns) */
  minItemWidth?: number;
  /** Additional padding around the grid */
  padding?: number;
  /** Callback when container width changes */
  onWidthChange?: (width: number) => void;
  /** Custom key extractor */
  keyExtractor?: (item: T, index: number) => string | number;
  /** Enable overscan (render extra items outside viewport) */
  overscan?: number;
  /** Class name for the container */
  className?: string;
}

export function VirtualizedGrid<T>({
  items,
  renderItem,
  estimateSize = 300,
  columns: fixedColumns,
  gap = 24,
  minItemWidth = 200,
  padding = 16,
  onWidthChange,
  keyExtractor,
  overscan = 3,
  className,
}: VirtualizedGridProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);

  // Calculate number of columns based on container width
  const columns = useMemo(() => {
    if (fixedColumns) return fixedColumns;
    if (!containerWidth) return 1;
    const availableWidth = containerWidth - padding * 2;
    return Math.max(1, Math.floor((availableWidth + gap) / (minItemWidth + gap)));
  }, [containerWidth, fixedColumns, gap, minItemWidth, padding]);

  // Calculate number of rows
  const rowCount = useMemo(() => {
    return Math.ceil(items.length / columns);
  }, [items.length, columns]);

  // Set up resize observer
  React.useEffect(() => {
    const element = parentRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const width = entry.contentRect.width;
        setContainerWidth(width);
        onWidthChange?.(width);
      }
    });

    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [onWidthChange]);

  // Set up virtualizer
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => estimateSize + gap, [estimateSize, gap]),
    overscan,
  });

  // Get items for a specific row
  const getRowItems = useCallback(
    (rowIndex: number) => {
      const startIndex = rowIndex * columns;
      const endIndex = Math.min(startIndex + columns, items.length);
      return items.slice(startIndex, endIndex).map((item, colIndex) => ({
        item,
        index: startIndex + colIndex,
      }));
    },
    [items, columns]
  );

  const virtualItems = virtualizer.getVirtualItems();

  // Calculate item width
  const itemWidth = useMemo(() => {
    if (!containerWidth) return minItemWidth;
    const availableWidth = containerWidth - padding * 2 - gap * (columns - 1);
    return Math.floor(availableWidth / columns);
  }, [containerWidth, columns, gap, padding, minItemWidth]);

  return (
    <div
      ref={parentRef}
      className={className}
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
                display: "flex",
                justifyContent: "center",
                gap: `${gap}px`,
                padding: `0 ${padding}px`,
              }}
            >
              {rowItems.map(({ item, index }) => (
                <div
                  key={keyExtractor?.(item, index) ?? index}
                  style={{
                    width: itemWidth,
                    flexShrink: 0,
                  }}
                >
                  {renderItem(item, index)}
                </div>
              ))}
              {/* Fill empty cells in last row for proper spacing */}
              {rowItems.length < columns &&
                Array.from({ length: columns - rowItems.length }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    style={{ width: itemWidth, flexShrink: 0 }}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Hook to calculate optimal columns based on container width
 */
export function useGridColumns(
  containerWidth: number,
  minItemWidth: number,
  gap: number = 24
): number {
  return useMemo(() => {
    if (!containerWidth) return 1;
    return Math.max(1, Math.floor((containerWidth + gap) / (minItemWidth + gap)));
  }, [containerWidth, minItemWidth, gap]);
}

export default VirtualizedGrid;
