import React, { useEffect, useMemo, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link, useHistory } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardMedia,
  IconButton,
  Tooltip,
  Typography,
  TextField,
  InputAdornment,
  Chip,
  Menu,
  MenuItem,
} from "@mui/material";
import {
  faPlus,
  faSearch,
  faEllipsisV,
  faTrash,
  faEdit,
  faClock,
  faLayerGroup,
  faTag,
} from "@fortawesome/free-solid-svg-icons";
import { Icon } from "../Shared/Icon";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { ErrorMessage } from "../Shared/ErrorMessage";
import { DeleteEntityDialog } from "../Shared/DeleteEntityDialog";
import { useFindPlaylists, usePlaylistDestroy } from "src/core/StashService";
import * as GQL from "src/core/generated-graphql";
import TextUtils from "src/utils/text";

interface IPlaylistCardProps {
  playlist: GQL.PlaylistCardDataFragment;
  onDelete?: (id: string) => void;
}

type SlimPerformer = { id: string; name: string; image_path?: string | null };
type SlimStudio = { id: string; name: string; image_path?: string | null };

/** Portrait cards for performers — all shown, horizontally scrollable */
const PerformerAvatarRow: React.FC<{ performers: SlimPerformer[] }> = ({ performers }) => {
  if (performers.length === 0) return null;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "flex-end",
        overflowX: "auto",
        flexShrink: 0,
        "&::-webkit-scrollbar": { height: 3 },
        "&::-webkit-scrollbar-thumb": { bgcolor: "action.disabled", borderRadius: 2 },
        "&::-webkit-scrollbar-track": { bgcolor: "transparent" },
        py: 0.5,
        gap: 0.75,
      }}
    >
      {performers.map((p) => (
        <Box
          key={p.id}
          component={Link}
          to={`/performers/${p.id}`}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 0.25,
            flexShrink: 0,
            textDecoration: "none",
            "&:hover .performer-portrait": { transform: "scale(1.06)", boxShadow: 4 },
          }}
        >
          <Box
            className="performer-portrait"
            sx={{
              width: 52,
              height: 70,
              borderRadius: 1,
              overflow: "hidden",
              bgcolor: "action.selected",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "transform 0.15s, box-shadow 0.15s",
              flexShrink: 0,
            }}
          >
            {p.image_path ? (
              <Box
                component="img"
                src={p.image_path}
                alt={p.name}
                sx={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
              />
            ) : (
              <Typography sx={{ fontSize: "1rem", fontWeight: 700, color: "text.secondary", userSelect: "none" }}>
                {p.name.charAt(0).toUpperCase()}
              </Typography>
            )}
          </Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              fontSize: "0.6rem",
              maxWidth: 52,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.2,
            }}
          >
            {p.name}
          </Typography>
        </Box>
      ))}
    </Box>
  );
};

/** Horizontal scrolling studio logo strip — all shown */
const StudioLogoRow: React.FC<{ studios: SlimStudio[] }> = ({ studios }) => {
  if (studios.length === 0) return null;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        overflowX: "auto",
        flexShrink: 0,
        "&::-webkit-scrollbar": { height: 3 },
        "&::-webkit-scrollbar-thumb": { bgcolor: "action.disabled", borderRadius: 2 },
        "&::-webkit-scrollbar-track": { bgcolor: "transparent" },
        py: 0.25,
      }}
    >
      {studios.map((s) => (
        <Tooltip key={s.id} title={s.name} placement="top" enterDelay={400}>
          <Box
            component={Link}
            to={`/studios/${s.id}`}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              height: 22,
              maxWidth: 80,
              textDecoration: "none",
              opacity: 0.85,
              "&:hover": { opacity: 1 },
              transition: "opacity 0.15s",
            }}
          >
            {s.image_path ? (
              <Box
                component="img"
                src={s.image_path}
                alt={s.name}
                sx={{ maxHeight: 22, maxWidth: 80, objectFit: "contain" }}
              />
            ) : (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 80 }}>
                {s.name}
              </Typography>
            )}
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
};

