import React, { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  CircularProgress,
} from "@mui/material";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import { Icon } from "../Shared/Icon";
import { usePlaylistAddItems } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import { MediaItemSelector, ISelectedMediaItem } from "./MediaItemSelector";

interface IPlaylistAddItemsModalProps {
  playlistId: string;
  open: boolean;
  onClose: () => void;
  onItemsAdded: () => void;
}

export const PlaylistAddItemsModal: React.FC<IPlaylistAddItemsModalProps> = ({
  playlistId,
  open,
  onClose,
  onItemsAdded,
}) => {
  const intl = useIntl();
  const Toast = useToast();

  const [selectedItems, setSelectedItems] = useState<ISelectedMediaItem[]>([]);
  const [adding, setAdding] = useState(false);

  const [addItems] = usePlaylistAddItems();

  const handleAddItems = async () => {
    if (selectedItems.length === 0) return;

    setAdding(true);
    try {
      await addItems({
        variables: {
          input: {
            playlist_id: playlistId,
            items: selectedItems.map((item) => ({
              media_id: item.id,
              media_type: item.mediaType,
            })),
          },
        },
      });

      Toast.success(
        intl.formatMessage(
          {
            id: "toast.items_added_to_playlist",
            defaultMessage: "{count} items added to playlist",
          },
          { count: selectedItems.length }
        )
      );
      setSelectedItems([]);
      onItemsAdded();
      onClose();
    } catch (err) {
      Toast.error(err);
    } finally {
      setAdding(false);
    }
  };

  const handleClose = () => {
    setSelectedItems([]);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: { minHeight: "70vh" },
      }}
    >
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <FormattedMessage
          id="add_items_to_playlist"
          defaultMessage="Add Items to Playlist"
        />
        <IconButton onClick={handleClose} size="small">
          <Icon icon={faTimes} />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <MediaItemSelector
          selectedItems={selectedItems}
          onSelectionChange={setSelectedItems}
          showSelectedSummary={true}
          minHeight={400}
        />
      </DialogContent>

      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={handleClose} disabled={adding}>
          <FormattedMessage id="actions.cancel" defaultMessage="Cancel" />
        </Button>
        <Button
          variant="contained"
          onClick={handleAddItems}
          disabled={selectedItems.length === 0 || adding}
          startIcon={adding ? <CircularProgress size={16} /> : undefined}
        >
          <FormattedMessage
            id="add_selected_items"
            defaultMessage="Add {count} Items"
            values={{ count: selectedItems.length }}
          />
        </Button>
      </DialogActions>
    </Dialog>
  );
};
