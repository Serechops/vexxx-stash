import React from "react";
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
}) => {
  const [componentRef, { width: containerWidth }] = useContainerDimensions();
  const cardWidth = useCardWidth(containerWidth, zoomIndex, zoomWidths);

  return (
    <div className="row justify-content-center" ref={componentRef}>
      {loading ? (
        Array.from({ length: 20 }).map((_, i) => (
          <GroupCardSkeleton key={i} cardWidth={cardWidth} zoomIndex={zoomIndex} />
        ))
      ) : (
        groups.map((p) => (
          <GroupCard
            key={p.id}
            cardWidth={cardWidth}
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
