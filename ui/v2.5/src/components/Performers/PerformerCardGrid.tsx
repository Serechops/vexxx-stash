import React, { useMemo } from "react";
import { Box } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { IPerformerCardExtraCriteria, PerformerCard } from "./PerformerCard";
import { PerformerCardSkeleton } from "../Shared/Skeletons/PerformerCardSkeleton";
import {
  useCardWidth,
  useContainerDimensions,
} from "../Shared/GridCard/GridCard";

interface IPerformerCardGrid {
  performers: GQL.PerformerDataFragment[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  extraCriteria?: IPerformerCardExtraCriteria;
  loading?: boolean;
  itemsPerPage?: number;
}

const zoomWidths = [280, 340, 420, 560, 800];

export const PerformerCardGrid: React.FC<IPerformerCardGrid> = ({
  performers,
  selectedIds,
  zoomIndex,
  onSelectChange,
  extraCriteria,
  loading,
  itemsPerPage,
}) => {
  const [componentRef, { width: containerWidth }] = useContainerDimensions();
  const cardWidth = useCardWidth(containerWidth, zoomIndex, zoomWidths);
  const columnWidth = zoomWidths[zoomIndex] || zoomWidths[0];

  const skeletonCount = useMemo(() => {
    const defaultCount = itemsPerPage || 20;
    if (!containerWidth || !columnWidth) return defaultCount;
    const gap = 16; // 1rem
    const cols = Math.floor(containerWidth / (columnWidth + gap)) || 1;
    // Performers are 2:3. Factor ~1.5
    const rows = Math.ceil(window.innerHeight / (columnWidth * 1.5 + gap)) || 1;
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
        padding: "1rem",
        justifyContent: "center",
      }}
    >
      {loading ? (
        Array.from({ length: skeletonCount }).map((_, i) => (
          <PerformerCardSkeleton key={i} />
        ))
      ) : (
        performers.map((p) => (
          <PerformerCard
            key={p.id}
            cardWidth={cardWidth}
            performer={p}
            zoomIndex={zoomIndex}
            selecting={selectedIds.size > 0}
            selected={selectedIds.has(p.id)}
            onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
              onSelectChange(p.id, selected, shiftKey)
            }
            extraCriteria={extraCriteria}
          />
        ))
      )}
    </div>
  );
};
