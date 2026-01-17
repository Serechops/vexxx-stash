import React from "react";
import * as GQL from "src/core/generated-graphql";
import {
  useCardWidth,
  useContainerDimensions,
} from "../Shared/GridCard/GridCard";
import { StudioCard } from "./StudioCard";
import { StudioCardSkeleton } from "../Shared/Skeletons/StudioCardSkeleton";

interface IStudioCardGrid {
  studios: GQL.StudioDataFragment[];
  fromParent: boolean | undefined;
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  loading?: boolean;
}

const zoomWidths = [280, 340, 420, 560, 800];

export const StudioCardGrid: React.FC<IStudioCardGrid> = ({
  studios,
  fromParent,
  selectedIds,
  zoomIndex,
  onSelectChange,
  loading,
}) => {
  const [componentRef, { width: containerWidth }] = useContainerDimensions();
  const cardWidth = useCardWidth(containerWidth, zoomIndex, zoomWidths);

  return (
    <div className="row justify-content-center" ref={componentRef}>
      {loading ? (
        Array.from({ length: 20 }).map((_, i) => (
          <StudioCardSkeleton key={i} cardWidth={cardWidth} zoomIndex={zoomIndex} />
        ))
      ) : (
        studios.map((studio) => (
          <StudioCard
            key={studio.id}
            cardWidth={cardWidth}
            studio={studio}
            zoomIndex={zoomIndex}
            hideParent={fromParent}
            selecting={selectedIds.size > 0}
            selected={selectedIds.has(studio.id)}
            onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
              onSelectChange(studio.id, selected, shiftKey)
            }
          />
        ))
      )}
    </div>
  );
};
