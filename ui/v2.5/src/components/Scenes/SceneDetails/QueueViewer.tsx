import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import cx from "classnames";
import { Button, IconButton, FormControlLabel, Checkbox, CircularProgress, Box } from "@mui/material";
import { Icon } from "src/components/Shared/Icon";
import { useIntl } from "react-intl";
import {
  faChevronDown,
  faChevronUp,
  faRandom,
  faStepBackward,
  faStepForward,
} from "@fortawesome/free-solid-svg-icons";
import { objectTitle } from "src/core/files";
import { QueuedScene } from "src/models/sceneQueue";

export interface IPlaylistViewer {
  scenes: QueuedScene[];
  currentID?: string;
  start?: number;
  continue?: boolean;
  hasMoreScenes: boolean;
  setContinue: (v: boolean) => void;
  onSceneClicked: (id: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onRandom: () => void;
  onMoreScenes: () => void;
  onLessScenes: () => void;
}

export const QueueViewer: React.FC<IPlaylistViewer> = ({
  scenes,
  currentID,
  start = 0,
  continue: continuePlaylist = false,
  hasMoreScenes,
  setContinue,
  onNext,
  onPrevious,
  onRandom,
  onSceneClicked,
  onMoreScenes,
  onLessScenes,
}) => {
  const intl = useIntl();
  const [lessLoading, setLessLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);

  const currentIndex = scenes.findIndex((s) => s.id === currentID);

  useEffect(() => {
    setLessLoading(false);
    setMoreLoading(false);
  }, [scenes]);

  function isCurrentScene(scene: QueuedScene) {
    return scene.id === currentID;
  }

  function handleSceneClick(
    event: React.MouseEvent<HTMLAnchorElement, MouseEvent>,
    id: string
  ) {
    onSceneClicked(id);
    event.preventDefault();
  }

  function lessClicked() {
    setLessLoading(true);
    onLessScenes();
  }

  function moreClicked() {
    setMoreLoading(true);
    onMoreScenes();
  }

  function renderPlaylistEntry(scene: QueuedScene) {
    return (
      <li
        className={cx("my-2", { current: isCurrentScene(scene) })}
        key={scene.id}
      >
        <Link
          to={`/scenes/${scene.id}`}
          onClick={(e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => handleSceneClick(e, scene.id)}
          style={{ textDecoration: 'none', color: 'inherit', width: '100%' }}
        >
          <div className="ml-1 d-flex align-items-center">
            <div className="thumbnail-container">
              <img
                loading="lazy"
                alt={scene.title ?? ""}
                src={scene.paths.screenshot ?? ""}
              />
            </div>
            <div className="queue-scene-details">
              <span className="queue-scene-title">{objectTitle(scene)}</span>
              <span className="queue-scene-studio">{scene?.studio?.name}</span>
              <span className="queue-scene-performers">
                {scene?.performers
                  ?.map(function (performer) {
                    return performer.name;
                  })
                  .join(", ")}
              </span>
              <span className="queue-scene-date">{scene?.date}</span>
            </div>
          </div>
        </Link>
      </li>
    );
  }

  return (
    <div id="queue-viewer">
      <div className="queue-controls">
        <div>
          <FormControlLabel
            control={
              <Checkbox
                id="continue-checkbox"
                checked={continuePlaylist}
                onChange={() => setContinue(!continuePlaylist)}
              />
            }
            label={intl.formatMessage({ id: "actions.continue" })}
          />
        </div>
        <div>
          {currentIndex > 0 || start > 1 ? (
            <IconButton
              onClick={() => onPrevious()}
              size="small"
            >
              <Icon icon={faStepBackward} />
            </IconButton>
          ) : (
            ""
          )}
          {currentIndex < scenes.length - 1 || hasMoreScenes ? (
            <IconButton
              onClick={() => onNext()}
              size="small"
            >
              <Icon icon={faStepForward} />
            </IconButton>
          ) : (
            ""
          )}
          <IconButton
            onClick={() => onRandom()}
            size="small"
          >
            <Icon icon={faRandom} />
          </IconButton>
        </div>
      </div>
      <div id="queue-content">
        {start > 1 ? (
          <div className="d-flex justify-content-center">
            <Button onClick={() => lessClicked()} disabled={lessLoading}>
              {!lessLoading ? (
                <Icon icon={faChevronUp} />
              ) : (
                <CircularProgress size={20} />
              )}
            </Button>
          </div>
        ) : undefined}
        <ol start={start}>{scenes.map(renderPlaylistEntry)}</ol>
        {hasMoreScenes ? (
          <div className="d-flex justify-content-center">
            <Button onClick={() => moreClicked()} disabled={moreLoading}>
              {!moreLoading ? (
                <Icon icon={faChevronDown} />
              ) : (
                <CircularProgress size={20} />
              )}
            </Button>
          </div>
        ) : undefined}
      </div>
    </div>
  );
};

export default QueueViewer;
