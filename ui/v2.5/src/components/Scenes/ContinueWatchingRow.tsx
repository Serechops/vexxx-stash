import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { SceneCard } from "./SceneCard";
import { SceneQueue } from "src/models/sceneQueue";
import { Carousel } from "../Shared/Carousel";
import { RecommendationRow } from "../FrontPage/RecommendationRow";
import { useIntl } from "react-intl";

const PER_PAGE = 24;

/**
 * Horizontal carousel of scenes that have a non-zero resume_time, sorted by
 * most recently played. Renders nothing when there are no in-progress scenes.
 */
export const ContinueWatchingRow: React.FC = () => {
  const intl = useIntl();

  const { data, loading } = GQL.useFindScenesQuery({
    variables: {
      filter: {
        per_page: PER_PAGE,
        sort: "last_played_at",
        direction: GQL.SortDirectionEnum.Desc,
      },
      scene_filter: {
        resume_time: {
          value: 0,
          modifier: GQL.CriterionModifier.GreaterThan,
        },
      },
    },
  });

  const scenes = data?.findScenes.scenes ?? [];

  // Build a queue from the result so navigation carries the right context.
  const queue = useMemo(
    () => SceneQueue.fromSceneIDList(scenes.map((s) => s.id)),
    [scenes]
  );

  // Don't render the row at all if there's nothing in progress.
  if (!loading && scenes.length === 0) return null;

  const header = intl.formatMessage({
    id: "continue_watching",
    defaultMessage: "Continue Watching",
  });

  return (
    <RecommendationRow
      className="continue-watching-row"
      header={header}
      link={
        <Link to="/scenes?sort=last_played_at&sortdir=desc&resume_time=GreaterThan+0">
          {intl.formatMessage({ id: "view_all", defaultMessage: "View all" })}
        </Link>
      }
    >
      <Carousel itemWidth={320} gap={16}>
        {loading
          ? [...Array(8)].map((_, i) => (
              <Skeleton
                key={`cw_skeleton_${i}`}
                variant="rectangular"
                sx={{ width: 320, height: 240, borderRadius: 1, bgcolor: "grey.800" }}
              />
            ))
          : scenes.map((scene, index) => (
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
