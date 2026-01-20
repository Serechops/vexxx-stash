import React, { useContext, useMemo, useState } from "react";
import * as GQL from "src/core/generated-graphql";
import { SceneQueue } from "src/models/sceneQueue";
import {
  Button,
  TextField,
  MenuItem,
  Menu,
  LinearProgress,
  Box,
  Stack,
  Typography,
  FormControlLabel,
  Switch,
  Divider,
} from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";

import { Icon } from "src/components/Shared/Icon";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { OperationButton } from "src/components/Shared/OperationButton";
import { ISceneQueryResult, TaggerStateContext } from "../context";
import Config from "./Config";
import { TaggerScene } from "./TaggerScene";
import { SceneTaggerModals } from "./sceneTaggerModals";
import { SceneSearchResults } from "./StashSearchResult";
import { useConfigurationContext } from "src/hooks/Config";
import { faCog, faClipboardList } from "@fortawesome/free-solid-svg-icons";
import { useLightbox } from "src/hooks/Lightbox/hooks";
import { TaggerReview } from "./TaggerReview";

const Scene: React.FC<{
  scene: GQL.SlimSceneDataFragment;
  searchResult?: ISceneQueryResult;
  queue?: SceneQueue;
  index: number;
  showLightboxImage: (imagePath: string) => void;
  queryOverride?: string;
}> = ({ scene, searchResult, queue, index, showLightboxImage, queryOverride }) => {
  const intl = useIntl();
  const { currentSource, doSceneQuery, doSceneFragmentScrape, loading } =
    useContext(TaggerStateContext);
  const { configuration } = useConfigurationContext();

  const cont = configuration?.interface.continuePlaylistDefault ?? false;

  const sceneLink = useMemo(
    () =>
      queue
        ? queue.makeLink(scene.id, { sceneIndex: index, continue: cont })
        : `/scenes/${scene.id}`,
    [queue, scene.id, index, cont]
  );

  const errorMessage = useMemo(() => {
    if (searchResult?.error) {
      return searchResult.error;
    } else if (searchResult && searchResult.results?.length === 0) {
      return intl.formatMessage({
        id: "component_tagger.results.match_failed_no_result",
      });
    }
  }, [intl, searchResult]);

  return (
    <TaggerScene
      loading={loading}
      scene={scene}
      url={sceneLink}
      errorMessage={errorMessage}
      doSceneQuery={
        currentSource?.supportSceneQuery
          ? async (v) => {
            await doSceneQuery(scene.id, v);
          }
          : undefined
      }
      scrapeSceneFragment={
        currentSource?.supportSceneFragment
          ? async () => {
            await doSceneFragmentScrape(scene.id);
          }
          : undefined
      }
      showLightboxImage={showLightboxImage}
      queue={queue}
      index={index}
      queryOverride={queryOverride}
    >
      {searchResult && searchResult.results?.length ? (
        <SceneSearchResults scenes={searchResult.results} target={scene} />
      ) : undefined}
    </TaggerScene>
  );
};

interface ITaggerProps {
  scenes: GQL.SlimSceneDataFragment[];
  queue?: SceneQueue;
}

