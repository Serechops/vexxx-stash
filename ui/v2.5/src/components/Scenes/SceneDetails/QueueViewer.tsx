import React, { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  IconButton,
  FormControlLabel,
  Checkbox,
  CircularProgress,
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  Divider,
  Chip,
} from "@mui/material";
import { useIntl } from "react-intl";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import CloseIcon from "@mui/icons-material/Close";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import QueueMusicIcon from "@mui/icons-material/QueueMusic";
import { objectTitle } from "src/core/files";
import { QueuedScene } from "src/models/sceneQueue";

export interface IPlaylistViewer {
  scenes: QueuedScene[];
  currentID?: string;
  originScene?: QueuedScene;
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
  onAddScene?: (scene: QueuedScene) => void;
  onRemoveScene?: (id: string) => void;
  onClearQueue?: () => void;
}

export const QueueViewer: React.FC<IPlaylistViewer> = ({
  scenes,
  currentID,
  originScene,
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
  onAddScene,
  onRemoveScene,
  onClearQueue,
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

  function renderOriginScene() {
    if (!originScene) return null;

    return (
      <Box sx={{ mb: 0 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            px: 1.5,
            pt: 1,
            pb: 0.5,
          }}
        >
          <PlayArrowIcon sx={{ fontSize: 14, color: "primary.main" }} />
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "primary.main",
              fontSize: "0.65rem",
            }}
          >
            Now Playing
          </Typography>
        </Box>
        <Box
          sx={{
            mx: 1,
            borderRadius: 1,
            bgcolor: isCurrentScene(originScene)
              ? "rgba(99, 102, 241, 0.12)"
              : "transparent",
            border: "1px solid",
            borderColor: isCurrentScene(originScene)
              ? "primary.main"
              : "transparent",
            "&:hover": {
              bgcolor: "action.hover",
            },
          }}
        >
          <Link
            to={`/scenes/${originScene.id}`}
            onClick={(e) => handleSceneClick(e, originScene.id)}
            style={{
              textDecoration: "none",
              color: "inherit",
              display: "block",
            }}
          >
            <Box sx={{ p: 1, display: "flex", alignItems: "center", gap: 1.5 }}>
              <Box
                sx={{
                  width: 100,
                  height: 56,
                  flexShrink: 0,
                  borderRadius: 0.5,
                  overflow: "hidden",
                  bgcolor: "#000",
                }}
              >
                <img
                  loading="lazy"
                  alt={originScene.title ?? ""}
                  src={originScene.paths.screenshot ?? ""}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ fontWeight: 600, lineHeight: 1.3 }}
                >
                  {objectTitle(originScene)}
                </Typography>
                {originScene.studio?.name && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ display: "block" }}
                  >
                    {originScene.studio.name}
                  </Typography>
                )}
                {originScene.performers &&
                  originScene.performers.length > 0 && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                      sx={{ display: "block" }}
                    >
                      {originScene.performers
                        .map((p) => p.name)
                        .join(", ")}
                    </Typography>
                  )}
              </Box>
            </Box>
          </Link>
        </Box>
        <Divider
          sx={{
            mt: 1,
            mx: 1,
            borderColor: "rgba(255,255,255,0.08)",
          }}
        />
        {scenes.length > 0 && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              px: 1.5,
              pt: 0.75,
              pb: 0.25,
            }}
          >
            <QueueMusicIcon sx={{ fontSize: 14, color: "text.secondary" }} />
            <Typography
              variant="caption"
              sx={{
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                color: "text.secondary",
                fontSize: "0.65rem",
              }}
            >
              Up Next
            </Typography>
            <Chip
              label={scenes.length}
              size="small"
              sx={{
                height: 16,
                fontSize: "0.6rem",
                ml: 0.5,
                "& .MuiChip-label": { px: 0.75 },
              }}
            />
            <Box sx={{ ml: "auto" }}>
              {onClearQueue && (
                <Button
                  size="small"
                  onClick={onClearQueue}
                  sx={{
                    fontSize: "0.65rem",
                    textTransform: "none",
                    py: 0,
                    px: 1,
                    minWidth: "auto",
                    color: "text.secondary",
                    "&:hover": { color: "error.main" },
                  }}
                >
                  Clear All
                </Button>
              )}
            </Box>
          </Box>
        )}
      </Box>
    );
  }

  function renderEmptyState() {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          py: 4,
          px: 2,
          color: "text.secondary",
        }}
      >
        <QueueMusicIcon sx={{ fontSize: 40, mb: 1.5, opacity: 0.3 }} />
        <Typography variant="body2" sx={{ mb: 0.5 }}>
          No scenes queued yet
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Search or pick from suggestions above
        </Typography>
      </Box>
    );
  }

  function renderPlaylistEntry(scene: QueuedScene) {
    return (
      <Box
        component="li"
        key={scene.id}
        sx={{
          my: 0.5,
          backgroundColor: isCurrentScene(scene)
            ? "rgba(99, 102, 241, 0.12)"
            : "transparent",
          borderRadius: 1,
          "&:hover": {
            backgroundColor: "action.hover",
          },
          display: "flex",
          alignItems: "center",
          listStyle: "none",
        }}
      >
        <Link
          to={`/scenes/${scene.id}`}
          onClick={(e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) =>
            handleSceneClick(e, scene.id)
          }
          style={{
            textDecoration: "none",
            color: "inherit",
            flex: 1,
            display: "block",
            minWidth: 0,
          }}
        >
          <Box sx={{ p: 0.75, display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box
              sx={{
                width: 80,
                height: 45,
                flexShrink: 0,
                borderRadius: 0.5,
                overflow: "hidden",
                bgcolor: "#000",
              }}
            >
              <img
                loading="lazy"
                alt={scene.title ?? ""}
                src={scene.paths.screenshot ?? ""}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                variant="body2"
                noWrap
                sx={{ fontWeight: 500, fontSize: "0.8rem", lineHeight: 1.3 }}
              >
                {objectTitle(scene)}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ display: "block", fontSize: "0.7rem" }}
              >
                {scene?.studio?.name}
                {scene?.performers && scene.performers.length > 0 && (
                  <>
                    {scene?.studio?.name ? " • " : ""}
                    {scene.performers.map((p) => p.name).join(", ")}
                  </>
                )}
              </Typography>
            </Box>
          </Box>
        </Link>
        {onRemoveScene && (
          <IconButton
            size="small"
            onClick={() => onRemoveScene(scene.id)}
            sx={{
              mr: 0.5,
              opacity: 0.3,
              "&:hover": { opacity: 1, color: "error.main" },
            }}
          >
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        )}
      </Box>
    );
  }

  return (
    <Box className="queue-viewer">
      {/* Playback controls — always visible */}
      <Box
        className="queue-controls"
        sx={{
          display: "flex",
          alignItems: "center",
          backgroundColor: "rgba(0,0,0,0.2)",
          flex: "0 1 auto",
          height: "32px",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 100,
          px: 0.5,
        }}
      >
        <Box>
          <FormControlLabel
            control={
              <Checkbox
                id="continue-checkbox"
                checked={continuePlaylist}
                onChange={() => setContinue(!continuePlaylist)}
                size="small"
              />
            }
            label={intl.formatMessage({ id: "actions.continue" })}
            sx={{ "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }}
          />
        </Box>
        <Box>
          {(currentIndex > 0 || start > 1) && (
            <IconButton onClick={() => onPrevious()} size="small">
              <SkipPreviousIcon sx={{ fontSize: 18 }} />
            </IconButton>
          )}
          {(currentIndex < scenes.length - 1 || hasMoreScenes) && (
            <IconButton onClick={() => onNext()} size="small">
              <SkipNextIcon sx={{ fontSize: 18 }} />
            </IconButton>
          )}
          <IconButton onClick={() => onRandom()} size="small">
            <ShuffleIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      </Box>

      <Box className="queue-content">
        {renderOriginScene()}
        {scenes.length === 0 ? (
          renderEmptyState()
        ) : (
          <>
            {start > 1 && (
              <Box sx={{ display: "flex", justifyContent: "center" }}>
                <Button onClick={() => lessClicked()} disabled={lessLoading}>
                  {!lessLoading ? (
                    <KeyboardArrowUpIcon />
                  ) : (
                    <CircularProgress size={20} />
                  )}
                </Button>
              </Box>
            )}
            <Box component="ul" sx={{ pl: 0, m: 0, listStyle: "none" }}>
              {scenes.map(renderPlaylistEntry)}
            </Box>
            {hasMoreScenes && (
              <Box sx={{ display: "flex", justifyContent: "center" }}>
                <Button onClick={() => moreClicked()} disabled={moreLoading}>
                  {!moreLoading ? (
                    <KeyboardArrowDownIcon />
                  ) : (
                    <CircularProgress size={20} />
                  )}
                </Button>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
};

export default QueueViewer;
