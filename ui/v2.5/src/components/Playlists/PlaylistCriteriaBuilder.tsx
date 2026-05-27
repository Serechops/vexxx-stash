import React, { useState, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Box,
  TextField,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Chip,
  IconButton,
  Switch,
  FormControlLabel,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  SelectChangeEvent,
} from "@mui/material";
import { faChevronDown, faCode } from "@fortawesome/free-solid-svg-icons";
import { Icon } from "../Shared/Icon";
import * as GQL from "src/core/generated-graphql";

interface PlaylistCriteria {
  scene_filter?: {
    studios?: { value?: string[]; modifier?: string };
    tags?: { value?: string[]; modifier?: string; depth?: number };
    rating100?: { value?: number; modifier?: string };
    organized?: boolean;
    performer_favorite?: boolean;
  };
  find_filter?: {
    sort?: string;
    direction?: GQL.SortDirectionEnum;
    per_page?: number;
  };
}

interface IPlaylistCriteriaBuilderProps {
  criteria: PlaylistCriteria;
  onChange: (criteria: PlaylistCriteria) => void;
}

const sortOptions = [
  { value: "date", label: "Date" },
  { value: "created_at", label: "Created" },
  { value: "updated_at", label: "Updated" },
  { value: "rating100", label: "Rating" },
  { value: "duration", label: "Duration" },
  { value: "title", label: "Title" },
  { value: "path", label: "Path" },
  { value: "random", label: "Random" },
];

const ratingOptions = [
  { value: 0, label: "Any" },
  { value: 20, label: "1+ ★" },
  { value: 40, label: "2+ ★★" },
  { value: 60, label: "3+ ★★★" },
  { value: 80, label: "4+ ★★★★" },
  { value: 100, label: "5 ★★★★★" },
];

