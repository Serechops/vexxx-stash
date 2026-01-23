import React, { useState, useCallback, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Tabs,
  Tab,
  Box,
  TextField,
  InputAdornment,
  Grid,
  Card,
  CardMedia,
  CardContent,
  Typography,
  Checkbox,
  CircularProgress,
  Chip,
  alpha,
} from "@mui/material";
import {
  faSearch,
  faPlayCircle,
  faImage,
  faImages,
  faFilm,
  faClock,
} from "@fortawesome/free-solid-svg-icons";
import { Icon } from "../Shared/Icon";
import * as GQL from "src/core/generated-graphql";
import TextUtils from "src/utils/text";
import { useDebounce } from "src/hooks/debounce";

export interface ISelectedMediaItem {
  id: string;
  mediaType: GQL.PlaylistMediaType;
  title: string;
  thumbnail?: string;
}

interface IMediaItemSelectorProps {
  selectedItems: ISelectedMediaItem[];
  onSelectionChange: (items: ISelectedMediaItem[]) => void;
  showSelectedSummary?: boolean;
  minHeight?: number | string;
}

type MediaTab = "scenes" | "images" | "galleries" | "groups";

interface ITabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
  minHeight?: number | string;
}

const TabPanel: React.FC<ITabPanelProps> = ({ children, value, index, minHeight = 300 }) => {
  return (
    <Box
      role="tabpanel"
      hidden={value !== index}
      sx={{ pt: 2, minHeight }}
    >
      {value === index && children}
    </Box>
  );
};

interface IMediaCardProps {
  id: string;
  title: string;
  thumbnail?: string;
  duration?: number;
  selected: boolean;
  onToggle: () => void;
  icon: typeof faPlayCircle;
}

const MediaCard: React.FC<IMediaCardProps> = ({
  title,
  thumbnail,
  duration,
  selected,
  onToggle,
  icon,
}) => {
  return (
    <Card
      sx={{
        position: "relative",
        cursor: "pointer",
        transition: "all 0.2s",
        border: selected ? 2 : 1,
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: selected
          ? (theme) => alpha(theme.palette.primary.main, 0.1)
          : "background.paper",
        "&:hover": {
          borderColor: "primary.main",
          transform: "translateY(-2px)",
        },
      }}
      onClick={onToggle}
    >
      <Checkbox
        checked={selected}
        sx={{
          position: "absolute",
          top: 4,
          left: 4,
          zIndex: 1,
          bgcolor: "background.paper",
          borderRadius: 1,
          p: 0.5,
        }}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggle}
      />
      <CardMedia
        component="img"
        height={100}
        image={thumbnail || "/assets/placeholder.png"}
        alt={title}
        sx={{ objectFit: "cover" }}
        onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
          e.currentTarget.src = "/assets/placeholder.png";
        }}
      />
      <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
          <Icon icon={icon} className="fa-sm" />
          {duration !== undefined && duration > 0 && (
            <Typography variant="caption" color="text.secondary">
              <Icon icon={faClock} className="fa-xs mr-1" />
              {TextUtils.secondsToTimestamp(duration)}
            </Typography>
          )}
        </Box>
        <Typography
          variant="body2"
          noWrap
          title={title}
          sx={{ fontWeight: selected ? 600 : 400 }}
        >
          {title}
        </Typography>
      </CardContent>
    </Card>
  );
};

