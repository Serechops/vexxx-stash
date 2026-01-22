/**
 * VirtualizedGalleryCardGrid - A virtualized version of GalleryCardGrid
 */

import React, { useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as GQL from "src/core/generated-graphql";
import { GalleryCard } from "./GalleryCard";
import { GalleryCardSkeleton } from "../Shared/Skeletons/GalleryCardSkeleton";
import { CARD_ZOOM_WIDTHS } from "src/constants/grid";
import { GalleryCardGrid } from "./GalleryGridCard";

interface IVirtualizedGalleryCardGrid {
  galleries: GQL.SlimGalleryDataFragment[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  loading?: boolean;
  itemsPerPage?: number;
}

export const VirtualizedGalleryCardGrid: React.FC<IVirtualizedGalleryCardGrid> = ({
  galleries,
  selectedIds,
  zoomIndex,
  onSelectChange,
  loading,
  itemsPerPage,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  
  const columnWidth = CARD_ZOOM_WIDTHS[zoomIndex] || CARD_ZOOM_WIDTHS[0];
  const gap = 16;
  const padding = 16;

  const columns = useMemo(() => {
    if (!containerWidth) return 1;
    const availableWidth = containerWidth - padding * 2;
    return Math.max(1, Math.floor((availableWidth + gap) / (columnWidth + gap)));
  }, [containerWidth, columnWidth]);

  const rowCount = useMemo(() => {
    if (loading) {
      const defaultCount = itemsPerPage || 20;
      return Math.ceil(defaultCount / columns);
    }
    return Math.ceil(galleries.length / columns);
  }, [galleries.length, columns, loading, itemsPerPage]);

  // Gallery cards are roughly square with footer
  const estimatedRowHeight = useMemo(() => {
    const cardHeight = columnWidth * 0.75 + 60;
    return cardHeight + gap;
  }, [columnWidth]);

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
      const endIndex = Math.min(startIndex + columns, galleries.length);
      return galleries.slice(startIndex, endIndex);
    },
    [galleries, columns]
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
          padding: `0 ${padding}px`,
          justifyContent: "center",
        }}
      >
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <GalleryCardSkeleton key={i} />
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
            {rowItems.map((gallery) => (
              <div key={gallery.id} style={{ width: itemWidth, flexShrink: 0 }}>
                <GalleryCard
                  gallery={gallery}
                  zoomIndex={zoomIndex}
                  selecting={selectedIds.size > 0}
                  selected={selectedIds.has(gallery.id)}
                  onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
                    onSelectChange(gallery.id, selected, shiftKey)
                  }
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

export const SmartGalleryCardGrid: React.FC<IVirtualizedGalleryCardGrid & {
  virtualizationThreshold?: number;
}> = ({ virtualizationThreshold = 50, ...props }) => {
  if (props.galleries.length >= virtualizationThreshold) {
    return <VirtualizedGalleryCardGrid {...props} />;
  }
  return <GalleryCardGrid {...props} />;
};

export default VirtualizedGalleryCardGrid;
