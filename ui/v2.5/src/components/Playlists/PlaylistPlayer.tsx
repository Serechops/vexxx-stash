import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useHistory, useLocation, Link } from "react-router-dom";
import {
  Box,
  IconButton,
  Fade,
  Switch,
  FormControlLabel,
} from "@mui/material";
import {
  faChevronLeft,
  faChevronRight,
  faPlay,
  faPause,
  faVolumeUp,
  faVolumeMute,
  faExpand,
  faCompress,
  faPlayCircle,
  faImage,
  faImages,
  faFilm,
  faRandom,
  faStepBackward,
  faStepForward,
} from "@fortawesome/free-solid-svg-icons";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { FormattedMessage, useIntl } from "react-intl";
import { Helmet } from "react-helmet";
import { Icon } from "../Shared/Icon";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { ErrorMessage } from "../Shared/ErrorMessage";
import { TruncatedText } from "../Shared/TruncatedText";
import { useLightboxContext } from "src/hooks/Lightbox/context";
import { useFindPlaylist } from "src/core/StashService";
import * as GQL from "src/core/generated-graphql";
import { PlaylistQueue, PlaybackItem } from "src/models/playlistQueue";
import TextUtils from "src/utils/text";
import cx from "classnames";
import "./PlaylistPlayer.scss";

// ============================================
// Types & Interfaces
// ============================================

interface IPlaylistPlayerParams {
  id: string;
}

interface IMediaPlayerProps {
  scene: GQL.SceneDataFragment;
  autoplay: boolean;
  onComplete: () => void;
  onNext: () => void;
  onPrevious: () => void;
  hasNext: boolean;
  hasPrevious: boolean;
}

// ============================================
// Utility Functions
// ============================================

const getMediaIcon = (type: string) => {
  switch (type) {
    case "scene":
      return faPlayCircle;
    case "image":
      return faImage;
    case "gallery":
      return faImages;
    default:
      return faPlayCircle;
  }
};

const getStreamUrl = (scene: GQL.SceneDataFragment): string => {
  if (!scene.sceneStreams || scene.sceneStreams.length === 0) {
    return `/scene/${scene.id}/stream`;
  }
  // Prefer MP4/WebM for native playback
  const compatibleStream = scene.sceneStreams.find(
    (s) =>
      s.mime_type?.includes("video/mp4") ||
      s.mime_type?.includes("video/webm")
  );
  return compatibleStream?.url || scene.sceneStreams[0].url;
};

// ============================================
// Media Player Component
// ============================================

const MediaPlayer: React.FC<IMediaPlayerProps> = ({
  scene,
  autoplay,
  onComplete,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const hideControlsTimeout = useRef<number>();

  const streamUrl = useMemo(() => getStreamUrl(scene), [scene]);

  // Auto-hide controls after inactivity
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimeout.current) {
      clearTimeout(hideControlsTimeout.current);
    }
    if (playing) {
      hideControlsTimeout.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  }, [playing]);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
      }
    };
  }, [playing, resetControlsTimer]);

  // Fullscreen handling
  useEffect(() => {
    const onFSChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFSChange);
    return () => document.removeEventListener("fullscreenchange", onFSChange);
  }, []);

  // Autoplay on mount
  useEffect(() => {
    if (autoplay && videoRef.current) {
      videoRef.current.play().catch(() => {
        // Autoplay blocked, user needs to interact
      });
    }
  }, [autoplay, scene.id]);

  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  }, []);

  const handleEnded = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const time = Number(e.target.value);
      if (videoRef.current) {
        videoRef.current.currentTime = time;
        setCurrentTime(time);
      }
    },
    []
  );

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVolume = Number(e.target.value);
      if (videoRef.current) {
        videoRef.current.volume = newVolume;
      }
      setVolume(newVolume);
      setMuted(newVolume === 0);
    },
    []
  );

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = !muted;
      setMuted(!muted);
    }
  }, [muted]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className={cx("media-player", {
        fullscreen,
        "controls-visible": showControls,
      })}
      onMouseMove={resetControlsTimer}
      onMouseLeave={() => playing && setShowControls(false)}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={streamUrl}
        className="media-player-video"
        poster={scene.paths?.screenshot || undefined}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={handleEnded}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        controls
      />

      {/* Buffering Indicator */}
      <Fade in={buffering}>
        <div className="media-player-buffering">
          <LoadingIndicator />
        </div>
      </Fade>

      {/* Navigation Controls Overlay */}
      <Fade in={showControls}>
        <div className="media-player-nav-controls">
          <IconButton
            onClick={onPrevious}
            disabled={!hasPrevious}
            className="media-nav-btn"
            size="large"
          >
            <Icon icon={faChevronLeft} />
          </IconButton>

          <IconButton
            onClick={onNext}
            disabled={!hasNext}
            className="media-nav-btn"
            size="large"
          >
            <Icon icon={faChevronRight} />
          </IconButton>
        </div>
      </Fade>
    </div>
  );
};

