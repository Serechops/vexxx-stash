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
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Switch,
  FormControlLabel,
  TextField,
  Tooltip,
} from "@mui/material";
import {
  faPlay,
  faExpand,
  faPlayCircle,
  faImage,
  faImages,
  faFilm,
  faRandom,
  faStepBackward,
  faStepForward,
  faEdit,
  faTrash,
  faPlus,
  faSave,
  faTimes,
  faArrowUp,
  faArrowDown,
  faCog,
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
import { useFindPlaylist, usePlaylistUpdate, usePlaylistDestroy, usePlaylistReorderItems, usePlaylistRemoveItems } from "src/core/StashService";
import { PlaylistAddItemsModal } from "./PlaylistAddItemsModal";
import { useToast } from "src/hooks/Toast";
import * as GQL from "src/core/generated-graphql";
import { PlaylistQueue, PlaybackItem } from "src/models/playlistQueue";
import TextUtils from "src/utils/text";
import { ScenePlayer } from "src/components/ScenePlayer/ScenePlayer";

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

// ============================================
// Media Player Component
// ============================================

const MediaPlayer: React.FC<IMediaPlayerProps> = ({
  scene,
  autoplay,
  onComplete,
  onNext,
  onPrevious,
}) => {
  const sendSetTimestamp = useCallback((_fn: (value: number) => void) => {}, []);

  return (
    <ScenePlayer
      scene={scene}
      autoplay={autoplay}
      permitLoop={false}
      hideScrubberOverride={false}
      initialTimestamp={0}
      sendSetTimestamp={sendSetTimestamp}
      onComplete={onComplete}
      onNext={onNext}
      onPrevious={onPrevious}
    />
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
    <Box
      sx={{
        alignItems: 'center',
        cursor: 'pointer',
        display: 'flex',
        height: '100%',
        justifyContent: 'center',
        position: 'relative',
        width: '100%',
      }}
      onClick={onViewInLightbox}
    >
      <Box
        component="img"
        src={image.paths?.image || ""}
        alt={image.title || ""}
        sx={{
          height: '100%',
          maxHeight: '100%',
          maxWidth: '100%',
          objectFit: 'contain',
          width: 'auto',
        }}
      />
      {autoAdvance && (
        <Box
          sx={{
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            borderRadius: '20px',
            bottom: 20,
            color: '#fff',
            fontSize: '0.875rem',
            left: '50%',
            p: '0.5rem 1rem',
            position: 'absolute',
            transform: 'translateX(-50%)',
          }}
        >
          <FormattedMessage id="next_in" defaultMessage="Next in" /> {countdown}s
        </Box>
      )}
      <Box
        sx={{
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          borderRadius: '4px',
          color: 'rgba(255, 255, 255, 0.7)',
          fontSize: '0.75rem',
          p: '0.25rem 0.5rem',
          position: 'absolute',
          right: 10,
          top: 10,
        }}
      >
        <Icon icon={faExpand} />{" "}
        <FormattedMessage id="click_to_expand" defaultMessage="Click to expand" />
      </Box>
    </Box>
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
  // Management
  onRemoveItem: (playlistItemId: string) => void;
  onMoveItem: (fromIndex: number, toIndex: number) => void;
  onAddItems: () => void;
  onSaveEdit: (name: string, description: string) => Promise<void>;
  onDeletePlaylist: () => void;
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
  onRemoveItem,
  onMoveItem,
  onAddItems,
  onSaveEdit,
  onDeletePlaylist,
}) => {
  const selectedRef = useRef<HTMLDivElement>(null);
  const intl = useIntl();
  const [isManaging, setIsManaging] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(playlist.name);
  const [editDesc, setEditDesc] = useState(playlist.description || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [currentIndex]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: '1rem' }}>
      {/* Header */}
      <Box
        sx={{
          borderBottom: '1px solid #27272a',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          mb: '1rem',
          pb: '1rem',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
          {editOpen ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
              <TextField
                size="small"
                id="playlist-edit-name"
                name="playlist-edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                label={intl.formatMessage({ id: "name", defaultMessage: "Name" })}
                fullWidth
              />
              <TextField
                size="small"
                id="playlist-edit-desc"
                name="playlist-edit-desc"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                label={intl.formatMessage({ id: "description", defaultMessage: "Description" })}
                fullWidth
                multiline
                rows={2}
              />
              <Box sx={{ display: 'flex', gap: '0.5rem' }}>
                <Button
                  size="small"
                  variant="contained"
                  disabled={saving || !editName.trim()}
                  onClick={async () => {
                    setSaving(true);
                    try { await onSaveEdit(editName, editDesc); setEditOpen(false); }
                    finally { setSaving(false); }
                  }}
                  startIcon={<Icon icon={faSave} />}
                >
                  <FormattedMessage id="actions.save" defaultMessage="Save" />
                </Button>
                <Button size="small" onClick={() => setEditOpen(false)} startIcon={<Icon icon={faTimes} />}>
                  <FormattedMessage id="actions.cancel" defaultMessage="Cancel" />
                </Button>
              </Box>
            </Box>
          ) : (
            <Box sx={{ fontSize: '1.25rem', fontWeight: 600, flex: 1, minWidth: 0 }}>
              <TruncatedText lineCount={2} text={playlist.name} />
            </Box>
          )}

          {!editOpen && (
            <Box sx={{ display: 'flex', gap: '0.25rem', flexShrink: 0, mt: '0.2rem' }}>
              {isManaging ? (
                <>
                  <Tooltip title={intl.formatMessage({ id: "actions.edit", defaultMessage: "Edit details" })}>
                    <IconButton
                      size="small"
                      onClick={() => { setEditName(playlist.name); setEditDesc(playlist.description || ""); setEditOpen(true); }}
                      sx={{ color: '#a1a1aa', '&:hover': { color: '#fafafa' } }}
                    >
                      <Icon icon={faEdit} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={intl.formatMessage({ id: "add_items", defaultMessage: "Add items" })}>
                    <IconButton size="small" onClick={onAddItems} sx={{ color: '#a1a1aa', '&:hover': { color: '#fafafa' } }}>
                      <Icon icon={faPlus} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={intl.formatMessage({ id: "actions.delete", defaultMessage: "Delete playlist" })}>
                    <IconButton size="small" onClick={onDeletePlaylist} sx={{ color: '#ef4444', '&:hover': { color: '#fca5a5' } }}>
                      <Icon icon={faTrash} />
                    </IconButton>
                  </Tooltip>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setIsManaging(false)}
                    sx={{ ml: 0.5, fontSize: '0.7rem', py: 0.25, minWidth: 0 }}
                  >
                    <FormattedMessage id="done" defaultMessage="Done" />
                  </Button>
                </>
              ) : (
                <Tooltip title={intl.formatMessage({ id: "manage_playlist", defaultMessage: "Manage playlist" })}>
                  <IconButton size="small" onClick={() => setIsManaging(true)} sx={{ color: '#a1a1aa', '&:hover': { color: '#fafafa' } }}>
                    <Icon icon={faCog} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )}
        </Box>

        <Box sx={{ color: '#a1a1aa', fontSize: '0.875rem' }}>
          {isManaging
            ? `${playlist.items?.length ?? 0} items`
            : `${currentIndex + 1} / ${items.length}`}
        </Box>
      </Box>

      {/* Playback Controls */}
      <Box
        sx={{
          alignItems: 'center',
          borderBottom: '1px solid #27272a',
          display: 'flex',
          gap: '1rem',
          justifyContent: 'space-between',
          mb: '1rem',
          pb: '1rem',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            gap: '0.25rem',
            '& .MuiIconButton-root': {
              color: '#fafafa',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: '#52525b',
              },
              '&:disabled': {
                color: '#a1a1aa',
                opacity: 0.5,
              },
            },
          }}
        >
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
          sx={{
            ml: 'auto',
            mr: 0,
            '& .MuiFormControlLabel-label': {
              color: '#a1a1aa',
              fontSize: '0.75rem',
            },
          }}
        />
      </Box>

      {/* Queue List */}
      <Box
        sx={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: '0.5rem',
          overflowY: 'auto',
        }}
      >
        {isManaging ? (
          /* ── Manage mode: original playlist items with reorder / remove ── */
          (playlist.items || []).map((item, index) => {
            const total = playlist.items?.length ?? 0;
            const icon =
              item.media_type === GQL.PlaylistMediaType.Image ? faImage
              : item.media_type === GQL.PlaylistMediaType.Gallery ? faImages
              : item.media_type === GQL.PlaylistMediaType.Group ? faFilm
              : faPlayCircle;
            return (
              <Box
                key={item.id}
                sx={{
                  alignItems: 'center',
                  borderRadius: '8px',
                  display: 'flex',
                  gap: '0.5rem',
                  p: '0.5rem',
                  '&:hover': { backgroundColor: 'rgba(255,255,255,0.05)' },
                }}
              >
                {/* Reorder arrows */}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', flexShrink: 0 }}>
                  <IconButton
                    size="small"
                    disabled={index === 0}
                    onClick={() => onMoveItem(index, index - 1)}
                    sx={{ p: '2px', color: '#a1a1aa', '&:disabled': { opacity: 0.3 } }}
                  >
                    <Icon icon={faArrowUp} style={{ fontSize: '0.6rem' }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    disabled={index === total - 1}
                    onClick={() => onMoveItem(index, index + 1)}
                    sx={{ p: '2px', color: '#a1a1aa', '&:disabled': { opacity: 0.3 } }}
                  >
                    <Icon icon={faArrowDown} style={{ fontSize: '0.6rem' }} />
                  </IconButton>
                </Box>
                {/* Thumbnail */}
                <Box
                  sx={{
                    borderRadius: '4px',
                    flexShrink: 0,
                    height: 40,
                    overflow: 'hidden',
                    width: 72,
                    '& img': { height: '100%', objectFit: 'cover', width: '100%' },
                  }}
                >
                  {item.thumbnail_path ? (
                    <img src={item.thumbnail_path} alt="" />
                  ) : (
                    <Box sx={{ alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', color: '#a1a1aa', display: 'flex', height: '100%', justifyContent: 'center', width: '100%' }}>
                      <Icon icon={icon} />
                    </Box>
                  )}
                </Box>
                {/* Title + duration */}
                <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                  <Box sx={{ color: '#fafafa', fontSize: '0.8rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </Box>
                  {item.effective_duration != null && item.effective_duration > 0 && (
                    <Box sx={{ color: '#a1a1aa', fontSize: '0.7rem' }}>
                      {TextUtils.secondsToTimestamp(item.effective_duration)}
                    </Box>
                  )}
                </Box>
                {/* Remove */}
                <IconButton
                  size="small"
                  onClick={() => onRemoveItem(item.id)}
                  sx={{ flexShrink: 0, color: '#a1a1aa', '&:hover': { color: '#ef4444' } }}
                >
                  <Icon icon={faTimes} style={{ fontSize: '0.75rem' }} />
                </IconButton>
              </Box>
            );
          })
        ) : (
          /* ── Playback mode: queue with quick-remove on hover ── */
          items.map((item, index) => {
            const isActive = index === currentIndex;
            const isPast = index < currentIndex;
            return (
              <Box
                key={`${item.type}-${item.id}-${index}`}
                ref={isActive ? selectedRef : null}
                sx={{
                  alignItems: 'center',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: '0.75rem',
                  p: '0.5rem',
                  transition: 'background-color 0.2s',
                  '& .remove-btn': { display: 'none' },
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    '& .remove-btn': { display: 'flex' },
                  },
                  ...(isActive && {
                    backgroundColor: 'rgba(82, 82, 91, 0.15)',
                    border: '1px solid rgba(82, 82, 91, 0.3)',
                  }),
                  ...(isPast && { opacity: 0.6 }),
                }}
                onClick={() => onItemClick(index)}
              >
                <Box
                  sx={{
                    color: '#a1a1aa',
                    flexShrink: 0,
                    fontSize: '0.75rem',
                    textAlign: 'center',
                    width: 24,
                  }}
                >
                  {index + 1}
                </Box>
                <Box
                  sx={{
                    borderRadius: '6px',
                    flexShrink: 0,
                    height: 50,
                    overflow: 'hidden',
                    position: 'relative',
                    width: 90,
                    '& img': {
                      height: '100%',
                      objectFit: 'cover',
                      width: '100%',
                    },
                  }}
                >
                  {item.thumbnailPath ? (
                    <img src={item.thumbnailPath} alt="" />
                  ) : (
                    <Box
                      sx={{
                        alignItems: 'center',
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                        color: '#a1a1aa',
                        display: 'flex',
                        height: '100%',
                        justifyContent: 'center',
                        width: '100%',
                      }}
                    >
                      <Icon icon={getMediaIcon(item.type)} />
                    </Box>
                  )}
                  {isActive && (
                    <Box
                      sx={{
                        alignItems: 'center',
                        backgroundColor: 'rgba(82, 82, 91, 0.8)',
                        borderRadius: '50%',
                        bottom: 4,
                        color: '#fff',
                        display: 'flex',
                        fontSize: '0.6rem',
                        height: 20,
                        justifyContent: 'center',
                        left: 4,
                        position: 'absolute',
                        width: 20,
                      }}
                    >
                      <Icon icon={faPlay} />
                    </Box>
                  )}
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    minWidth: 0,
                    overflow: 'hidden',
                    flex: 1,
                  }}
                >
                  <Box
                    sx={{
                      color: '#fafafa',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      lineHeight: 1.3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.title || `Untitled ${item.type}`}
                  </Box>
                  <Box
                    sx={{
                      alignItems: 'center',
                      color: '#a1a1aa',
                      display: 'flex',
                      fontSize: '0.75rem',
                      gap: '0.5rem',
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                        borderRadius: '4px',
                        fontSize: '0.625rem',
                        p: '2px 6px',
                        textTransform: 'uppercase',
                      }}
                    >
                      {item.type}
                    </Box>
                    {item.duration && item.duration > 0 && (
                      <Box component="span" sx={{ color: '#a1a1aa' }}>
                        {TextUtils.secondsToTimestamp(item.duration)}
                      </Box>
                    )}
                    {item.groupId && (
                      <Box
                        component="span"
                        sx={{
                          alignItems: 'center',
                          color: '#52525b',
                          display: 'flex',
                          fontSize: '0.625rem',
                          gap: '0.25rem',
                        }}
                      >
                        <Icon icon={faFilm} /> Group
                      </Box>
                    )}
                  </Box>
                </Box>
                {/* Quick-remove on hover */}
                <IconButton
                  className="remove-btn"
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onRemoveItem(item.originalItemId); }}
                  sx={{ flexShrink: 0, color: '#a1a1aa', '&:hover': { color: '#ef4444' } }}
                >
                  <Icon icon={faTimes} style={{ fontSize: '0.75rem' }} />
                </IconButton>
              </Box>
            );
          })
        )}
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
  const { data: playlistData, loading, error, refetch } = useFindPlaylist({ id });
  const playlist = playlistData?.findPlaylist;

  // Management mutations
  const [updatePlaylist] = usePlaylistUpdate();
  const [destroyPlaylist] = usePlaylistDestroy();
  const [reorderItems] = usePlaylistReorderItems();
  const [removeItems] = usePlaylistRemoveItems();
  const Toast = useToast();

  // Management state
  const [addItemsOpen, setAddItemsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
  // Use a ref so these callbacks stay stable even when the queue object
  // is replaced (e.g. after a refetch). A stable handleNext reference means
  // the media-loading effect below won't re-fire just because the queue
  // was rebuilt, which previously caused ScenePlayer to unmount/remount.
  const queueRef = useRef<PlaylistQueue | null>(null);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  const handleNext = useCallback(() => {
    if (queueRef.current && queueRef.current.hasNext()) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, []);

  const handlePrevious = useCallback(() => {
    if (queueRef.current && queueRef.current.hasPrevious()) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, []);

  const handleRandom = useCallback(() => {
    const items = queueRef.current?.getPlaybackItems() ?? [];
    if (items.length > 0) {
      setCurrentIndex(Math.floor(Math.random() * items.length));
    }
  }, []);

  // ── Management handlers ──
  const handleRemoveItem = useCallback(async (playlistItemId: string) => {
    if (!playlist) return;
    try {
      await removeItems({ variables: { input: { playlist_id: playlist.id, item_ids: [playlistItemId] } } });
      Toast.success(intl.formatMessage({ id: "toast.item_removed", defaultMessage: "Item removed from playlist" }));
      refetch();
    } catch (err) { Toast.error(err); }
  }, [playlist, removeItems, refetch, Toast, intl]);

  const handleMoveItem = useCallback(async (fromIndex: number, toIndex: number) => {
    if (!playlist?.items || fromIndex === toIndex) return;
    if (toIndex < 0 || toIndex >= playlist.items.length) return;
    const reordered = [...playlist.items];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    try {
      await reorderItems({ variables: { input: { playlist_id: playlist.id, item_ids: reordered.map((i) => i.id) } } });
      refetch();
    } catch (err) { Toast.error(err); }
  }, [playlist, reorderItems, refetch, Toast]);

  const handleSaveEdit = useCallback(async (name: string, description: string) => {
    if (!playlist) return;
    try {
      await updatePlaylist({ variables: { input: { id: playlist.id, name: name.trim(), description: description.trim() || undefined } } });
      Toast.success(intl.formatMessage({ id: "toast.playlist_updated", defaultMessage: "Playlist updated" }));
      refetch();
    } catch (err) { Toast.error(err); throw err; }
  }, [playlist, updatePlaylist, refetch, Toast, intl]);

  const handleDeletePlaylist = useCallback(async () => {
    if (!playlist) return;
    try {
      await destroyPlaylist({
        variables: { id: playlist.id },
        update: (cache) => { cache.evict({ id: cache.identify({ __typename: "Playlist", id: playlist.id }) }); },
      });
      Toast.success(intl.formatMessage({ id: "toast.playlist_deleted", defaultMessage: "Playlist deleted" }));
      history.push("/playlists");
    } catch (err) { Toast.error(err); }
  }, [playlist, destroyPlaylist, history, Toast, intl]);

  // Load media when the current item changes.
  // We intentionally do NOT clear the active media before the fetch
  // completes: keeping the old scene/image alive prevents ScenePlayer from
  // unmounting and remounting (which triggers VideoJS teardown and Cast SDK
  // re-registration errors).  We only null out the previous media type when
  // the new data for a *different* type arrives.
  useEffect(() => {
    if (!currentItem) return;

    setMediaLoading(true);

    if (currentItem.type === "scene") {
      fetchScene({ variables: { id: currentItem.id } }).then((result) => {
        if (result.data?.findScene) {
          setCurrentImage(null);
          setCurrentScene(result.data.findScene);
        }
        setMediaLoading(false);
      });
    } else if (currentItem.type === "image") {
      fetchImage({ variables: { id: currentItem.id } }).then((result) => {
        if (result.data?.findImage) {
          setCurrentScene(null);
          setCurrentImage(result.data.findImage);
        }
        setMediaLoading(false);
      });
    } else if (currentItem.type === "gallery") {
      setCurrentScene(null);
      setCurrentImage(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // fetchScene, fetchImage, fetchGalleryImages: Apollo lazy-query execute
    // functions are guaranteed stable across renders.  Including them caused
    // the effect to re-run every time the Apollo cache was written (e.g. after
    // sceneIncrementPlayCount), which unmounted/remounted the player in a loop.
    // setLightboxState: stabilised with useCallback inside LightboxProvider.
    // handleNext: stabilised via queueRef (empty useCallback deps).
  ]);  // eslint-disable-line react-hooks/exhaustive-deps

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
      <Box
        sx={{
          alignItems: 'center',
          backgroundColor: '#18181b',
          color: '#fafafa',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
          height: 'calc(100vh - 64px)',
          justifyContent: 'center',
          width: '100%',
          '& p': {
            color: '#a1a1aa',
            fontSize: '0.875rem',
          },
        }}
      >
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

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column-reverse',
          height: 'auto',
          overflow: 'visible',
          '@media (min-width: 768px)': {
            flexDirection: 'row',
            height: 'calc(100vh - 64px)',
            overflow: 'hidden',
          },
        }}
      >
        {/* Left Panel - Queue */}
        <Box
          sx={{
            backgroundColor: '#18181b',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            overflowY: 'visible',
            transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            width: '100%',
            '@media (min-width: 768px)': {
              borderRight: '1px solid #27272a',
              height: '100%',
              minWidth: collapsed ? 0 : 400,
              overflowY: 'auto',
              width: collapsed ? 0 : 400,
              ...(collapsed && { display: 'none' }),
            },
          }}
        >
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
            onRemoveItem={handleRemoveItem}
            onMoveItem={handleMoveItem}
            onAddItems={() => setAddItemsOpen(true)}
            onSaveEdit={handleSaveEdit}
            onDeletePlaylist={() => setDeleteOpen(true)}
          />
        </Box>

        {/* Toggle Divider */}
        <Box
          sx={{
            alignItems: 'center',
            borderRight: '1px solid #27272a',
            cursor: 'pointer',
            display: 'none',
            justifyContent: 'center',
            transition: 'background-color 0.2s',
            width: 12,
            '@media (min-width: 768px)': {
              display: 'flex',
            },
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              '& svg': {
                color: '#52525b',
              },
            },
            '& svg': {
              transition: 'color 0.2s',
            },
          }}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRightIcon fontSize="small" />
          ) : (
            <ChevronLeftIcon fontSize="small" />
          )}
        </Box>

        {/* Right Panel - Player */}
        <Box
          sx={{
            backgroundColor: 'black',
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            minWidth: 0,
            position: 'relative',
            '@media (max-width: 767.98px)': {
              aspectRatio: '16/9',
              height: 'auto',
            },
            '@media (min-width: 768px)': {
              height: '100%',
            },
          }}
        >
          {currentItem?.type === "scene" && currentScene ? (
            // Render the player whenever scene data is available.
            // Do NOT gate on mediaLoading here — hiding the player on refetch
            // disposes VideoJS, which re-fires the "playing" event on the next
            // mount and causes an infinite sceneIncrementPlayCount → cache
            // update → effect re-run → unmount loop.
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
            <Box
              sx={{
                alignItems: 'center',
                color: '#a1a1aa',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                height: '100%',
                justifyContent: 'center',
                width: '100%',
                '& p': { fontSize: '0.875rem' },
              }}
            >
              <LoadingIndicator />
              <p>
                <FormattedMessage
                  id="opening_gallery"
                  defaultMessage="Opening gallery..."
                />
              </p>
            </Box>
          ) : mediaLoading ? (
            // Only show a loading spinner when there is no media to display
            // yet (first load, or switching from scene→image type).
            <Box
              sx={{
                alignItems: 'center',
                color: '#a1a1aa',
                display: 'flex',
                height: '100%',
                justifyContent: 'center',
                width: '100%',
              }}
            >
              <LoadingIndicator />
            </Box>
          ) : (
            <Box
              sx={{
                alignItems: 'center',
                color: '#fff',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                height: '100%',
                justifyContent: 'center',
                textAlign: 'center',
                width: '100%',
                '& h3': { m: 0 },
                '& p': { color: '#a1a1aa', m: 0 },
              }}
            >
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

      {/* Add Items Modal */}
      {playlist && (
        <PlaylistAddItemsModal
          playlistId={playlist.id}
          open={addItemsOpen}
          onClose={() => setAddItemsOpen(false)}
          onItemsAdded={() => { setAddItemsOpen(false); refetch(); }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          <FormattedMessage id="dialogs.delete_playlist_title" defaultMessage="Delete Playlist" />
        </DialogTitle>
        <DialogContent>
          <FormattedMessage
            id="dialogs.delete_playlist_confirm"
            defaultMessage='Are you sure you want to delete "{name}"? This cannot be undone.'
            values={{ name: playlist?.name ?? "" }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>
            <FormattedMessage id="actions.cancel" defaultMessage="Cancel" />
          </Button>
          <Button color="error" variant="contained" onClick={() => { setDeleteOpen(false); handleDeletePlaylist(); }}>
            <FormattedMessage id="actions.delete" defaultMessage="Delete" />
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default PlaylistPlayer;
