import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import cx from "classnames";
import { Button, IconButton, FormControlLabel, Checkbox, CircularProgress, Box } from "@mui/material";
import { useIntl } from "react-intl";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import SkipNextIcon from "@mui/icons-material/SkipNext";
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
      <Box
        component="li"
        key={scene.id}
        sx={{
          my: 1,
          backgroundColor: isCurrentScene(scene) ? "secondary.main" : "transparent",
          "&:hover": {
            backgroundColor: "action.hover"
          }
        }}
      >
        <Link
          to={`/scenes/${scene.id}`}
          onClick={(e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => handleSceneClick(e, scene.id)}
          style={{ textDecoration: 'none', color: 'inherit', width: '100%', display: 'block' }}
        >
          <Box sx={{ ml: 1, display: "flex", alignItems: "center" }}>
            <Box
              className="thumbnail-container"
              sx={{
                height: "80px",
                mb: "5px",
                mr: "0.75rem",
                mt: "5px",
                minWidth: "142px",
                width: "142px",
                "& img": {
                  height: "100%",
                  objectFit: "contain",
                  objectPosition: "center",
                  width: "100%",
                }
              }}
            >
              <img
                loading="lazy"
                alt={scene.title ?? ""}
                src={scene.paths.screenshot ?? ""}
              />
            </Box>
            <Box
              className="queue-scene-details"
              sx={{
                display: "grid",
                overflow: "hidden",
                position: "relative",
                width: { lg: "245px" }
              }}
            >
              <Box
                component="span"
                className="queue-scene-title"
                sx={{
                  fontSize: { xs: "1rem", sm: "1.2rem" },
                  mr: "auto",
                  minWidth: { lg: "245px" },
                  overflow: "hidden",
                  position: "relative",
                  whiteSpace: "nowrap",
                  transition: "2s",
                  "&:hover": {
                    transform: { lg: "translateX(calc(245px - 100%))" }
                  }
                }}
              >
                {objectTitle(scene)}
              </Box>
              <Box
                component="span"
                className="queue-scene-studio"
                sx={{
                  color: "#d3d0d0",
                  fontWeight: 600,
                  mr: "auto",
                  minWidth: { lg: "245px" },
                  overflow: "hidden",
                  position: "relative",
                  whiteSpace: "nowrap",
                  transition: "2s",
                  "&:hover": {
                    transform: { lg: "translateX(calc(245px - 100%))" }
                  }
                }}
              >
                {scene?.studio?.name}
              </Box>
              <Box
                component="span"
                className="queue-scene-performers"
                sx={{
                  color: "#d3d0d0",
                  fontSize: { xs: "0.8rem", sm: "0.9rem" },
                  fontWeight: 400,
                  mr: "auto",
                  minWidth: { lg: "245px" },
                  overflow: "hidden",
                  position: "relative",
                  whiteSpace: "nowrap",
                  transition: "2s",
                  "&:hover": {
                    transform: { lg: "translateX(calc(245px - 100%))" }
                  }
                }}
              >
                {scene?.performers
                  ?.map(function (performer) {
                    return performer.name;
                  })
                  .join(", ")}
              </Box>
              <Box
                component="span"
                className="queue-scene-date"
                sx={{
                  color: "#d3d0d0",
                  fontSize: { xs: "0.8rem", sm: "0.9rem" },
                  fontWeight: 400,
                  mr: "auto",
                  minWidth: { lg: "245px" },
                  overflow: "hidden",
                  position: "relative",
                  whiteSpace: "nowrap",
                  transition: "2s",
                  "&:hover": {
                    transform: { lg: "translateX(calc(245px - 100%))" }
                  }
                }}
              >
                {scene?.date}
              </Box>
            </Box>
          </Box>
        </Link>
      </Box>
    );
  }

  return (
    <Box className="queue-viewer">
      <Box
        className="queue-controls"
        sx={{
          display: "flex",
          alignItems: "center",
          backgroundColor: "#202b33", // $body-bg
          flex: "0 1 auto",
          height: "30px",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <Box>
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
        </Box>
        <Box>
          {currentIndex > 0 || start > 1 ? (
            <IconButton
              onClick={() => onPrevious()}
              size="small"
            >
              <SkipPreviousIcon />
            </IconButton>
          ) : (
            ""
          )}
          {currentIndex < scenes.length - 1 || hasMoreScenes ? (
            <IconButton
              onClick={() => onNext()}
              size="small"
            >
              <SkipNextIcon />
            </IconButton>
          ) : (
            ""
          )}
          <IconButton
            onClick={() => onRandom()}
            size="small"
          >
            <ShuffleIcon />
          </IconButton>
        </Box>
      </Box>
      <Box className="queue-content">
        {start > 1 ? (
          <Box sx={{ display: "flex", justifyContent: "center" }}>
            <Button onClick={() => lessClicked()} disabled={lessLoading}>
              {!lessLoading ? (
                <KeyboardArrowUpIcon />
              ) : (
                <CircularProgress size={20} />
              )}
            </Button>
          </Box>
        ) : undefined}
        <Box component="ol" start={start} sx={{ pl: "20px" }}>{scenes.map(renderPlaylistEntry)}</Box>
        {hasMoreScenes ? (
          <Box sx={{ display: "flex", justifyContent: "center" }}>
            <Button onClick={() => moreClicked()} disabled={moreLoading}>
              {!moreLoading ? (
                <KeyboardArrowDownIcon />
              ) : (
                <CircularProgress size={20} />
              )}
            </Button>
          </Box>
        ) : undefined}
      </Box>
    </Box >
  );
};

export default QueueViewer;