// ============================================
// Image Viewer Component
// ============================================

interface IImageViewerProps {
  image: GQL.SlimImageDataFragment;
  onComplete: () => void;
  onViewInLightbox: () => void;
  autoAdvance: boolean;
}

const ImageViewer: React.FC<IImageViewerProps> = ({
  image,
  onComplete,
  onViewInLightbox,
  autoAdvance,
}) => {
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!autoAdvance) return;

    setCountdown(5);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          onComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [image.id, onComplete, autoAdvance]);

  return (
    <div className="image-viewer" onClick={onViewInLightbox}>
      <img
        src={image.paths?.image || ""}
        alt={image.title || ""}
        className="image-viewer-img"
      />
      {autoAdvance && (
        <div className="image-viewer-countdown">
          <FormattedMessage id="next_in" defaultMessage="Next in" /> {countdown}s
        </div>
      )}
      <div className="image-viewer-hint">
        <Icon icon={faExpand} />{" "}
        <FormattedMessage id="click_to_expand" defaultMessage="Click to expand" />
      </div>
    </div>
  );
};

// ============================================
// Queue Panel Component (Left Column)
// ============================================

interface IQueuePanelProps {
  playlist: GQL.PlaylistDataFragment;
  items: PlaybackItem[];
  currentIndex: number;
  onItemClick: (index: number) => void;
  continuePlaylist: boolean;
  setContinuePlaylist: (value: boolean) => void;
  onNext: () => void;
  onPrevious: () => void;
  onRandom: () => void;
  hasNext: boolean;
  hasPrevious: boolean;
}

