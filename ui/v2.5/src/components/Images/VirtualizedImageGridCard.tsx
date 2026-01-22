/**
 * VirtualizedImageGridCard - A virtualized version of ImageGridCard
 */

import React, { useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as GQL from "src/core/generated-graphql";
import { ImageCard } from "./ImageCard";
import { ImageCardSkeleton } from "../Shared/Skeletons/ImageCardSkeleton";
import { CARD_ZOOM_WIDTHS } from "src/constants/grid";
import { ImageGridCard } from "./ImageGridCard";

interface IVirtualizedImageGridCard {
  images: GQL.SlimImageDataFragment[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  onPreview: (index: number, ev: React.MouseEvent<Element, MouseEvent>) => void;
  loading?: boolean;
  itemsPerPage?: number;
}

export const VirtualizedImageGridCard: React.FC<IVirtualizedImageGridCard> = ({
  images,
  selectedIds,
  zoomIndex,
  onSelectChange,
  onPreview,
  loading,
  itemsPerPage,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  
  const columnWidth = CARD_ZOOM_WIDTHS[zoomIndex] || CARD_ZOOM_WIDTHS[0];
  const gap = 16;
  const padding = 0;

  const columns = useMemo(() => {
    if (!containerWidth) return 1;
    const availableWidth = containerWidth;
    return Math.max(1, Math.floor((availableWidth + gap) / (columnWidth + gap)));
  }, [containerWidth, columnWidth]);

  const rowCount = useMemo(() => {
    if (loading) {
      const defaultCount = itemsPerPage || 20;
      return Math.ceil(defaultCount / columns);
    }
    return Math.ceil(images.length / columns);
  }, [images.length, columns, loading, itemsPerPage]);

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
      const endIndex = Math.min(startIndex + columns, images.length);
      return images.slice(startIndex, endIndex).map((image, colIndex) => ({
        image,
        index: startIndex + colIndex,
      }));
    },
    [images, columns]
  );

  const virtualItems = virtualizer.getVirtualItems();

  const itemWidth = useMemo(() => {
    if (!containerWidth) return columnWidth;
    const availableWidth = containerWidth - gap * (columns - 1);
    return Math.min(columnWidth, Math.floor(availableWidth / columns));
  }, [containerWidth, columns, columnWidth]);

  if (loading) {
    const skeletonCount = itemsPerPage || 20;
    return (
      <div
        ref={parentRef}
        className="image-grid"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${columnWidth}px, ${columnWidth}px))`,
          gap: `${gap}px`,
          justifyContent: "center",
        }}
      >
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <ImageCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="image-grid"
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
            }}
          >
            {rowItems.map(({ image, index }) => (
              <div key={image.id} style={{ width: itemWidth, flexShrink: 0 }}>
                <ImageCard
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

export const SmartImageGridCard: React.FC<IVirtualizedImageGridCard & {
  virtualizationThreshold?: number;
}> = ({ virtualizationThreshold = 50, ...props }) => {
  if (props.images.length >= virtualizationThreshold) {
    return <VirtualizedImageGridCard {...props} />;
  }
  return <ImageGridCard {...props} />;
};

export default VirtualizedImageGridCard;
