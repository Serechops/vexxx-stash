import React from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@mui/material";
import { useFindTags } from "src/core/StashService";
import { TagCard } from "./TagCard";
import { ListFilterModel } from "src/models/list-filter/filter";
import { Carousel } from "../Shared/Carousel";
import { RecommendationRow } from "../FrontPage/RecommendationRow";
import { FormattedMessage } from "react-intl";

interface IProps {
  isTouch: boolean;
  filter: ListFilterModel;
  header: string;
}

export const TagRecommendationRow: React.FC<IProps> = (props) => {
  const result = useFindTags(props.filter);
  const cardCount = result.data?.findTags.count;

  if (!result.loading && !cardCount) {
    return null;
  }

  return (
    <RecommendationRow
      className="tag-recommendations"
      header={props.header}
      link={
        <Link to={`/tags?${props.filter.makeQueryParameters()}`}>
          <FormattedMessage id="view_all" />
        </Link>
      }
    >
      <Carousel itemWidth={240} gap={16}>
        {result.loading
          ? [...Array(props.filter.itemsPerPage)].map((_, i) => (
            <Skeleton
              key={`skeleton_${i}`}
              variant="rectangular"
              sx={{
                width: 240,
                height: 365,
                borderRadius: 1,
                bgcolor: "grey.800",
              }}
            />
          ))
          : result.data?.findTags.tags.map((p) => (
            <TagCard key={p.id} tag={p} zoomIndex={0} />
          ))}
      </Carousel>
    </RecommendationRow>
  );
};