const QueuePanel: React.FC<IQueuePanelProps> = ({
  playlist,
  items,
  currentIndex,
  onItemClick,
  continuePlaylist,
  setContinuePlaylist,
  onNext,
  onPrevious,
  onRandom,
  hasNext,
  hasPrevious,
}) => {
  const selectedRef = useRef<HTMLDivElement>(null);
  const intl = useIntl();

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [currentIndex]);

  return (
    <Box className="playlist-queue-panel">
      {/* Header */}
      <Box className="playlist-queue-header">
        <Box className="playlist-queue-title">
          <Link to={`/playlists/${playlist.id}`} className="playlist-link">
            <TruncatedText lineCount={2} text={playlist.name} />
          </Link>
        </Box>
        <Box className="playlist-queue-counter">
          {currentIndex + 1} / {items.length}
        </Box>
      </Box>

      {/* Playback Controls */}
      <Box className="playlist-queue-controls">
        <Box className="playlist-nav-buttons">
          <IconButton
            onClick={onPrevious}
            disabled={!hasPrevious}
            size="small"
            title={intl.formatMessage({ id: "previous" })}
          >
            <Icon icon={faStepBackward} />
          </IconButton>
          <IconButton
            onClick={onNext}
            disabled={!hasNext}
            size="small"
            title={intl.formatMessage({ id: "next" })}
          >
            <Icon icon={faStepForward} />
          </IconButton>
          <IconButton
            onClick={onRandom}
            size="small"
            title={intl.formatMessage({ id: "actions.random" })}
          >
            <Icon icon={faRandom} />
          </IconButton>
        </Box>
        <FormControlLabel
          control={
            <Switch
              checked={continuePlaylist}
              onChange={(e) => setContinuePlaylist(e.target.checked)}
              size="small"
            />
          }
          label={
            <FormattedMessage id="auto_play" defaultMessage="Auto-play" />
          }
          className="playlist-autoplay-toggle"
        />
      </Box>

      {/* Queue List */}
      <Box className="playlist-queue-list">
        {items.map((item, index) => {
          const isActive = index === currentIndex;
          const isPast = index < currentIndex;
          return (
            <Box
              key={`${item.type}-${item.id}-${index}`}
              ref={isActive ? selectedRef : null}
              className={cx("playlist-queue-item", {
                active: isActive,
                past: isPast,
              })}
              onClick={() => onItemClick(index)}
            >
              <Box className="queue-item-number">{index + 1}</Box>
              <Box className="queue-item-thumb">
                {item.thumbnailPath ? (
                  <img src={item.thumbnailPath} alt="" />
                ) : (
                  <Box className="queue-item-thumb-placeholder">
                    <Icon icon={getMediaIcon(item.type)} />
                  </Box>
                )}
                {isActive && (
                  <Box className="queue-item-playing">
                    <Icon icon={faPlay} />
                  </Box>
                )}
              </Box>
              <Box className="queue-item-info">
                <Box className="queue-item-title">
                  {item.title || `Untitled ${item.type}`}
                </Box>
                <Box className="queue-item-meta">
                  <span className="queue-item-type">{item.type}</span>
                  {item.duration && item.duration > 0 && (
                    <span className="queue-item-duration">
                      {TextUtils.secondsToTimestamp(item.duration)}
                    </span>
                  )}
                  {item.groupId && (
                    <span className="queue-item-group">
                      <Icon icon={faFilm} /> Group
                    </span>
                  )}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

// ============================================
// Main Playlist Player Component
// ============================================

export const PlaylistPlayer: React.FC = () => {
  const { id } = useParams<IPlaylistPlayerParams>();
  const history = useHistory();
  const location = useLocation();
  const intl = useIntl();
  const { setLightboxState } = useLightboxContext();

  const queryParams = new URLSearchParams(location.search);
  const initialIndex = parseInt(queryParams.get("index") || "0", 10);
  const autoplay = queryParams.get("autoplay") !== "false";

  const [queue, setQueue] = useState<PlaylistQueue | null>(null);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [continuePlaylist, setContinuePlaylist] = useState(autoplay);

  // Scene data for current item
  const [currentScene, setCurrentScene] = useState<GQL.SceneDataFragment | null>(
    null
  );
  const [currentImage, setCurrentImage] =
    useState<GQL.SlimImageDataFragment | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);

  // Fetch playlist data
  const { data: playlistData, loading, error } = useFindPlaylist({ id });
  const playlist = playlistData?.findPlaylist;

  // Lazy queries for fetching media
  const [fetchScene] = GQL.useFindSceneLazyQuery();
  const [fetchImage] = GQL.useFindImageLazyQuery();
  const [fetchGroup] = GQL.useFindGroupLazyQuery();
  const [fetchGalleryImages] = GQL.useFindImagesLazyQuery();

  // Build the queue when playlist loads
  useEffect(() => {
    if (!playlist || !playlist.items) return;

    const newQueue = PlaylistQueue.fromPlaylistItems(id, playlist.items);
    const groupIds = newQueue.getGroupIds();

    if (groupIds.length === 0) {
      newQueue.initialize();
      setQueue(newQueue);
      setGroupsLoaded(true);
    } else {
      Promise.all(
        groupIds.map(async (groupId) => {
          const result = await fetchGroup({ variables: { id: groupId } });
          const group = result.data?.findGroup;
          if (group?.scenes) {
            newQueue.setGroupScenes(
              groupId,
              group.scenes.map((gs) => ({
                sceneId: gs.scene.id,
                sceneIndex: gs.scene_index,
                title: gs.scene.title,
                thumbnailPath: null,
                duration: null,
              }))
            );
          }
        })
      ).then(() => {
        newQueue.initialize();
        setQueue(newQueue);
        setGroupsLoaded(true);
      });
    }
  }, [playlist, id, fetchGroup]);

  // Get current playback item
  const currentItem = useMemo(() => {
    if (!queue) return null;
    queue.setCurrentIndex(currentIndex);
    return queue.getCurrentItem();
  }, [queue, currentIndex]);

  const playbackItems = queue?.getPlaybackItems() || [];

  // Navigation handlers
  const handleNext = useCallback(() => {
    if (queue && queue.hasNext()) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [queue]);

  const handlePrevious = useCallback(() => {
    if (queue && queue.hasPrevious()) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [queue]);

  const handleRandom = useCallback(() => {
    if (playbackItems.length > 0) {
      const randomIndex = Math.floor(Math.random() * playbackItems.length);
      setCurrentIndex(randomIndex);
    }
  }, [playbackItems.length]);

  // Load media when current item changes
  useEffect(() => {
    if (!currentItem) return;

    setMediaLoading(true);
    setCurrentScene(null);
    setCurrentImage(null);

    if (currentItem.type === "scene") {
      fetchScene({ variables: { id: currentItem.id } }).then((result) => {
        if (result.data?.findScene) {
          setCurrentScene(result.data.findScene);
        }
        setMediaLoading(false);
      });
    } else if (currentItem.type === "image") {
      fetchImage({ variables: { id: currentItem.id } }).then((result) => {
        if (result.data?.findImage) {
          setCurrentImage(result.data.findImage);
        }
        setMediaLoading(false);
      });
    } else if (currentItem.type === "gallery") {
      // For galleries, open lightbox directly
      fetchGalleryImages({
        variables: {
          filter: { per_page: 100, sort: "path" },
          image_filter: {
            galleries: {
              modifier: GQL.CriterionModifier.Includes,
              value: [currentItem.id],
            },
          },
        },
      }).then((result) => {
        const images = result.data?.findImages?.images || [];
        if (images.length > 0) {
          setLightboxState({
            images: images.map((img) => ({
              id: img.id,
              paths: {
                image: img.paths?.image,
                thumbnail: img.paths?.thumbnail,
                preview: img.paths?.preview,
              },
              title: img.title,
              rating100: img.rating100,
              o_counter: img.o_counter,
            })),
            isVisible: true,
            isLoading: false,
            showNavigation: true,
            showFilmstrip: false,
            initialIndex: 0,
            slideshowEnabled: true,
            onClose: () => handleNext(),
          });
        } else {
          handleNext();
        }
        setMediaLoading(false);
      });
    }
  }, [
    currentItem,
    fetchScene,
    fetchImage,
    fetchGalleryImages,
    setLightboxState,
    handleNext,
  ]);

  const handleQueueItemClick = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

  const showLightboxForImage = useCallback(() => {
    if (!currentImage) return;

    const images = playbackItems
      .filter((item) => item.type === "image")
      .map((item) => ({
        id: item.id,
        paths: {
          image: `/image/${item.id}/image`,
          thumbnail: item.thumbnailPath,
        },
        title: item.title,
      }));

    const imageIndex = images.findIndex((img) => img.id === currentImage.id);

    setLightboxState({
      images,
      isVisible: true,
      isLoading: false,
      showNavigation: true,
      showFilmstrip: false,
      initialIndex: imageIndex >= 0 ? imageIndex : 0,
      slideshowEnabled: true,
    });
  }, [currentImage, playbackItems, setLightboxState]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        handlePrevious();
      } else if (e.key === ",") {
        setCollapsed(!collapsed);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNext, handlePrevious, collapsed]);

  // Loading state
  if (loading || !groupsLoaded) {
    return (
      <Box className="playlist-player-loading">
        <LoadingIndicator />
        <p>
          <FormattedMessage
            id="loading_playlist"
            defaultMessage="Loading playlist..."
          />
        </p>
      </Box>
    );
  }

  if (error) {
    return <ErrorMessage error={error.message} />;
  }

  if (!playlist) {
    return (
      <ErrorMessage
        error={intl.formatMessage({
          id: "playlist_not_found",
          defaultMessage: "Playlist not found",
        })}
      />
    );
  }

  return (
    <>
      <Helmet>
        <title>
          {playlist.name} - {intl.formatMessage({ id: "playlists" })}
        </title>
      </Helmet>

      <Box className="playlist-player-layout">
        {/* Left Panel - Queue */}
        <Box className={cx("playlist-detail-panel", { collapsed })}>
          <QueuePanel
            playlist={playlist}
            items={playbackItems}
            currentIndex={currentIndex}
            onItemClick={handleQueueItemClick}
            continuePlaylist={continuePlaylist}
            setContinuePlaylist={setContinuePlaylist}
            onNext={handleNext}
            onPrevious={handlePrevious}
            onRandom={handleRandom}
            hasNext={queue?.hasNext() || false}
            hasPrevious={queue?.hasPrevious() || false}
          />
        </Box>

        {/* Toggle Divider */}
        <Box
          className="playlist-toggle-divider"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRightIcon fontSize="small" />
          ) : (
            <ChevronLeftIcon fontSize="small" />
          )}
        </Box>

        {/* Right Panel - Player */}
        <Box className="playlist-player-container">
          {mediaLoading ? (
            <Box className="playlist-player-loading-content">
              <LoadingIndicator />
            </Box>
          ) : currentItem?.type === "scene" && currentScene ? (
            <MediaPlayer
              scene={currentScene}
              autoplay={continuePlaylist}
              onComplete={handleNext}
              onNext={handleNext}
              onPrevious={handlePrevious}
              hasNext={queue?.hasNext() || false}
              hasPrevious={queue?.hasPrevious() || false}
            />
          ) : currentItem?.type === "image" && currentImage ? (
            <ImageViewer
              image={currentImage}
              onComplete={handleNext}
              onViewInLightbox={showLightboxForImage}
              autoAdvance={continuePlaylist}
            />
          ) : currentItem?.type === "gallery" ? (
            <Box className="playlist-player-loading-content">
              <LoadingIndicator />
              <p>
                <FormattedMessage
                  id="opening_gallery"
                  defaultMessage="Opening gallery..."
                />
              </p>
            </Box>
          ) : (
            <Box className="playlist-player-empty">
              <Icon icon={faPlayCircle} size="3x" />
              <h3>
                <FormattedMessage
                  id="playlist_complete"
                  defaultMessage="Playlist Complete"
                />
              </h3>
              <p>
                <FormattedMessage
                  id="playlist_complete_desc"
                  defaultMessage="You've reached the end of this playlist."
                />
              </p>
              <IconButton onClick={() => setCurrentIndex(0)}>
                <FormattedMessage id="restart" defaultMessage="Restart" />
              </IconButton>
            </Box>
          )}
        </Box>
      </Box>
    </>
  );
};

export default PlaylistPlayer;
