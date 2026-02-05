import React, { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link, useHistory } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardMedia,
  Grid,
  IconButton,
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
} from "@fortawesome/free-solid-svg-icons";
import { Icon } from "../Shared/Icon";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { ErrorMessage } from "../Shared/ErrorMessage";
import { useFindPlaylists } from "src/core/StashService";
import * as GQL from "src/core/generated-graphql";
import TextUtils from "src/utils/text";

interface IPlaylistCardProps {
  playlist: GQL.SlimPlaylistDataFragment;
  onDelete?: (id: string) => void;
}

const PlaylistCard: React.FC<IPlaylistCardProps> = ({ playlist, onDelete }) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const history = useHistory();

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleDelete = () => {
    handleMenuClose();
    if (onDelete) {
      onDelete(playlist.id);
    }
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
        "&:hover": {
          transform: "translateY(-4px)",
          boxShadow: 6,
        },
        cursor: "pointer",
      }}
      component={Link}
      to={`/playlists/${playlist.id}`}
    >
      <CardMedia
        component="div"
        sx={{
          height: 160,
          backgroundColor: "grey.800",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {playlist.cover_image_path ? (
          <Box
            component="img"
            src={playlist.cover_image_path}
            alt={playlist.name}
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <Icon icon={faLayerGroup} className="text-4xl text-gray-500" />
        )}
        <Box
          sx={{
            position: "absolute",
            bottom: 8,
            right: 8,
            display: "flex",
            gap: 0.5,
          }}
        >
          <Chip
            size="small"
            label={`${playlist.item_count} items`}
            sx={{ backgroundColor: "rgba(0,0,0,0.7)" }}
          />
          {playlist.duration > 0 && (
            <Chip
              size="small"
              icon={<Icon icon={faClock} className="text-xs" />}
              label={TextUtils.secondsToTimestamp(playlist.duration)}
              sx={{ backgroundColor: "rgba(0,0,0,0.7)" }}
            />
          )}
        </Box>
      </CardMedia>
      <CardContent sx={{ flexGrow: 1, position: "relative" }}>
        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
          <Typography
            gutterBottom
            variant="h6"
            component="h2"
            sx={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flexGrow: 1,
            }}
          >
            {playlist.name}
          </Typography>
          <IconButton
            size="small"
            onClick={handleMenuClick}
            sx={{ ml: 1 }}
          >
            <Icon icon={faEllipsisV} />
          </IconButton>
        </Box>
        {playlist.description && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {playlist.description}
          </Typography>
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

  if (loading) return <LoadingIndicator />;
  if (error) return <ErrorMessage error={error.message} />;

  const playlists = data?.findPlaylists.playlists || [];

  const handleDeletePlaylist = async (id: string) => {
    // TODO: Implement delete with confirmation dialog
    console.log("Delete playlist:", id);
    refetch();
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
        <Grid container spacing={3}>
          {playlists.map((playlist) => (
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={playlist.id}>
              <PlaylistCard
                playlist={playlist}
                onDelete={handleDeletePlaylist}
              />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
};
