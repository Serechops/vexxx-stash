import React from "react";
import * as GQL from "src/core/generated-graphql";
import {
  useCardWidth,
  useContainerDimensions,
} from "../Shared/GridCard/GridCard";
import { TagCard } from "./TagCard";
import { TagCardSkeleton } from "../Shared/Skeletons/TagCardSkeleton";

interface ITagCardGrid {
  tags: (GQL.TagDataFragment | GQL.TagListDataFragment)[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  loading?: boolean;
}

const zoomWidths = [280, 340, 420, 560, 800];

export const TagCardGrid: React.FC<ITagCardGrid> = ({
  tags,
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
          <TagCardSkeleton key={i} cardWidth={cardWidth} zoomIndex={zoomIndex} />
        ))
      ) : (
        tags.map((tag) => (
          <TagCard
            key={tag.id}
            cardWidth={cardWidth}
            tag={tag}
            zoomIndex={zoomIndex}
            selecting={selectedIds.size > 0}
            selected={selectedIds.has(tag.id)}
            onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
              onSelectChange(tag.id, selected, shiftKey)
            }
          />
        ))
      )}
    </div>
  );
};