export const MediaItemSelector: React.FC<IMediaItemSelectorProps> = ({
  selectedItems,
  onSelectionChange,
  showSelectedSummary = true,
  minHeight = 300,
}) => {
  const intl = useIntl();

  const [activeTab, setActiveTab] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  // Lazy queries for each media type
  const [searchScenes, { data: scenesData, loading: scenesLoading }] =
    GQL.useFindScenesLazyQuery();
  const [searchImages, { data: imagesData, loading: imagesLoading }] =
    GQL.useFindImagesLazyQuery();
  const [searchGalleries, { data: galleriesData, loading: galleriesLoading }] =
    GQL.useFindGalleriesLazyQuery();
  const [searchGroups, { data: groupsData, loading: groupsLoading }] =
    GQL.useFindGroupsLazyQuery();

  const debouncedSearch = useDebounce((query: string, tab: MediaTab) => {
    const filter: GQL.FindFilterType = {
      q: query || undefined,
      per_page: 24,
      page: 1,
      sort: "updated_at",
      direction: GQL.SortDirectionEnum.Desc,
    };

    switch (tab) {
      case "scenes":
        searchScenes({ variables: { filter } });
        break;
      case "images":
        searchImages({ variables: { filter } });
        break;
      case "galleries":
        searchGalleries({ variables: { filter } });
        break;
      case "groups":
        searchGroups({ variables: { filter } });
        break;
    }
  }, 300);

  const getTabKey = (tabIndex: number): MediaTab => {
    const tabs: MediaTab[] = ["scenes", "images", "galleries", "groups"];
    return tabs[tabIndex] || "scenes";
  };

  useEffect(() => {
    debouncedSearch(searchQuery, getTabKey(activeTab));
  }, [searchQuery, activeTab, debouncedSearch]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(event.target.value);
    },
    []
  );

  const toggleItemSelection = useCallback(
    (
      id: string,
      mediaType: GQL.PlaylistMediaType,
      title: string,
      thumbnail?: string
    ) => {
      const existing = selectedItems.find(
        (item) => item.id === id && item.mediaType === mediaType
      );
      if (existing) {
        onSelectionChange(
          selectedItems.filter(
            (item) => !(item.id === id && item.mediaType === mediaType)
          )
        );
      } else {
        onSelectionChange([...selectedItems, { id, mediaType, title, thumbnail }]);
      }
    },
    [selectedItems, onSelectionChange]
  );

  const isItemSelected = useCallback(
    (id: string, mediaType: GQL.PlaylistMediaType) => {
      return selectedItems.some(
        (item) => item.id === id && item.mediaType === mediaType
      );
    },
    [selectedItems]
  );

  const removeSelectedItem = useCallback(
    (id: string, mediaType: GQL.PlaylistMediaType) => {
      onSelectionChange(
        selectedItems.filter((item) => !(item.id === id && item.mediaType === mediaType))
      );
    },
    [selectedItems, onSelectionChange]
  );

  const scenes = scenesData?.findScenes?.scenes || [];
  const images = imagesData?.findImages?.images || [];
  const galleries = galleriesData?.findGalleries?.galleries || [];
  const groups = groupsData?.findGroups?.groups || [];

  return (
    <Box>
      {/* Selected Items Summary */}
      {showSelectedSummary && selectedItems.length > 0 && (
        <Box sx={{ mb: 2, p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            <FormattedMessage
              id="selected_items"
              defaultMessage="{count} items selected"
              values={{ count: selectedItems.length }}
            />
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {selectedItems.map((item) => (
              <Chip
                key={`${item.mediaType}-${item.id}`}
                label={item.title}
                size="small"
                onDelete={() => removeSelectedItem(item.id, item.mediaType)}
                sx={{ maxWidth: 150 }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Search Input */}
      <TextField
        fullWidth
        placeholder={intl.formatMessage({
          id: "search_media",
          defaultMessage: "Search media...",
        })}
        value={searchQuery}
        onChange={handleSearchChange}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Icon icon={faSearch} />
            </InputAdornment>
          ),
        }}
        sx={{ mb: 2 }}
      />

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onChange={handleTabChange}
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <Tab
          icon={<Icon icon={faPlayCircle} />}
          iconPosition="start"
          label={intl.formatMessage({
            id: "scenes",
            defaultMessage: "Scenes",
          })}
        />
        <Tab
          icon={<Icon icon={faImage} />}
          iconPosition="start"
          label={intl.formatMessage({
            id: "images",
            defaultMessage: "Images",
          })}
        />
        <Tab
          icon={<Icon icon={faImages} />}
          iconPosition="start"
          label={intl.formatMessage({
            id: "galleries",
            defaultMessage: "Galleries",
          })}
        />
        <Tab
          icon={<Icon icon={faFilm} />}
          iconPosition="start"
          label={intl.formatMessage({
            id: "groups",
            defaultMessage: "Groups",
          })}
        />
      </Tabs>

      {/* Tab Panels */}
      <TabPanel value={activeTab} index={0} minHeight={minHeight}>
        {scenesLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress />
          </Box>
        ) : scenes.length === 0 ? (
          <Typography color="text.secondary" sx={{ textAlign: "center", py: 4 }}>
            <FormattedMessage id="no_results" defaultMessage="No results found" />
          </Typography>
        ) : (
          <Grid container spacing={2}>
            {scenes.map((scene) => {
              const filePath = scene.files?.[0]?.path || "";
              const fileName = filePath.split(/[\\/]/).pop() || "Untitled";
              return (
                <Grid key={scene.id} size={{ xs: 6, sm: 4, md: 3 }}>
                  <MediaCard
                    id={scene.id}
                    title={scene.title || fileName}
                    thumbnail={scene.paths?.screenshot || undefined}
                    duration={scene.files?.[0]?.duration || undefined}
                    selected={isItemSelected(scene.id, GQL.PlaylistMediaType.Scene)}
                    onToggle={() =>
                      toggleItemSelection(
                        scene.id,
                        GQL.PlaylistMediaType.Scene,
                        scene.title || fileName,
                        scene.paths?.screenshot || undefined
                      )
                    }
                    icon={faPlayCircle}
                  />
                </Grid>
              );
            })}
          </Grid>
        )}
      </TabPanel>

      <TabPanel value={activeTab} index={1} minHeight={minHeight}>
        {imagesLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress />
          </Box>
        ) : images.length === 0 ? (
          <Typography color="text.secondary" sx={{ textAlign: "center", py: 4 }}>
            <FormattedMessage id="no_results" defaultMessage="No results found" />
          </Typography>
        ) : (
          <Grid container spacing={2}>
            {images.map((image) => {
              const filePath = image.visual_files?.[0]?.path || "";
              const fileName = filePath.split(/[\\/]/).pop() || "Untitled";
              return (
                <Grid key={image.id} size={{ xs: 6, sm: 4, md: 3 }}>
                  <MediaCard
                    id={image.id}
                    title={image.title || fileName}
                    thumbnail={image.paths?.thumbnail || undefined}
                    selected={isItemSelected(image.id, GQL.PlaylistMediaType.Image)}
                    onToggle={() =>
                      toggleItemSelection(
                        image.id,
                        GQL.PlaylistMediaType.Image,
                        image.title || fileName,
                        image.paths?.thumbnail || undefined
                      )
                    }
                    icon={faImage}
                  />
                </Grid>
              );
            })}
          </Grid>
        )}
      </TabPanel>

      <TabPanel value={activeTab} index={2} minHeight={minHeight}>
        {galleriesLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress />
          </Box>
        ) : galleries.length === 0 ? (
          <Typography color="text.secondary" sx={{ textAlign: "center", py: 4 }}>
            <FormattedMessage id="no_results" defaultMessage="No results found" />
          </Typography>
        ) : (
          <Grid container spacing={2}>
            {galleries.map((gallery) => (
              <Grid key={gallery.id} size={{ xs: 6, sm: 4, md: 3 }}>
                <MediaCard
                  id={gallery.id}
                  title={gallery.title || gallery.folder?.path || "Untitled"}
                  thumbnail={gallery.paths?.cover || undefined}
                  selected={isItemSelected(gallery.id, GQL.PlaylistMediaType.Gallery)}
                  onToggle={() =>
                    toggleItemSelection(
                      gallery.id,
                      GQL.PlaylistMediaType.Gallery,
                      gallery.title || gallery.folder?.path || "Untitled",
                      gallery.paths?.cover || undefined
                    )
                  }
                  icon={faImages}
                />
              </Grid>
            ))}
          </Grid>
        )}
      </TabPanel>

      <TabPanel value={activeTab} index={3} minHeight={minHeight}>
        {groupsLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress />
          </Box>
        ) : groups.length === 0 ? (
          <Typography color="text.secondary" sx={{ textAlign: "center", py: 4 }}>
            <FormattedMessage id="no_results" defaultMessage="No results found" />
          </Typography>
        ) : (
          <Grid container spacing={2}>
            {groups.map((group) => (
              <Grid key={group.id} size={{ xs: 6, sm: 4, md: 3 }}>
                <MediaCard
                  id={group.id}
                  title={group.name}
                  thumbnail={group.front_image_path || undefined}
                  duration={group.duration || undefined}
                  selected={isItemSelected(group.id, GQL.PlaylistMediaType.Group)}
                  onToggle={() =>
                    toggleItemSelection(
                      group.id,
                      GQL.PlaylistMediaType.Group,
                      group.name,
                      group.front_image_path || undefined
                    )
                  }
                  icon={faFilm}
                />
              </Grid>
            ))}
          </Grid>
        )}
      </TabPanel>
    </Box>
  );
};
