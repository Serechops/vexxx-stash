import React, { useMemo } from "react";
import * as GQL from "src/core/generated-graphql";
import { GroupCard } from "./GroupCard";
import {
  useCardWidth,
  useContainerDimensions,
} from "../Shared/GridCard/GridCard";
import { GroupCardSkeleton } from "../Shared/Skeletons/GroupCardSkeleton";

interface IGroupCardGrid {
  groups: GQL.ListGroupDataFragment[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  fromGroupId?: string;
  onMove?: (srcIds: string[], targetId: string, after: boolean) => void;
  loading?: boolean;
  itemsPerPage?: number;
}

const zoomWidths = [280, 340, 420, 560, 800];

export const GroupCardGrid: React.FC<IGroupCardGrid> = ({
  groups,
  selectedIds,
  zoomIndex,
  onSelectChange,
  fromGroupId,
  onMove,
  loading,
  itemsPerPage,
}) => {
  const [componentRef, { width: containerWidth }] = useContainerDimensions();
  const columnWidth = zoomWidths[zoomIndex] || zoomWidths[0];

  const skeletonCount = useMemo(() => {
    const defaultCount = itemsPerPage || 20;
    if (!containerWidth || !columnWidth) return defaultCount;
    const gap = 16; // 1rem
    const cols = Math.floor(containerWidth / (columnWidth + gap)) || 1;
    // Groups are 2:3. Factor ~1.5
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
          <GroupCardSkeleton key={i} />
        ))
      ) : (
        groups.map((p) => (
          <GroupCard
            key={p.id}
            group={p}
            zoomIndex={zoomIndex}
            selecting={selectedIds.size > 0}
            selected={selectedIds.has(p.id)}
            onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
              onSelectChange(p.id, selected, shiftKey)
            }
            fromGroupId={fromGroupId}
            onMove={onMove}
          />
        ))
      )}
    </div>
  );
};