/** Compact horizontal tag chip row — all shown, scrollable */
const TagChipRow: React.FC<{ tags: { id: string; name: string }[] }> = ({ tags }) => {
  if (tags.length === 0) return null;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        overflowX: "auto",
        flexShrink: 0,
        "&::-webkit-scrollbar": { height: 3 },
        "&::-webkit-scrollbar-thumb": { bgcolor: "action.disabled", borderRadius: 2 },
        "&::-webkit-scrollbar-track": { bgcolor: "transparent" },
        py: 0.25,
        flexWrap: "nowrap",
      }}
    >
      {tags.map((t) => (
        <Chip
          key={t.id}
          component={Link}
          to={`/tags/${t.id}`}
          label={t.name}
          size="small"
          clickable
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          sx={{
            fontSize: "0.65rem",
            height: 18,
            "& .MuiChip-label": { px: 0.5 },
            flexShrink: 0,
          }}
        />
      ))}
    </Box>
  );
};

const PlaylistCard: React.FC<IPlaylistCardProps> = ({ playlist, onDelete }) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const history = useHistory();

  /** All scenes that have a preview URL, in playlist order */
  const previewScenes = useMemo(() => {
    return playlist.items
      .map((item) => item.scene)
      .filter((s): s is NonNullable<typeof s> => !!s?.paths?.preview);
  }, [playlist.items]);

  const currentPreviewScene = previewScenes[previewIndex] ?? null;
  const currentPreviewUrl = currentPreviewScene?.paths?.preview ?? null;

  /** Cover image: explicit cover, or first scene screenshot */
  const coverImage = useMemo(() => {
    if (playlist.cover_image_path) return playlist.cover_image_path;
    for (const item of playlist.items) {
      if (item.scene?.paths?.screenshot) return item.scene.paths.screenshot;
    }
    return null;
  }, [playlist.cover_image_path, playlist.items]);

  /** Play / pause on hover; reset index when leaving */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isHovered && currentPreviewUrl) {
      video.play().catch(() => {});
    } else {
      video.pause();
      video.currentTime = 0;
      setPreviewIndex(0);
    }
  }, [isHovered, currentPreviewUrl]);

  /** Advance to next scene when current preview ends */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleEnded = () => {
      setPreviewIndex((i) => (i + 1) % Math.max(previewScenes.length, 1));
    };
    video.addEventListener("ended", handleEnded);
    return () => video.removeEventListener("ended", handleEnded);
  }, [previewScenes.length]);

  /** Deduplicated aggregates across all items */
  const { performers, studios, tags } = useMemo(() => {
    const perfMap = new Map<string, SlimPerformer>();
    const studioMap = new Map<string, SlimStudio>();
    const tagMap = new Map<string, { id: string; name: string }>();

    for (const item of playlist.items) {
      const media = item.scene ?? item.image ?? item.gallery;
      if (!media) continue;
      for (const p of media.performers) perfMap.set(p.id, p);
      if (media.studio) studioMap.set(media.studio.id, media.studio);
      for (const t of media.tags) tagMap.set(t.id, t);
    }

    return {
      performers: [...perfMap.values()],
      studios: [...studioMap.values()],
      tags: [...tagMap.values()],
    };
  }, [playlist.items]);

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => setAnchorEl(null);

  const handleDelete = () => {
    handleMenuClose();
    if (onDelete) onDelete(playlist.id);
  };

  const handleEdit = () => {
    handleMenuClose();
    history.push(`/playlists/${playlist.id}?edit=true`);
  };

  return (
    <Card
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        transition: "transform 0.2s, box-shadow 0.2s",
        "&:hover": { transform: "translateY(-4px)", boxShadow: 8 },
        cursor: "pointer",
      }}
      component={Link}
      to={`/playlists/${playlist.id}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Thumbnail — 16:9 aspect ratio */}
      <CardMedia
        component="div"
        sx={{
          aspectRatio: "16/9",
          backgroundColor: "grey.800",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        {/* Cover / fallback */}
        {coverImage ? (
          <Box
            component="img"
            src={coverImage}
            alt={playlist.name}
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              position: "absolute",
              inset: 0,
              transition: "opacity 0.3s",
              opacity: isHovered && currentPreviewUrl ? 0 : 1,
            }}
          />
        ) : (
          !isHovered && <Icon icon={faLayerGroup} className="text-4xl text-gray-500" />
        )}

        {/* Hover preview video */}
        {currentPreviewUrl && (
          <Box
            component="video"
            ref={videoRef}
            src={currentPreviewUrl}
            muted
            playsInline
            preload="none"
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              position: "absolute",
              inset: 0,
              opacity: isHovered ? 1 : 0,
              transition: "opacity 0.3s",
            }}
          />
        )}

        {/* Scene info overlay — bottom third, fades in with preview */}
        {currentPreviewScene && (
          <Box
            sx={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "33%",
              background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 60%, transparent 100%)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              px: 1,
              pb: 0.75,
              zIndex: 2,
              opacity: isHovered ? 1 : 0,
              transition: "opacity 0.3s",
              pointerEvents: "none",
            }}
          >
            {/* Title */}
            <Typography
              sx={{
                color: "#fff",
                fontSize: "0.78rem",
                fontWeight: 600,
                lineHeight: 1.2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {currentPreviewScene.title || "Untitled"}
            </Typography>

            {/* Studio + performers row */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.3, overflow: "hidden" }}>
              {currentPreviewScene.studio && (
                <Typography sx={{ color: "rgba(255,255,255,0.35)", fontSize: "0.6rem", flexShrink: 0 }}>·</Typography>
              )}
              {currentPreviewScene.performers.length > 0 && (
                <Typography
                  sx={{
                    color: "rgba(255,255,255,0.6)",
                    fontSize: "0.65rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {currentPreviewScene.performers.map((p) => p.name).join(", ")}
                </Typography>
              )}
              {currentPreviewScene.date && (
                <Typography sx={{ color: "rgba(255,255,255,0.4)", fontSize: "0.6rem", flexShrink: 0, ml: "auto" }}>
                  {currentPreviewScene.date.substring(0, 4)}
                </Typography>
              )}
            </Box>
          </Box>
        )}

        {/* Overlay badges — shift to top-right when preview is playing */}
        <Box
          sx={{
            position: "absolute",
            top: isHovered && currentPreviewUrl ? 8 : "auto",
            bottom: isHovered && currentPreviewUrl ? "auto" : 8,
            right: 8,
            display: "flex",
            gap: 0.5,
            zIndex: 3,
            transition: "top 0.3s, bottom 0.3s",
          }}
        >
          {playlist.is_dynamic && (
            <Chip
              size="small"
              label="Dynamic"
              color="secondary"
              sx={{ fontSize: "0.7rem" }}
            />
          )}
          <Chip
            size="small"
            label={`${playlist.item_count} items`}
            sx={{ backgroundColor: "rgba(0,0,0,0.7)", fontSize: "0.7rem" }}
          />
          {playlist.duration > 0 && (
            <Chip
              size="small"
              icon={<Icon icon={faClock} className="text-xs" />}
              label={TextUtils.secondsToTimestamp(playlist.duration)}
              sx={{ backgroundColor: "rgba(0,0,0,0.7)", fontSize: "0.7rem" }}
            />
          )}
        </Box>
      </CardMedia>

      {/* Body */}
      <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 0.75, pb: "8px !important" }}>
        {/* Title row */}
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flexGrow: 1,
              lineHeight: 1.3,
            }}
          >
            {playlist.name}
          </Typography>
          <IconButton size="small" onClick={handleMenuClick} sx={{ ml: 0.5, mt: -0.25 }}>
            <Icon icon={faEllipsisV} />
          </IconButton>
        </Box>

        {/* Description */}
        {playlist.description && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              lineHeight: 1.4,
            }}
          >
            {playlist.description}
          </Typography>
        )}

        {/* Carousels */}
        {performers.length > 0 && (
          <PerformerAvatarRow performers={performers} />
        )}
        {studios.length > 0 && (
          <StudioLogoRow studios={studios} />
        )}
        {tags.length > 0 && (
          <TagChipRow tags={tags} />
        )}
      </CardContent>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        onClick={(e) => e.stopPropagation()}
        hideBackdrop
      >
        <MenuItem onClick={handleEdit}>
          <Icon icon={faEdit} className="mr-2" />
          <FormattedMessage id="actions.edit" defaultMessage="Edit" />
        </MenuItem>
        <MenuItem onClick={handleDelete} sx={{ color: "error.main" }}>
          <Icon icon={faTrash} className="mr-2" />
          <FormattedMessage id="actions.delete" defaultMessage="Delete" />
        </MenuItem>
      </Menu>
    </Card>
  );
};

export const PlaylistList: React.FC = () => {
  const intl = useIntl();
  const history = useHistory();
  const [searchQuery, setSearchQuery] = useState("");

  const { data, loading, error, refetch } = useFindPlaylists({
    filter: {
      per_page: 40,
      sort: "updated_at",
      direction: GQL.SortDirectionEnum.Desc,
    },
    playlist_filter: searchQuery
      ? { name: { value: searchQuery, modifier: GQL.CriterionModifier.Includes } }
      : undefined,
  });

  const [destroyPlaylist] = usePlaylistDestroy();
  const [deletingPlaylist, setDeletingPlaylist] = useState<GQL.PlaylistCardDataFragment | null>(null);

  const usePlaylistsDestroy = (input: { ids: string[] }) => {
    const deleteEntities = async () => {
      const promises = input.ids.map((id) =>
        destroyPlaylist({
          variables: { id },
          update: (cache) => {
            cache.evict({ id: cache.identify({ __typename: "Playlist", id }) });
          },
        })
      );
      return Promise.all(promises);
    };
    return [deleteEntities, {}] as any;
  };

  if (loading) return <LoadingIndicator />;
  if (error) return <ErrorMessage error={error.message} />;

  const playlists = data?.findPlaylists.playlists || [];

  const handleDeletePlaylist = (id: string) => {
    const playlistToDelete = playlists.find((p) => p.id === id);
    if (playlistToDelete) {
      setDeletingPlaylist(playlistToDelete);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Typography variant="h4" component="h1">
          <FormattedMessage id="playlists" defaultMessage="Playlists" />
        </Typography>
        <Button
          variant="contained"
          startIcon={<Icon icon={faPlus} />}
          onClick={() => history.push("/playlists/new")}
          className="bg-gradient-to-r from-pink-600 to-purple-600"
        >
          <FormattedMessage id="actions.create" defaultMessage="Create" />
        </Button>
      </Box>

      <Box sx={{ mb: 3 }}>
        <TextField
          fullWidth
          variant="outlined"
          placeholder={intl.formatMessage({
            id: "search_playlists",
            defaultMessage: "Search playlists...",
          })}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Icon icon={faSearch} />
              </InputAdornment>
            ),
          }}
          sx={{ maxWidth: 400 }}
        />
      </Box>

      {playlists.length === 0 ? (
        <Box
          sx={{
            textAlign: "center",
            py: 8,
            color: "text.secondary",
          }}
        >
          <Icon icon={faLayerGroup} className="text-6xl mb-4 opacity-50" />
          <Typography variant="h6" gutterBottom>
            <FormattedMessage
              id="no_playlists"
              defaultMessage="No playlists yet"
            />
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            <FormattedMessage
              id="create_first_playlist"
              defaultMessage="Create your first playlist to organize your content"
            />
          </Typography>
          <Button
            variant="outlined"
            startIcon={<Icon icon={faPlus} />}
            onClick={() => history.push("/playlists/new")}
          >
            <FormattedMessage
              id="create_playlist"
              defaultMessage="Create Playlist"
            />
          </Button>
        </Box>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: "1.5rem",
            padding: "0 0 1rem",
          }}
        >
          {playlists.map((playlist) => (
            <PlaylistCard
              key={playlist.id}
              playlist={playlist}
              onDelete={handleDeletePlaylist}
            />
          ))}
        </Box>
      )}

      {deletingPlaylist && (
        <DeleteEntityDialog
          selected={[{ id: deletingPlaylist.id, name: deletingPlaylist.name }]}
          onClose={() => setDeletingPlaylist(null)}
          singularEntity={intl.formatMessage({ id: "playlist", defaultMessage: "playlist" })}
          pluralEntity={intl.formatMessage({ id: "playlists", defaultMessage: "playlists" })}
          destroyMutation={usePlaylistsDestroy}
          onDeleted={() => {
            setDeletingPlaylist(null);
          }}
        />
      )}
    </Box>
  );
};