export const PlaylistCriteriaBuilder: React.FC<IPlaylistCriteriaBuilderProps> = ({
  criteria,
  onChange,
}) => {
  const intl = useIntl();
  const [advancedMode, setAdvancedMode] = useState(false);
  const [jsonValue, setJsonValue] = useState("");

  useEffect(() => {
    setJsonValue(JSON.stringify(criteria, null, 2));
  }, [criteria]);

  const handleJsonChange = (value: string) => {
    setJsonValue(value);
    try {
      const parsed = JSON.parse(value) as PlaylistCriteria;
      onChange(parsed);
    } catch {
      // Invalid JSON, don't update
    }
  };

  const updateSceneFilter = (key: string, value: unknown) => {
    onChange({
      ...criteria,
      scene_filter: {
        ...criteria.scene_filter,
        [key]: value,
      },
    });
  };

  const updateFindFilter = (key: string, value: unknown) => {
    onChange({
      ...criteria,
      find_filter: {
        ...criteria.find_filter,
        [key]: value,
      },
    });
  };

  const handleSortChange = (event: SelectChangeEvent<string>) => {
    updateFindFilter("sort", event.target.value);
  };

  const handleDirectionChange = (event: SelectChangeEvent<string>) => {
    updateFindFilter("direction", event.target.value as GQL.SortDirectionEnum);
  };

  const handleLimitChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const val = event.target.value;
    if (val === "") {
      updateFindFilter("per_page", -1);
    } else {
      const num = parseInt(val, 10);
      if (!isNaN(num)) {
        updateFindFilter("per_page", num === 0 ? -1 : num);
      }
    }
  };

  const handleRatingChange = (event: SelectChangeEvent<number>) => {
    const val = event.target.value as number;
    if (val === 0) {
      const { rating100, ...rest } = criteria.scene_filter || {};
      onChange({
        ...criteria,
        scene_filter: rest,
      });
    } else {
      updateSceneFilter("rating100", { value: val, modifier: "GREATER_THAN" });
    }
  };

  const handleOrganizedChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      updateSceneFilter("organized", true);
    } else {
      const { organized, ...rest } = criteria.scene_filter || {};
      onChange({
        ...criteria,
        scene_filter: rest,
      });
    }
  };

  const handleFavoritesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      updateSceneFilter("performer_favorite", true);
    } else {
      const { performer_favorite, ...rest } = criteria.scene_filter || {};
      onChange({
        ...criteria,
        scene_filter: rest,
      });
    }
  };

  const currentSort = criteria.find_filter?.sort || "date";
  const currentDirection = criteria.find_filter?.direction || GQL.SortDirectionEnum.Desc;
  const currentLimit = criteria.find_filter?.per_page === -1 ? "" : (criteria.find_filter?.per_page || "");
  const currentRating = criteria.scene_filter?.rating100?.value || 0;
  const isOrganized = criteria.scene_filter?.organized || false;
  const isFavorites = criteria.scene_filter?.performer_favorite || false;

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="subtitle2" color="text.secondary">
          <FormattedMessage
            id="playlist_criteria_builder_title"
            defaultMessage="Dynamic Playlist Criteria"
          />
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={advancedMode}
              onChange={(e) => setAdvancedMode(e.target.checked)}
              size="small"
            />
          }
          label={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Icon icon={faCode} />
              <Typography variant="caption">
                <FormattedMessage id="advanced_mode" defaultMessage="Advanced" />
              </Typography>
            </Box>
          }
        />
      </Box>

      {advancedMode ? (
        <TextField
          fullWidth
          multiline
          minRows={8}
          value={jsonValue}
          onChange={(e) => handleJsonChange(e.target.value)}
          label={intl.formatMessage({
            id: "playlist_criteria_json",
            defaultMessage: "Criteria JSON",
          })}
          helperText={intl.formatMessage({
            id: "playlist_criteria_json_help",
            defaultMessage: "Full SceneFilterType and FindFilterType fields available",
          })}
          sx={{ fontFamily: "monospace", fontSize: "0.875rem" }}
        />
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Sort & Direction */}
          <Box sx={{ display: "flex", gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel>
                <FormattedMessage id="sort_by" defaultMessage="Sort By" />
              </InputLabel>
              <Select value={currentSort} onChange={handleSortChange} label="Sort By">
                {sortOptions.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl sx={{ minWidth: 140 }}>
              <InputLabel>
                <FormattedMessage id="direction" defaultMessage="Direction" />
              </InputLabel>
              <Select value={currentDirection} onChange={handleDirectionChange} label="Direction">
                <MenuItem value="DESC">
                  <FormattedMessage id="descending" defaultMessage="Descending" />
                </MenuItem>
                <MenuItem value="ASC">
                  <FormattedMessage id="ascending" defaultMessage="Ascending" />
                </MenuItem>
              </Select>
            </FormControl>
          </Box>

          {/* Limit */}
          <TextField
            fullWidth
            label={intl.formatMessage({
              id: "max_items",
              defaultMessage: "Maximum Items",
            })}
            value={currentLimit}
            onChange={handleLimitChange}
            type="number"
            helperText={intl.formatMessage({
              id: "max_items_help",
              defaultMessage: "Leave empty for unlimited (all matching scenes)",
            })}
            placeholder={intl.formatMessage({
              id: "unlimited",
              defaultMessage: "Unlimited",
            })}
          />

          {/* Rating Filter */}
          <FormControl fullWidth>
            <InputLabel>
              <FormattedMessage id="minimum_rating" defaultMessage="Minimum Rating" />
            </InputLabel>
            <Select value={currentRating} onChange={handleRatingChange} label="Minimum Rating">
              {ratingOptions.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Quick Filters */}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <FormControlLabel
              control={
                <Switch checked={isOrganized} onChange={handleOrganizedChange} size="small" />
              }
              label={intl.formatMessage({
                id: "filter_organized_only",
                defaultMessage: "Organized only",
              })}
            />
            <FormControlLabel
              control={
                <Switch checked={isFavorites} onChange={handleFavoritesChange} size="small" />
              }
              label={intl.formatMessage({
                id: "filter_favorite_performers",
                defaultMessage: "With favorite performers",
              })}
            />
          </Box>

          {/* Advanced Filters Notice */}
          <Accordion>
            <AccordionSummary expandIcon={<Icon icon={faChevronDown} />}>
              <Typography variant="body2" color="text.secondary">
                <FormattedMessage
                  id="need_more_filters"
                  defaultMessage="Need more filters?"
                />
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                <FormattedMessage
                  id="advanced_filters_help"
                  defaultMessage="For studio, tag, performer, or advanced filters, enable Advanced mode above to edit the raw JSON. You can use all fields from SceneFilterType."
                />
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                <FormattedMessage
                  id="example_filters"
                  defaultMessage='Example: Add "studios": {{"value": ["123"], "modifier": "INCLUDES"}} for specific studio.'
                />
              </Typography>
            </AccordionDetails>
          </Accordion>
        </Box>
      )}
    </Box>
  );
};
