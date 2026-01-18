import React from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@mui/material";
import { useFindGalleries } from "src/core/StashService";
import { GalleryCard } from "./GalleryCard";
import { ListFilterModel } from "src/models/list-filter/filter";
import { Carousel } from "../Shared/Carousel";
import { RecommendationRow } from "../FrontPage/RecommendationRow";
import { FormattedMessage } from "react-intl";

interface IProps {
  isTouch: boolean;
  filter: ListFilterModel;
  header: string;
}

export const GalleryRecommendationRow: React.FC<IProps> = (props) => {
  const result = useFindGalleries(props.filter);
  const cardCount = result.data?.findGalleries.count;

  if (!result.loading && !cardCount) {
    return null;
  }

  return (
    <RecommendationRow
      className="gallery-recommendations"
      header={props.header}
      link={
        <Link to={`/galleries?${props.filter.makeQueryParameters()}`}>
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
          : result.data?.findGalleries.galleries.map((g) => (
            <GalleryCard
              key={g.id}
              gallery={g}
              zoomIndex={1}
            />
          ))}
      </Carousel>
    </RecommendationRow>
  );
};
