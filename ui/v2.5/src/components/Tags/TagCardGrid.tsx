import React from "react";
import { Grid } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import {
  useCardWidth,
  useContainerDimensions,
} from "../Shared/GridCard/GridCard";
import { TagCard } from "./TagCard";

interface ITagCardGrid {
  tags: (GQL.TagDataFragment | GQL.TagListDataFragment)[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
}

const zoomWidths = [280, 340, 480, 640];

export const TagCardGrid: React.FC<ITagCardGrid> = ({
  tags,
  selectedIds,
  zoomIndex,
  onSelectChange,
}) => {
  const [componentRef, { width: containerWidth }] = useContainerDimensions();
  const cardWidth = useCardWidth(containerWidth, zoomIndex, zoomWidths);

  return (
    <Grid container justifyContent="center" ref={componentRef} spacing={2}>
      {tags.map((tag) => (
        <Grid key={tag.id}>
          <TagCard
            cardWidth={cardWidth}
            tag={tag}
            zoomIndex={zoomIndex}
            selecting={selectedIds.size > 0}
            selected={selectedIds.has(tag.id)}
            onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
              onSelectChange(tag.id, selected, shiftKey)
            }
          />
        </Grid>
      ))}
    </Grid>
  );
};
