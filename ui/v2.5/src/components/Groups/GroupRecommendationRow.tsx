import React from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@mui/material";
import { useFindGroups } from "src/core/StashService";
import { GroupCard } from "./GroupCard";
import { ListFilterModel } from "src/models/list-filter/filter";
import { Carousel } from "../Shared/Carousel";
import { RecommendationRow } from "../FrontPage/RecommendationRow";
import { FormattedMessage } from "react-intl";

interface IProps {
  isTouch: boolean;
  filter: ListFilterModel;
  header: string;
}

export const GroupRecommendationRow: React.FC<IProps> = (props) => {
  const result = useFindGroups(props.filter);
  const cardCount = result.data?.findGroups.count;

  if (!result.loading && !cardCount) {
    return null;
  }

  return (
    <RecommendationRow
      className="group-recommendations"
      header={props.header}
      link={
        <Link to={`/groups?${props.filter.makeQueryParameters()}`}>
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
                height: 540,
                borderRadius: 1,
                bgcolor: "grey.800",
              }}
            />
          ))
          : result.data?.findGroups.groups.map((g) => (
            <GroupCard key={g.id} group={g} />
          ))}
      </Carousel>
    </RecommendationRow>
  );
};
