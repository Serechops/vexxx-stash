import React, { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useParams, useHistory, useLocation } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  List,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Typography,
  TextField,
  Avatar,
  Chip,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import {
  faPlay,
  faEdit,
  faSave,
  faTimes,
  faTrash,
  faClock,
  faFilm,
  faImage,
  faImages,
  faPlayCircle,
  faArrowLeft,
  faArrowUp,
  faArrowDown,
  faPlus,
} from "@fortawesome/free-solid-svg-icons";
import { Icon } from "../Shared/Icon";
import { PlaylistAddItemsModal } from "./PlaylistAddItemsModal";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { ErrorMessage } from "../Shared/ErrorMessage";
import {
  useFindPlaylist,
  usePlaylistUpdate,
  usePlaylistDestroy,
  usePlaylistReorderItems,
  usePlaylistRemoveItems,
} from "src/core/StashService";
import * as GQL from "src/core/generated-graphql";
import TextUtils from "src/utils/text";
import { useToast } from "src/hooks/Toast";

const getMediaIcon = (mediaType: GQL.PlaylistMediaType) => {
  switch (mediaType) {
    case GQL.PlaylistMediaType.Scene:
      return faPlayCircle;
    case GQL.PlaylistMediaType.Image:
      return faImage;
    case GQL.PlaylistMediaType.Gallery:
      return faImages;
    case GQL.PlaylistMediaType.Group:
      return faFilm;
    default:
      return faPlayCircle;
  }
};

interface IPlaylistItemRowProps {
  item: GQL.PlaylistItemDataFragment;
  index: number;
  total: number;
  onRemove: (itemId: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onPlay: (index: number) => void;
}

const PlaylistItemRow: React.FC<IPlaylistItemRowProps> = ({
  item,
  index,
  total,
  onRemove,
  onMoveUp,
  onMoveDown,
  onPlay,
}) => {
  return (
    <ListItemButton
      onClick={() => onPlay(index)}
      sx={{
        borderRadius: 1,
        mb: 0.5,
      }}
    >
      <Box sx={{ mr: 2, display: "flex", flexDirection: "column", gap: 0.5 }}>
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); onMoveUp(index); }}
          disabled={index === 0}
        >
          <Icon icon={faArrowUp} />
        </IconButton>
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); onMoveDown(index); }}
          disabled={index === total - 1}
        >
          <Icon icon={faArrowDown} />
        </IconButton>
      </Box>
      <ListItemAvatar>
        <Avatar
          variant="rounded"
          src={item.thumbnail_path || undefined}
          sx={{ width: 80, height: 45 }}
        >
          <Icon icon={getMediaIcon(item.media_type)} />
        </Avatar>
      </ListItemAvatar>
      <ListItemText
        primary={item.title}
        secondary={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Chip
              size="small"
              label={item.media_type.toLowerCase()}
              sx={{ textTransform: "capitalize" }}
            />
            {item.effective_duration && item.effective_duration > 0 && (
              <Typography variant="caption" color="text.secondary">
                <Icon icon={faClock} className="mr-1" />
                {TextUtils.secondsToTimestamp(item.effective_duration)}
              </Typography>
            )}
          </Box>
        }
        sx={{ ml: 2 }}
      />
      <Box sx={{ ml: 1 }}>
        <IconButton
          onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
          color="error"
        >
          <Icon icon={faTrash} />
        </IconButton>
      </Box>
    </ListItemButton>
  );
};

