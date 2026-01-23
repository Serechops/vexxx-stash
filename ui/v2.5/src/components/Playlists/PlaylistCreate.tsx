import React, { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useHistory } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  TextField,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  CircularProgress,
} from "@mui/material";
import { faSave, faTimes, faChevronDown, faPlus } from "@fortawesome/free-solid-svg-icons";
import { Icon } from "../Shared/Icon";
import { usePlaylistCreate, usePlaylistAddItems } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import { MediaItemSelector, ISelectedMediaItem } from "./MediaItemSelector";

export const PlaylistCreate: React.FC = () => {
  const intl = useIntl();
  const history = useHistory();
  const Toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedItems, setSelectedItems] = useState<ISelectedMediaItem[]>([]);
  const [itemsExpanded, setItemsExpanded] = useState(false);

  const [createPlaylist, { loading: creating }] = usePlaylistCreate();
  const [addItems] = usePlaylistAddItems();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      Toast.error(
        intl.formatMessage({
          id: "validation.name_required",
          defaultMessage: "Name is required",
        })
      );
      return;
    }

    try {
      // First create the playlist
      const result = await createPlaylist({
        variables: {
          input: {
            name: name.trim(),
            description: description.trim() || undefined,
          },
        },
      });

      if (result.data?.playlistCreate) {
        const playlistId = result.data.playlistCreate.id;
        
        // If items are selected, add them to the playlist
        if (selectedItems.length > 0) {
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
                id: "toast.playlist_created_with_items",
                defaultMessage: "Playlist created with {count} items",
              },
              { count: selectedItems.length }
            )
          );
        } else {
          Toast.success(
            intl.formatMessage({
              id: "toast.playlist_created",
              defaultMessage: "Playlist created successfully",
            })
          );
        }
        
        history.push(`/playlists/${playlistId}`);
      }
    } catch (err) {
      Toast.error(err);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        <FormattedMessage
          id="create_playlist"
          defaultMessage="Create Playlist"
        />
      </Typography>

      <form onSubmit={handleSubmit}>
        {/* Basic Info Card */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>
              <FormattedMessage
                id="playlist_details"
                defaultMessage="Playlist Details"
              />
            </Typography>
            <TextField
              fullWidth
              label={intl.formatMessage({
                id: "name",
                defaultMessage: "Name",
              })}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              sx={{ mb: 2 }}
              autoFocus
            />
            <TextField
              fullWidth
              label={intl.formatMessage({
                id: "description",
                defaultMessage: "Description",
              })}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              rows={3}
            />
          </CardContent>
        </Card>

        {/* Add Items Section */}
        <Accordion 
          expanded={itemsExpanded} 
          onChange={(_, expanded) => setItemsExpanded(expanded)}
          sx={{ mb: 3 }}
        >
          <AccordionSummary
            expandIcon={<Icon icon={faChevronDown} />}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Icon icon={faPlus} />
              <Typography variant="h6">
                <FormattedMessage
                  id="add_initial_items"
                  defaultMessage="Add Initial Items"
                />
              </Typography>
              {selectedItems.length > 0 && (
                <Chip 
                  label={selectedItems.length} 
                  size="small" 
                  color="primary"
                />
              )}
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              <FormattedMessage
                id="add_initial_items_description"
                defaultMessage="Optionally select media items to add to your playlist. You can also add items later."
              />
            </Typography>
            <MediaItemSelector
              selectedItems={selectedItems}
              onSelectionChange={setSelectedItems}
              showSelectedSummary={true}
              minHeight={300}
            />
          </AccordionDetails>
        </Accordion>

        {/* Actions */}
        <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
          <Button
            variant="outlined"
            onClick={() => history.push("/playlists")}
            startIcon={<Icon icon={faTimes} />}
            disabled={creating}
          >
            <FormattedMessage id="actions.cancel" defaultMessage="Cancel" />
          </Button>
          <Button
            type="submit"
            variant="contained"
            startIcon={creating ? <CircularProgress size={16} /> : <Icon icon={faSave} />}
            disabled={creating}
            className="bg-gradient-to-r from-pink-600 to-purple-600"
          >
            {selectedItems.length > 0 ? (
              <FormattedMessage 
                id="actions.create_with_items" 
                defaultMessage="Create with {count} Items"
                values={{ count: selectedItems.length }}
              />
            ) : (
              <FormattedMessage id="actions.create" defaultMessage="Create" />
            )}
          </Button>
        </Box>
      </form>
    </Box>
  );
};
