import React from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@mui/material";
import { useFindSceneMarkers } from "src/core/StashService";
import { ListFilterModel } from "src/models/list-filter/filter";
import { Carousel } from "../Shared/Carousel";
import { RecommendationRow } from "../FrontPage/RecommendationRow";
import { FormattedMessage } from "react-intl";
import { SceneMarkerCard } from "./SceneMarkerCard";

interface IProps {
  isTouch: boolean;
  filter: ListFilterModel;
  header: string;
}

export const SceneMarkerRecommendationRow: React.FC<IProps> = (props) => {
  const result = useFindSceneMarkers(props.filter);
  const cardCount = result.data?.findSceneMarkers.count;

  if (!result.loading && !cardCount) {
    return null;
  }

  return (
    <RecommendationRow
      className="scene-marker-recommendations"
      header={props.header}
      link={
        <Link to={`/scenes/markers?${props.filter.makeQueryParameters()}`}>
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
                height: 280,
                borderRadius: 1,
                bgcolor: "grey.800",
              }}
            />
          ))
          : result.data?.findSceneMarkers.scene_markers.map((marker, index) => (
            <SceneMarkerCard
              key={marker.id}
              marker={marker}
              index={index}
              zoomIndex={1}
            />
          ))}
      </Carousel>
    </RecommendationRow>
  );
};
