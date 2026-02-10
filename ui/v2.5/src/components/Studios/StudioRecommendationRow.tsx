import React from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@mui/material";
import { useFindStudios } from "src/core/StashService";
import { StudioCard } from "./StudioCard";
import { ListFilterModel } from "src/models/list-filter/filter";
import { Carousel } from "../Shared/Carousel";
import { RecommendationRow } from "../FrontPage/RecommendationRow";
import { FormattedMessage } from "react-intl";

interface IProps {
  isTouch: boolean;
  filter: ListFilterModel;
  header: string;
}

export const StudioRecommendationRow: React.FC<IProps> = (props) => {
  const result = useFindStudios(props.filter);
  const cardCount = result.data?.findStudios.count;

  if (!result.loading && !cardCount) {
    return null;
  }

  return (
    <RecommendationRow
      className="studio-recommendations"
      header={props.header}
      link={
        <Link to={`/studios?${props.filter.makeQueryParameters()}`}>
          <FormattedMessage id="view_all" />
        </Link>
      }
    >
      <Carousel itemWidth={360} gap={16}>
        {result.loading
          ? [...Array(props.filter.itemsPerPage)].map((_, i) => (
            <Skeleton
              key={`skeleton_${i}`}
              variant="rectangular"
              sx={{
                width: 360,
                height: 278,
                borderRadius: 1,
                bgcolor: "grey.800",
              }}
            />
          ))
          : result.data?.findStudios.studios.map((s) => (
            <StudioCard key={s.id} studio={s} hideParent={true} zoomIndex={1} />
          ))}
      </Carousel>
    </RecommendationRow>
  );
};
