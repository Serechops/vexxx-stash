import React, { useContext, useMemo, useState } from "react";
import * as GQL from "src/core/generated-graphql";
import { SceneQueue } from "src/models/sceneQueue";
import { Button, Form, Dropdown, DropdownButton } from "react-bootstrap";
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
import { faCog } from "@fortawesome/free-solid-svg-icons";
import { useLightbox } from "src/hooks/Lightbox/hooks";

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
  } = useContext(TaggerStateContext);
  const [showConfig, setShowConfig] = useState(false);
  const [hideUnmatched, setHideUnmatched] = useState(false);
  const [globalQueryOverride, setGlobalQueryOverride] = useState("");
  const [fillAllEnabled, setFillAllEnabled] = useState(false);

  const intl = useIntl();

  function handleSourceSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    setCurrentSource(sources!.find((s) => s.id === e.currentTarget.value));
  }

  function renderSourceSelector() {
    return (
      <Form.Group controlId="scraper">
        <Form.Label>
          <FormattedMessage id="component_tagger.config.source" />
        </Form.Label>
        <div>
          <Form.Control
            as="select"
            value={currentSource?.id}
            className="input-control"
            disabled={loading || !sources.length}
            onChange={handleSourceSelect}
          >
            {!sources.length && <option>No scraper sources</option>}
            {sources.map((i) => (
              <option value={i.id} key={i.id}>
                {i.displayName}
              </option>
            ))}
          </Form.Control>
        </div>
      </Form.Group>
    );
  }

  function renderConfigButton() {
    return (
      <div className="ml-2">
        <Button onClick={() => setShowConfig(!showConfig)}>
          <Icon className="fa-fw" icon={faCog} />
        </Button>
      </div>
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
        <Button onClick={toggleHideUnmatchedScenes}>
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
          className="ml-1"
          variant="danger"
          onClick={() => {
            stopMultiScrape();
          }}
        >
          <LoadingIndicator message="" inline small />
          <span className="ml-2">
            {intl.formatMessage({ id: "actions.stop" })}
          </span>
        </Button>
      );
    }

    return (
      <div className="ml-1">
        <OperationButton
          disabled={loading}
          operation={async () => {
            await doMultiSceneFragmentScrape(scenes.map((s) => s.id));
          }}
        >
          {intl.formatMessage({ id: "component_tagger.verb_scrape_all" })}
        </OperationButton>
        {multiError && (
          <>
            <br />
            <b className="text-danger">{multiError}</b>
          </>
        )}
      </div>
    );
  }

  function renderMassActions() {
    if (Object.keys(searchResults).length === 0) return;

    return (
      <DropdownButton
        className="ml-1"
        title={intl.formatMessage({ id: "Bulk Operations" })}
        id="mass-actions-dropdown"
        disabled={loading || loadingMulti}
      >
        <Dropdown.Item onClick={() => doMassCreateTags()} disabled={pendingTagsCount === 0}>
          Create All Tags ({pendingTagsCount})
        </Dropdown.Item>
        <Dropdown.Item onClick={() => doMassCreatePerformers()} disabled={pendingPerformersCount === 0}>
          Create All Performers ({pendingPerformersCount})
        </Dropdown.Item>
        <Dropdown.Item onClick={() => doMassCreateStudios()} disabled={pendingStudiosCount === 0}>
          Create All Studios ({pendingStudiosCount})
        </Dropdown.Item>
        <Dropdown.Item onClick={() => doMassSave()} disabled={pendingScenesCount === 0}>
          Save All Matched ({pendingScenesCount})
        </Dropdown.Item>
        <Dropdown.Divider />
        <Dropdown.Item onClick={() => doRunAll()} disabled={pendingScenesCount === 0}>
          <strong>Run All</strong>
        </Dropdown.Item>
      </DropdownButton>
    );
  }

  return (
    <SceneTaggerModals>
      <div className="tagger-container mx-md-auto">
        <div className="tagger-container-header">
          <div className="d-flex justify-content-between align-items-center flex-wrap">
            <div className="w-auto">{renderSourceSelector()}</div>
            <div className="d-flex">
              {maybeRenderShowHideUnmatchedButton()}
              {maybeRenderSubmitFingerprintsButton()}
              {renderFragmentScrapeButton()}
              {/* Standalone Search All button - visible when Fill All is enabled */}
              {fillAllEnabled && globalQueryOverride && (
                <Button
                  className="ml-1"
                  onClick={() => doSearchAll(scenes, globalQueryOverride)}
                  disabled={loading || loadingMulti || scenes.length === 0}
                >
                  Search All ({scenes.length})
                </Button>
              )}
              {renderMassActions()}
              {renderConfigButton()}
            </div>
          </div>
          <Config show={showConfig} />
          {/* Fill All Queries Input */}
          <div className="d-flex align-items-center mt-2 mb-2">
            <Form.Check
              type="switch"
              id="fill-all-switch"
              label="Fill All Queries"
              checked={fillAllEnabled}
              onChange={(e) => setFillAllEnabled(e.target.checked)}
              className="mr-2"
            />
            {fillAllEnabled && (
              <Form.Control
                type="text"
                placeholder="Enter query text for all scenes..."
                value={globalQueryOverride}
                onChange={(e) => setGlobalQueryOverride(e.target.value)}
                className="w-50"
              />
            )}
          </div>
        </div>
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
      </div>
    </SceneTaggerModals>
  );
};