export const PlaylistDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const history = useHistory();
  const location = useLocation();
  const intl = useIntl();
  const Toast = useToast();

  const isEditMode = new URLSearchParams(location.search).get("edit") === "true";
  const [editing, setEditing] = useState(isEditMode);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [addItemsModalOpen, setAddItemsModalOpen] = useState(false);

  const { data, loading, error, refetch } = useFindPlaylist({ id });
  const [updatePlaylist, { loading: updating }] = usePlaylistUpdate();
  const [destroyPlaylist, { loading: deleting }] = usePlaylistDestroy();
  const [reorderItems] = usePlaylistReorderItems();
  const [removeItems] = usePlaylistRemoveItems();

  const playlist = data?.findPlaylist;

  React.useEffect(() => {
    if (playlist) {
      setEditName(playlist.name);
      setEditDescription(playlist.description || "");
    }
  }, [playlist]);

  if (loading) return <LoadingIndicator />;
  if (error) return <ErrorMessage error={error.message} />;
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

  const handleSave = async () => {
    try {
      await updatePlaylist({
        variables: {
          input: {
            id: playlist.id,
            name: editName.trim(),
            description: editDescription.trim() || undefined,
          },
        },
      });
      Toast.success(
        intl.formatMessage({
          id: "toast.playlist_updated",
          defaultMessage: "Playlist updated",
        })
      );
      setEditing(false);
      refetch();
    } catch (err) {
      Toast.error(err);
    }
  };

  const handleDelete = async () => {
    try {
      await destroyPlaylist({ variables: { id: playlist.id } });
      Toast.success(
        intl.formatMessage({
          id: "toast.playlist_deleted",
          defaultMessage: "Playlist deleted",
        })
      );
      history.push("/playlists");
    } catch (err) {
      Toast.error(err);
    }
  };

  const handleMoveItem = async (fromIndex: number, toIndex: number) => {
    if (!playlist.items || fromIndex === toIndex) return;
    if (toIndex < 0 || toIndex >= playlist.items.length) return;

    const items = Array.from(playlist.items);
    const [movedItem] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, movedItem);

    try {
      await reorderItems({
        variables: {
          input: {
            playlist_id: playlist.id,
            item_ids: items.map((item) => item.id),
          },
        },
      });
      refetch();
    } catch (err) {
      Toast.error(err);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    try {
      await removeItems({
        variables: {
          input: {
            playlist_id: playlist.id,
            item_ids: [itemId],
          },
        },
      });
      Toast.success(
        intl.formatMessage({
          id: "toast.item_removed",
          defaultMessage: "Item removed from playlist",
        })
      );
      refetch();
    } catch (err) {
      Toast.error(err);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Button
          startIcon={<Icon icon={faArrowLeft} />}
          onClick={() => history.push("/playlists")}
        >
          <FormattedMessage id="back_to_playlists" defaultMessage="Back to Playlists" />
        </Button>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          {editing ? (
            <Box>
              <TextField
                fullWidth
                label={intl.formatMessage({ id: "name", defaultMessage: "Name" })}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                sx={{ mb: 2 }}
                autoFocus
              />
              <TextField
                fullWidth
                label={intl.formatMessage({ id: "description", defaultMessage: "Description" })}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                multiline
                rows={2}
                sx={{ mb: 2 }}
              />
              <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
                <Button
                  variant="outlined"
                  startIcon={<Icon icon={faTimes} />}
                  onClick={() => {
                    setEditing(false);
                    setEditName(playlist.name);
                    setEditDescription(playlist.description || "");
                  }}
                  disabled={updating}
                >
                  <FormattedMessage id="actions.cancel" defaultMessage="Cancel" />
                </Button>
                <Button
                  variant="contained"
                  startIcon={<Icon icon={faSave} />}
                  onClick={handleSave}
                  disabled={updating}
                >
                  <FormattedMessage id="actions.save" defaultMessage="Save" />
                </Button>
              </Box>
            </Box>
          ) : (
            <Box>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <Box>
                  <Typography variant="h4" component="h1" gutterBottom>
                    {playlist.name}
                  </Typography>
                  {playlist.description && (
                    <Typography variant="body1" color="text.secondary" paragraph>
                      {playlist.description}
                    </Typography>
                  )}
                  <Box sx={{ display: "flex", gap: 2, color: "text.secondary" }}>
                    <Typography variant="body2">
                      {playlist.item_count} items
                    </Typography>
                    {playlist.duration > 0 && (
                      <Typography variant="body2">
                        <Icon icon={faClock} className="mr-1" />
                        {TextUtils.secondsToTimestamp(playlist.duration)}
                      </Typography>
                    )}
                  </Box>
                </Box>
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Button
                    variant="outlined"
                    startIcon={<Icon icon={faPlus} />}
                    onClick={() => setAddItemsModalOpen(true)}
                  >
                    <FormattedMessage id="actions.add" defaultMessage="Add" />
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<Icon icon={faPlay} />}
                    disabled={playlist.items.length === 0}
                    className="bg-gradient-to-r from-pink-600 to-purple-600"
                    onClick={() => history.push(`/playlists/${playlist.id}/play`)}
                  >
                    <FormattedMessage id="actions.play" defaultMessage="Play" />
                  </Button>
                  <IconButton onClick={() => setEditing(true)}>
                    <Icon icon={faEdit} />
                  </IconButton>
                  <IconButton
                    onClick={() => setDeleteDialogOpen(true)}
                    color="error"
                  >
                    <Icon icon={faTrash} />
                  </IconButton>
                </Box>
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>

      <Typography variant="h6" sx={{ mb: 2 }}>
        <FormattedMessage id="playlist_items" defaultMessage="Playlist Items" />
      </Typography>

      {playlist.items.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <Typography variant="body1" color="text.secondary">
              <FormattedMessage
                id="playlist_empty"
                defaultMessage="This playlist is empty. Add scenes, images, galleries, or groups to get started."
              />
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <List>
            {playlist.items.map((item, index) => (
              <React.Fragment key={item.id}>
                <PlaylistItemRow
                  item={item}
                  index={index}
                  total={playlist.items.length}
                  onRemove={handleRemoveItem}
                  onMoveUp={(i) => handleMoveItem(i, i - 1)}
                  onMoveDown={(i) => handleMoveItem(i, i + 1)}
                  onPlay={(i) => history.push(`/playlists/${playlist.id}/play?index=${i}`)}
                />
                {index < playlist.items.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </List>
        </Card>
      )}

      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>
          <FormattedMessage
            id="delete_playlist_confirm_title"
            defaultMessage="Delete Playlist"
          />
        </DialogTitle>
        <DialogContent>
          <Typography>
            <FormattedMessage
              id="delete_playlist_confirm"
              defaultMessage="Are you sure you want to delete '{name}'? This cannot be undone."
              values={{ name: playlist.name }}
            />
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            <FormattedMessage id="actions.cancel" defaultMessage="Cancel" />
          </Button>
          <Button onClick={handleDelete} color="error" disabled={deleting}>
            <FormattedMessage id="actions.delete" defaultMessage="Delete" />
          </Button>
        </DialogActions>
      </Dialog>

      <PlaylistAddItemsModal
        playlistId={playlist.id}
        open={addItemsModalOpen}
        onClose={() => setAddItemsModalOpen(false)}
        onItemsAdded={() => refetch()}
      />
    </Box>
  );
};
