import React, { useState, useContext, PropsWithChildren, useMemo } from "react";
import * as GQL from "src/core/generated-graphql";
import { Link, useHistory } from "react-router-dom";
import {
  Button,
  Collapse,
  TextField,
  Box,
  Grid,
  InputAdornment,
  IconButton,
  Typography,
  Stack,
} from "@mui/material";
import { FormattedMessage } from "react-intl";

import { sortPerformers } from "src/core/performers";
import { Icon } from "src/components/Shared/Icon";
import { OperationButton } from "src/components/Shared/OperationButton";
import { StashIDPill } from "src/components/Shared/StashID";
import { PerformerLink, TagLink } from "src/components/Shared/TagLink";
import { TruncatedText } from "src/components/Shared/TruncatedText";
import { parsePath, prepareQueryString } from "src/components/Tagger/utils";
import { ScenePreview } from "src/components/Scenes/SceneCard";
import { TaggerStateContext } from "../context";
import {
  faChevronDown,
  faChevronUp,
  faImage,
} from "@fortawesome/free-solid-svg-icons";
import { objectPath, objectTitle } from "src/core/files";
import { useConfigurationContext } from "src/hooks/Config";
import { SceneQueue } from "src/models/sceneQueue";

interface ITaggerSceneDetails {
  scene: GQL.SlimSceneDataFragment;
}

const TaggerSceneDetails: React.FC<ITaggerSceneDetails> = ({ scene }) => {
  const [open, setOpen] = useState(false);
  const sorted = sortPerformers(scene.performers);

  return (
    <Box className="original-scene-details">
      <Collapse in={open}>
        <Box className="tagger-scene-details-container">
          <Box className="tagger-scene-column">
            <Typography variant="h6">{objectTitle(scene)}</Typography>
            <Typography variant="subtitle1" color="textSecondary">
              {scene.studio?.name}
              {scene.studio?.name && scene.date && ` • `}
              {scene.date}
            </Typography>
            <TruncatedText text={scene.details ?? ""} lineCount={3} />
          </Box>
          <Box className="tagger-scene-column">
            <div>
              {sorted.map((performer) => (
                <Grid container key={performer.id} className="performer-tag-container">
                  <Grid
                    className="performer-tag zoom-2 performer-thumbnail-grid"
                    component={Link}
                    to={`/performers/${performer.id}`}
                  >
                    <img
                      loading="lazy"
                      className="image-thumbnail"
                      alt={performer.name ?? ""}
                      src={performer.image_path ?? ""}
                    />
                  </Grid>
                  <Box display="block">
                    <PerformerLink
                      key={performer.id}
                      performer={performer}
                    />
                  </Box>
                </Grid>
              ))}
            </div>
            <div>
              {scene.tags.map((tag) => (
                <TagLink key={tag.id} tag={tag} />
              ))}
            </div>
          </Box>
        </Box>
      </Collapse>
      <IconButton
        onClick={() => setOpen(!open)}
        className="collapse-button"
        size="large"
      >
        <Icon icon={open ? faChevronUp : faChevronDown} />
      </IconButton>
    </Box>
  );
};

type StashID = Pick<GQL.StashId, "endpoint" | "stash_id">;