export const Tagger: React.FC<ITaggerProps> = ({ scenes, queue }) => {
  const {
    sources,
    setCurrentSource,
    currentSource,
    doMultiSceneFragmentScrape,
    stopMultiScrape,
    searchResults,
    loading,
    loadingMulti,
    multiError,
    submitFingerprints,
    pendingFingerprints,
    doMassSave,
    doMassCreateTags,
    doMassCreatePerformers,
    doMassCreateStudios,
    doRunAll,
    pendingTagsCount,
    pendingPerformersCount,
    pendingStudiosCount,
    pendingScenesCount,
    doSearchAll,
    bulkProgress,
    taggerHistory,
  } = useContext(TaggerStateContext);
  const [showConfig, setShowConfig] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [hideUnmatched, setHideUnmatched] = useState(false);
  const [globalQueryOverride, setGlobalQueryOverride] = useState("");
  const [fillAllEnabled, setFillAllEnabled] = useState(false);
  const [massActionsAnchorEl, setMassActionsAnchorEl] = useState<null | HTMLElement>(null);

  const intl = useIntl();

  function handleSourceSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setCurrentSource(sources!.find((s) => s.id === e.target.value));
  }

  function renderSourceSelector() {
    return (
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          <FormattedMessage id="component_tagger.config.source" />
        </Typography>
        <TextField
          select
          size="small"
          value={currentSource?.id || ""}
          disabled={loading || !sources.length}
          onChange={handleSourceSelect}
          className="scene-tagger-source-select"
        >
          {!sources.length && <MenuItem value="">No scraper sources</MenuItem>}
          {sources.map((i) => (
            <MenuItem value={i.id} key={i.id}>
              {i.displayName}
            </MenuItem>
          ))}
        </TextField>
      </Box>
    );
  }

  function renderConfigButton() {
    return (
      <Button onClick={() => setShowConfig(!showConfig)} variant="outlined" size="small">
        <Icon className="fa-fw" icon={faCog} />
      </Button>
    );
  }

  const [spriteImage, setSpriteImage] = useState<string | null>(null);
  const lightboxImage = useMemo(
    () => [{ paths: { thumbnail: spriteImage, image: spriteImage } }],
    [spriteImage]
  );
  const showLightbox = useLightbox({
    images: lightboxImage,
  });
  function showLightboxImage(imagePath: string) {
    setSpriteImage(imagePath);
    showLightbox({ images: lightboxImage });
  }

  const filteredScenes = useMemo(
    () =>
      !hideUnmatched
        ? scenes
        : scenes.filter((s) => searchResults[s.id]?.results?.length),
    [scenes, searchResults, hideUnmatched]
  );

  const toggleHideUnmatchedScenes = () => {
    setHideUnmatched(!hideUnmatched);
  };

  function maybeRenderShowHideUnmatchedButton() {
    if (Object.keys(searchResults).length) {
      return (
        <Button onClick={toggleHideUnmatchedScenes} variant="outlined" size="small">
          <FormattedMessage
            id="component_tagger.verb_toggle_unmatched"
            values={{
              toggle: (
                <FormattedMessage
                  id={`actions.${!hideUnmatched ? "hide" : "show"}`}
                />
              ),
            }}
          />
        </Button>
      );
    }
  }

  function maybeRenderSubmitFingerprintsButton() {
    if (pendingFingerprints.length) {
      return (
        <OperationButton
          className="ml-1"
          operation={submitFingerprints}
          disabled={loading || loadingMulti}
        >
          <span>
            <FormattedMessage
              id="component_tagger.verb_submit_fp"
              values={{ fpCount: pendingFingerprints.length }}
            />
          </span>
        </OperationButton>
      );
    }
  }

  function renderFragmentScrapeButton() {
    if (!currentSource?.supportSceneFragment) {
      return;
    }

    if (scenes.length === 0) {
      return;
    }

    if (loadingMulti) {
      return (
        <Button
          variant="contained"
          color="error"
          size="small"
          onClick={() => {
            stopMultiScrape();
          }}
          startIcon={<LoadingIndicator message="" inline small />}
        >
          {intl.formatMessage({ id: "actions.stop" })}
        </Button>
      );
    }

    return (
      <OperationButton
        disabled={loading}
        operation={async () => {
          await doMultiSceneFragmentScrape(scenes.map((s) => s.id));
        }}
      >
        {intl.formatMessage({ id: "component_tagger.verb_scrape_all" })}
      </OperationButton>
    );
  }

  function renderMassActions() {
    if (Object.keys(searchResults).length === 0) return;

    return (
      <>
        <Button
          variant="outlined"
          size="small"
          onClick={(e) => setMassActionsAnchorEl(e.currentTarget)}
          disabled={loading || loadingMulti}
        >
          {intl.formatMessage({ id: "Bulk Operations" })}
        </Button>
        <Menu
          anchorEl={massActionsAnchorEl}
          open={Boolean(massActionsAnchorEl)}
          onClose={() => setMassActionsAnchorEl(null)}
        >
          <MenuItem onClick={() => { doMassCreateTags(); setMassActionsAnchorEl(null); }} disabled={pendingTagsCount === 0}>
            Create All Tags ({pendingTagsCount})
          </MenuItem>
          <MenuItem onClick={() => { doMassCreatePerformers(); setMassActionsAnchorEl(null); }} disabled={pendingPerformersCount === 0}>
            Create All Performers ({pendingPerformersCount})
          </MenuItem>
          <MenuItem onClick={() => { doMassCreateStudios(); setMassActionsAnchorEl(null); }} disabled={pendingStudiosCount === 0}>
            Create All Studios ({pendingStudiosCount})
          </MenuItem>
          <MenuItem onClick={() => { doMassSave(); setMassActionsAnchorEl(null); }} disabled={pendingScenesCount === 0}>
            Save All Matched ({pendingScenesCount})
          </MenuItem>
          <Divider />
          <MenuItem onClick={() => { doRunAll(); setMassActionsAnchorEl(null); }} disabled={pendingScenesCount === 0}>
            <strong>Run All</strong>
          </MenuItem>
        </Menu>
      </>
    );
  }

  function renderBulkProgress() {
    if (!bulkProgress) return null;
    const percent = (bulkProgress.progress / bulkProgress.total) * 100;
    return (
      <Box mb={3}>
        <Stack direction="row" justifyContent="space-between" mb={1}>
          <Typography variant="body2">{bulkProgress.message}</Typography>
          <Typography variant="body2">{bulkProgress.progress} / {bulkProgress.total}</Typography>
        </Stack>
        <LinearProgress variant="determinate" value={percent} />
      </Box>
    );
  }

  return (
    <SceneTaggerModals>
      <Box className="tagger-container mx-md-auto">
        <Box className="tagger-container-header">
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" spacing={2}>
            <Box>{renderSourceSelector()}</Box>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {maybeRenderShowHideUnmatchedButton()}
              {maybeRenderSubmitFingerprintsButton()}
              {renderFragmentScrapeButton()}
              {/* Standalone Search All button - visible when Fill All is enabled */}
              {fillAllEnabled && globalQueryOverride && (
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => doSearchAll(scenes, globalQueryOverride)}
                  disabled={loading || loadingMulti || scenes.length === 0}
                >
                  Search All ({scenes.length})
                </Button>
              )}
              {renderMassActions()}
              {/* Review toggle button */}
              {taggerHistory.length > 0 && (
                <Button
                  variant={showReview ? "contained" : "outlined"}
                  size="small"
                  onClick={() => setShowReview(!showReview)}
                  title="Show Tagging Session Review"
                  startIcon={<Icon icon={faClipboardList} />}
                >
                  {taggerHistory.length}
                </Button>
              )}
              {renderConfigButton()}
            </Stack>
          </Stack>
          <Config show={showConfig} />
          {/* Fill All Queries Input */}
          <Stack direction="row" alignItems="center" spacing={2} mt={2} mb={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={fillAllEnabled}
                  onChange={(e) => setFillAllEnabled(e.target.checked)}
                  size="small"
                />
              }
              label="Fill All Queries"
            />
            {fillAllEnabled && (
              <TextField
                size="small"
                placeholder="Enter query text for all scenes..."
                value={globalQueryOverride}
                onChange={(e) => setGlobalQueryOverride(e.target.value)}
                className="scene-tagger-query-input"
              />
            )}
          </Stack>
        </Box>
        {renderBulkProgress()}
        <TaggerReview show={showReview} onClose={() => setShowReview(false)} />
        <div>
          {filteredScenes.map((s, i) => (
            <Scene
              key={s.id}
              scene={s}
              searchResult={searchResults[s.id]}
              index={i}
              showLightboxImage={showLightboxImage}
              queue={queue}
              queryOverride={fillAllEnabled ? globalQueryOverride : undefined}
            />
          ))}
        </div>
      </Box>
    </SceneTaggerModals>
  );
};
