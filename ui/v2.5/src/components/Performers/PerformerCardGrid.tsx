import React from "react";
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
}

const zoomWidths = [280, 340, 420, 560, 800];

export const PerformerCardGrid: React.FC<IPerformerCardGrid> = ({
  performers,
  selectedIds,
  zoomIndex,
  onSelectChange,
  extraCriteria,
  loading,
}) => {
  const [componentRef, { width: containerWidth }] = useContainerDimensions();
  const cardWidth = useCardWidth(containerWidth, zoomIndex, zoomWidths);

  return (
    <Box
      ref={componentRef}
      sx={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        mx: -1,
        "& > *": {
          m: 1
        }
      }}
    >
      {loading && performers.length === 0 ? (
        Array.from({ length: 20 }).map((_, i) => (
          <PerformerCardSkeleton key={i} cardWidth={cardWidth} zoomIndex={zoomIndex} />
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
    </Box>
  );
};
