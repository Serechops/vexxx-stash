import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { Box, Skeleton } from "@mui/material";
import { useFindScenes } from "src/core/StashService";
import { SceneCard } from "./SceneCard";
import { SceneQueue } from "src/models/sceneQueue";
import { ListFilterModel } from "src/models/list-filter/filter";
import { Carousel } from "../Shared/Carousel";
import { RecommendationRow } from "../FrontPage/RecommendationRow";
import { FormattedMessage } from "react-intl";

interface IProps {
  isTouch: boolean;
  filter: ListFilterModel;
  header: string;
}

export const SceneRecommendationRow: React.FC<IProps> = (props) => {
  const result = useFindScenes(props.filter);
  const cardCount = result.data?.findScenes.count;

  const queue = useMemo(() => {
    return SceneQueue.fromListFilterModel(props.filter);
  }, [props.filter]);

  if (!result.loading && !cardCount) {
    return null;
  }

  return (
    <RecommendationRow
      className="scene-recommendations"
      header={props.header}
      link={
        <Link to={`/scenes?${props.filter.makeQueryParameters()}`}>
          <FormattedMessage id="view_all" />
        </Link>
      }
    >
      <Carousel itemWidth={320} gap={16}>
        {result.loading
          ? [...Array(props.filter.itemsPerPage)].map((_, i) => (
            <Skeleton
              key={`skeleton_${i}`}
              variant="rectangular"
              sx={{
                width: 320,
                height: 365,
                borderRadius: 1,
                bgcolor: "grey.800",
              }}
            />
          ))
          : result.data?.findScenes.scenes.map((scene, index) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              queue={queue}
              index={index}
              zoomIndex={1}
            />
          ))}
      </Carousel>
    </RecommendationRow>
  );
};
