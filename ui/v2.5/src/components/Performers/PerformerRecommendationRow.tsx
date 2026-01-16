import React from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@mui/material";
import { useFindPerformers } from "src/core/StashService";
import { PerformerCard } from "./PerformerCard";
import { ListFilterModel } from "src/models/list-filter/filter";
import { Carousel } from "../Shared/Carousel";
import { RecommendationRow } from "../FrontPage/RecommendationRow";
import { FormattedMessage } from "react-intl";

interface IProps {
  isTouch: boolean;
  filter: ListFilterModel;
  header: string;
}

export const PerformerRecommendationRow: React.FC<IProps> = (props) => {
  const result = useFindPerformers(props.filter);
  const cardCount = result.data?.findPerformers.count;

  if (!result.loading && !cardCount) {
    return null;
  }

  return (
    <RecommendationRow
      className="performer-recommendations"
      header={props.header}
      link={
        <Link to={`/performers?${props.filter.makeQueryParameters()}`}>
          <FormattedMessage id="view_all" />
        </Link>
      }
    >
      <Carousel itemWidth={280} gap={16}>
        {result.loading
          ? [...Array(props.filter.itemsPerPage)].map((_, i) => (
            <Skeleton
              key={`skeleton_${i}`}
              variant="rectangular"
              sx={{
                width: 280,
                height: 420,
                borderRadius: 1,
                bgcolor: "grey.800",
              }}
            />
          ))
          : result.data?.findPerformers.performers.map((p) => (
            <PerformerCard key={p.id} performer={p} />
          ))}
      </Carousel>
    </RecommendationRow>
  );
};
