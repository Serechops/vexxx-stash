import React from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@mui/material";
import { useFindImages } from "src/core/StashService";
import { ListFilterModel } from "src/models/list-filter/filter";
import { Carousel } from "../Shared/Carousel";
import { RecommendationRow } from "../FrontPage/RecommendationRow";
import { FormattedMessage } from "react-intl";
import { ImageCard } from "./ImageCard";

interface IProps {
  isTouch: boolean;
  filter: ListFilterModel;
  header: string;
}

export const ImageRecommendationRow: React.FC<IProps> = (props) => {
  const result = useFindImages(props.filter);
  const cardCount = result.data?.findImages.count;

  if (!result.loading && !cardCount) {
    return null;
  }

  return (
    <RecommendationRow
      className="images-recommendations"
      header={props.header}
      link={
        <Link to={`/images?${props.filter.makeQueryParameters()}`}>
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
                height: 400,
                borderRadius: 1,
                bgcolor: "grey.800",
              }}
            />
          ))
          : result.data?.findImages.images.map((i) => (
            <ImageCard key={i.id} image={i} zoomIndex={1} />
          ))}
      </Carousel>
    </RecommendationRow>
  );
};