const StashIDs: React.FC<{ stashIDs: StashID[] }> = ({ stashIDs }) => {
  if (!stashIDs.length) {
    return null;
  }

  const stashLinks = stashIDs.map((stashID) => {
    const base = stashID.endpoint.match(/https?:\/\/.*?\//)?.[0];
    const link = base ? (
      <StashIDPill stashID={stashID} linkType="scenes" />
    ) : (
      <span className="small">{stashID.stash_id}</span>
    );

    return <div key={stashID.stash_id}>{link}</div>;
  });

  return <Box className="sub-content" textAlign="right" mt={2}>{stashLinks}</Box>;
};

interface ITaggerScene {
  scene: GQL.SlimSceneDataFragment;
  url: string;
  errorMessage?: string;
  doSceneQuery?: (queryString: string) => void;
  scrapeSceneFragment?: (scene: GQL.SlimSceneDataFragment) => void;
  loading?: boolean;
  showLightboxImage: (imagePath: string) => void;
  queue?: SceneQueue;
  index?: number;
  queryOverride?: string;
}

export const TaggerScene: React.FC<PropsWithChildren<ITaggerScene>> = ({
  scene,
  url,
  loading,
  doSceneQuery,
  scrapeSceneFragment,
  errorMessage,
  children,
  showLightboxImage,
  queue,
  index,
  queryOverride,
}) => {
  const { config } = useContext(TaggerStateContext);
  const [queryString, setQueryString] = useState<string>(queryOverride ?? "");
  const [queryLoading, setQueryLoading] = useState(false);

  const { paths, file: basename } = parsePath(objectPath(scene));
  const defaultQueryString = prepareQueryString(
    scene,
    paths,
    basename,
    config.mode,
    config.blacklist
  );

  const file = useMemo(
    () => (scene.files.length > 0 ? scene.files[0] : undefined),
    [scene]
  );

  const width = file?.width ? file.width : 0;
  const height = file?.height ? file.height : 0;
  const isPortrait = height > width;

  const history = useHistory();

  const { configuration } = useConfigurationContext();
  const cont = configuration?.interface.continuePlaylistDefault ?? false;

  async function query() {
    if (!doSceneQuery) return;

    try {
      setQueryLoading(true);
      await doSceneQuery(queryString || defaultQueryString);
    } finally {
      setQueryLoading(false);
    }
  }

  function renderQueryForm() {
    if (!doSceneQuery) return;

    // Append override to existing query rather than replacing
    const baseQuery = queryString || defaultQueryString;
    const displayValue = queryOverride ? `${baseQuery} ${queryOverride}` : baseQuery;
    const isOverridden = !!queryOverride;

    return (
      <TextField
        fullWidth
        size="small"
        value={displayValue}
        onChange={(e) => setQueryString(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && query()}
        className={isOverridden ? "tagger-query-override" : undefined}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Typography variant="body2" color="textSecondary">
                  <FormattedMessage id="component_tagger.noun_query" />
                  {isOverridden && <span className="ml-1" style={{ color: '#2196f3' }}>(Global)</span>}
                </Typography>
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <OperationButton
                  disabled={loading}
                  operation={query}
                  loading={queryLoading}
                  setLoading={setQueryLoading}
                >
                  <FormattedMessage id="actions.search" />
                </OperationButton>
              </InputAdornment>
            )
          }
        }}
      />
    );
  }

  function onSpriteClick(ev: React.MouseEvent<HTMLElement>) {
    ev.preventDefault();
    showLightboxImage(scene.paths.sprite ?? "");
  }

  function maybeRenderSpriteIcon() {
    // If a scene doesn't have any files, or doesn't have a sprite generated, the
    // path will be http://localhost:9999/scene/_sprite.jpg
    if (scene.files.length > 0) {
      return (
        <IconButton
          className="sprite-button"
          onClick={onSpriteClick}
          size="small"
        >
          <Icon icon={faImage} />
        </IconButton>
      );
    }
  }

  function onScrubberClick(timestamp: number) {
    const link = queue
      ? queue.makeLink(scene.id, {
        sceneIndex: index,
        continue: cont,
        start: timestamp,
      })
      : `/scenes/${scene.id}?t=${timestamp}`;

    history.push(link);
  }

  return (
    <Box key={scene.id} mt={3} className="search-item">
      <Grid container spacing={2}>
        <Grid
          size={{ xs: 12, sm: "grow", lg: 6 }}
          className="scene-card-container"
        >
          <Box className="scene-card" mr={3}>
            <Link to={url}>
              <ScenePreview
                image={scene.paths.screenshot ?? undefined}
                video={scene.paths.preview ?? undefined}
                isPortrait={isPortrait}
                soundActive={false}
                vttPath={scene.paths.vtt ?? undefined}
                onScrubberClick={onScrubberClick}
              />
              {maybeRenderSpriteIcon()}
            </Link>
          </Box>
          <Box className="scene-link scene-link-container" component={Link} to={url}>
            <TruncatedText text={objectTitle(scene)} lineCount={2} />
          </Box>
          {/* Full file path for identification */}
          <Typography variant="body2" color="text.secondary" className="scene-path">
            {objectPath(scene)}
          </Typography>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }} className="scene-query-column">
          <Box>
            {renderQueryForm()}
            {scrapeSceneFragment ? (
              <Box mt={2} textAlign="right">
                <OperationButton
                  disabled={loading}
                  operation={async () => {
                    await scrapeSceneFragment(scene);
                  }}
                >
                  <FormattedMessage id="actions.scrape_scene_fragment" />
                </OperationButton>
              </Box>
            ) : undefined}
          </Box>
          {errorMessage ? (
            <Typography color="error" fontWeight="bold">
              {errorMessage}
            </Typography>
          ) : undefined}
          <StashIDs stashIDs={scene.stash_ids} />
        </Grid>
        <TaggerSceneDetails scene={scene} />
      </Grid>
      {children}
    </Box>
  );
};
