import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Chip, TextField, Select, MenuItem, InputAdornment, FormControl, InputLabel, Box } from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import { faSearch } from "@fortawesome/free-solid-svg-icons";
import * as GQL from "src/core/generated-graphql";
import { ModalComponent } from "src/components/Shared/Modal";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { stashboxDisplayName } from "src/utils/stashbox";
import { TruncatedText } from "src/components/Shared/TruncatedText";
import TextUtils from "src/utils/text";
import GenderIcon from "src/components/Performers/GenderIcon";
import { CountryFlag } from "src/components/Shared/CountryFlag";
import { Icon } from "src/components/Shared/Icon";
import {
  stashBoxPerformerQuery,
  stashBoxSceneQuery,
  stashBoxStudioQuery,
  stashBoxTagQuery,
} from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import { stringToGender } from "src/utils/gender";

type SearchResultItem =
  | GQL.ScrapedPerformerDataFragment
  | GQL.ScrapedSceneDataFragment
  | GQL.ScrapedStudioDataFragment
  | GQL.ScrapedSceneTagDataFragment;

export type StashBoxEntityType = "performer" | "scene" | "studio" | "tag";

interface IProps {
  entityType: StashBoxEntityType;
  stashBoxes: GQL.StashBox[];
  excludedStashBoxEndpoints?: string[];
  onSelectItem: (item?: GQL.StashIdInput) => void;
  initialQuery?: string;
}

const CLASSNAME = "StashBoxIDSearchModal";
const CLASSNAME_LIST = `${CLASSNAME}-list`;
const CLASSNAME_LIST_CONTAINER = `${CLASSNAME_LIST}-container`;

interface IHasRemoteSiteID {
  remote_site_id?: string | null;
}

// Shared component for rendering images
const SearchResultImage: React.FC<{ imageUrl?: string | null }> = ({
  imageUrl,
}) => {
  if (!imageUrl) return null;

  return (
    <div className="scene-image-container">
      <img src={imageUrl} alt="" className="scene-image" style={{ alignSelf: 'center' }} />
    </div>
  );
};

// Shared component for rendering tags
const SearchResultTags: React.FC<{
  tags?: GQL.ScrapedTag[] | null;
}> = ({ tags }) => {
  if (!tags || tags.length === 0) return null;

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
      <Box sx={{ width: '100%' }}>
        {tags.map((tag) => (
          <Chip className="tag-item" label={tag.name} key={tag.stored_id} size="small" sx={{ mr: 0.5 }} />
        ))}
      </Box>
    </Box>
  );
};

// Performer Result Component
interface IPerformerResultProps {
  performer: GQL.ScrapedPerformerDataFragment;
}

const PerformerSearchResultDetails: React.FC<IPerformerResultProps> = ({
  performer,
}) => {
  const age = performer?.birthdate
    ? TextUtils.age(performer.birthdate, performer.death_date)
    : undefined;

  return (
    <div className="performer-result">
      <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
        <SearchResultImage imageUrl={performer.images?.[0]} />
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <h4 className="performer-name">
            <span>{performer.name}</span>
            {performer.disambiguation && (
              <span className="performer-disambiguation">
                {` (${performer.disambiguation})`}
              </span>
            )}
          </h4>
          <h5 className="performer-details">
            {performer.gender && (
              <span>
                <GenderIcon
                  className="gender-icon"
                  gender={stringToGender(performer.gender, true)}
                />
              </span>
            )}
            {age && (
              <span>
                {`${age} `}
                <FormattedMessage id="years_old" />
              </span>
            )}
          </h5>
          {performer.country && (
            <span>
              <CountryFlag
                className="performer-result__country-flag"
                country={performer.country}
              />
            </span>
          )}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
        <Box sx={{ width: '100%' }}>
          <TruncatedText text={performer.details ?? ""} lineCount={3} />
        </Box>
      </Box>
      <SearchResultTags tags={performer.tags} />
    </div>
  );
};

export const PerformerSearchResult: React.FC<IPerformerResultProps> = ({
  performer,
}) => {
  return (
    <Box className="search-item" sx={{ cursor: "pointer", marginTop: '1rem' }}>
      <PerformerSearchResultDetails performer={performer} />
    </Box>
  );
};

// Scene Result Component
interface ISceneResultProps {
  scene: GQL.ScrapedSceneDataFragment;
}

const SceneSearchResultDetails: React.FC<ISceneResultProps> = ({ scene }) => {
  return (
    <div className="scene-result">
      <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
        <SearchResultImage imageUrl={scene.image} />
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <h4 className="scene-title">
            <span>{scene.title}</span>
            {scene.code && (
              <span className="scene-code">{` (${scene.code})`}</span>
            )}
          </h4>
          <h5 className="scene-details">
            {scene.studio?.name && <span>{scene.studio.name}</span>}
            {scene.date && (
              <span className="scene-date">{` • ${scene.date}`}</span>
            )}
          </h5>
          {scene.performers && scene.performers.length > 0 && (
            <div className="scene-performers">
              {scene.performers.map((p) => p.name).join(", ")}
            </div>
          )}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
        <Box sx={{ width: '100%' }}>
          <TruncatedText text={scene.details ?? ""} lineCount={3} />
        </Box>
      </Box>
      <SearchResultTags tags={scene.tags} />
    </div>
  );
};

export const SceneSearchResult: React.FC<ISceneResultProps> = ({ scene }) => {
  return (
    <Box className="search-item" sx={{ cursor: "pointer", marginTop: '1rem' }}>
      <SceneSearchResultDetails scene={scene} />
    </Box>
  );
};

// Studio Result Component
interface IStudioResultProps {
  studio: GQL.ScrapedStudioDataFragment;
}

const StudioSearchResultDetails: React.FC<IStudioResultProps> = ({
  studio,
}) => {
  return (
    <div className="studio-result">
      <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
        <SearchResultImage imageUrl={studio.image} />
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <h4 className="studio-name">
            <span>{studio.name}</span>
          </h4>
          {studio.parent?.name && (
            <h5 className="studio-parent">
              <span>{studio.parent.name}</span>
            </h5>
          )}
          {studio.urls && studio.urls.length > 0 && (
            <div className="studio-url" style={{ color: '#a1a1aa', fontSize: '0.875rem' }}>{studio.urls[0]}</div>
          )}
        </Box>
      </Box>
    </div>
  );
};

export const StudioSearchResult: React.FC<IStudioResultProps> = ({
  studio,
}) => {
  return (
    <Box className="search-item" sx={{ cursor: "pointer", marginTop: '1rem' }}>
      <StudioSearchResultDetails studio={studio} />
    </Box>
  );
};

// Tag Result Component
interface ITagResultProps {
  tag: GQL.ScrapedSceneTagDataFragment;
}

export const TagSearchResult: React.FC<ITagResultProps> = ({ tag }) => {
  return (
    <Box className="search-item" sx={{ cursor: "pointer", marginTop: '1rem' }}>
      <div className="tag-result">
        <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <h4 className="tag-name">
              <span>{tag.name}</span>
            </h4>
          </Box>
        </Box>
      </div>
    </Box>
  );
};

// Helper to get entity type message id for i18n
function getEntityTypeMessageId(entityType: StashBoxEntityType): string {
  switch (entityType) {
    case "performer":
      return "performer";
    case "scene":
      return "scene";
    case "studio":
      return "studio";
    case "tag":
      return "tag";
  }
}

// Helper to get the "found" message id based on entity type
function getFoundMessageId(entityType: StashBoxEntityType): string {
  switch (entityType) {
    case "performer":
      return "dialogs.performers_found";
    case "scene":
      return "dialogs.scenes_found";
    case "studio":
      return "dialogs.studios_found";
    case "tag":
      return "dialogs.tags_found";
  }
}

// Main Modal Component
export const StashBoxIDSearchModal: React.FC<IProps> = ({
  entityType,
  stashBoxes,
  excludedStashBoxEndpoints = [],
  onSelectItem,
  initialQuery = "",
}) => {
  const intl = useIntl();
  const Toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [selectedStashBox, setSelectedStashBox] = useState<GQL.StashBox | null>(
    null
  );
  const [query, setQuery] = useState<string>(initialQuery);
  const [results, setResults] = useState<SearchResultItem[] | undefined>(
    undefined
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (stashBoxes.length > 0) {
      setSelectedStashBox(stashBoxes[0]);
    }
  }, [stashBoxes]);

  useEffect(() => inputRef.current?.focus(), []);

  const doSearch = useCallback(async () => {
    if (!selectedStashBox || !query) {
      return;
    }

    setLoading(true);
    setResults([]);

    try {
      switch (entityType) {
        case "performer": {
          const queryData = await stashBoxPerformerQuery(
            query,
            selectedStashBox.endpoint
          );
          setResults(queryData.data?.scrapeSinglePerformer ?? []);
          break;
        }
        case "scene": {
          const queryData = await stashBoxSceneQuery(
            query,
            selectedStashBox.endpoint
          );
          setResults(queryData.data?.scrapeSingleScene ?? []);
          break;
        }
        case "studio": {
          const queryData = await stashBoxStudioQuery(
            query,
            selectedStashBox.endpoint
          );
          setResults(queryData.data?.scrapeSingleStudio ?? []);
          break;
        }
        case "tag": {
          const queryData = await stashBoxTagQuery(
            query,
            selectedStashBox.endpoint
          );
          setResults(queryData.data?.scrapeSingleTag ?? []);
          break;
        }
      }
    } catch (error) {
      Toast.error(error);
    } finally {
      setLoading(false);
    }
  }, [query, selectedStashBox, Toast, entityType]);

  function handleItemClick(item: IHasRemoteSiteID) {
    if (selectedStashBox && item.remote_site_id) {
      onSelectItem({
        endpoint: selectedStashBox.endpoint,
        stash_id: item.remote_site_id,
      });
    } else {
      onSelectItem(undefined);
    }
  }

  function handleClose() {
    onSelectItem(undefined);
  }

  function renderResultItem(item: SearchResultItem) {
    switch (entityType) {
      case "performer":
        return (
          <PerformerSearchResult
            performer={item as GQL.ScrapedPerformerDataFragment}
          />
        );
      case "scene":
        return (
          <SceneSearchResult scene={item as GQL.ScrapedSceneDataFragment} />
        );
      case "studio":
        return (
          <StudioSearchResult studio={item as GQL.ScrapedStudioDataFragment} />
        );
      case "tag":
        return (
          <TagSearchResult tag={item as GQL.ScrapedSceneTagDataFragment} />
        );
    }
  }

  function renderResults() {
    if (!results || results.length === 0) {
      return null;
    }

    return (
      <div className={CLASSNAME_LIST_CONTAINER}>
        <div style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}>
          <FormattedMessage
            id={getFoundMessageId(entityType)}
            values={{ count: results.length }}
          />
        </div>
        <Box component="ul" className={CLASSNAME_LIST} sx={{ listStyleType: "none" }}>
          {results.map((item, i) => (
            <li key={i} onClick={() => handleItemClick(item)}>
              {renderResultItem(item)}
            </li>
          ))}
        </Box>
      </div>
    );
  }

  const entityTypeDisplayName = intl.formatMessage({
    id: getEntityTypeMessageId(entityType),
  });

  return (
    <ModalComponent
      show
      onHide={handleClose}
      header={intl.formatMessage(
        { id: "stashbox_search.header" },
        { entityType: entityTypeDisplayName }
      )}
      accept={{
        text: intl.formatMessage({ id: "actions.cancel" }),
        onClick: handleClose,
        variant: "secondary",
      }}
    >
      <div className={CLASSNAME}>
        <FormControl fullWidth margin="normal">
          <InputLabel id="stashbox-source-label">
            <FormattedMessage id="stashbox.source" />
          </InputLabel>
          <Select
            labelId="stashbox-source-label"
            value={selectedStashBox?.endpoint ?? ""}
            label={<FormattedMessage id="stashbox.source" />}
            onChange={(e) => {
              const box = stashBoxes.find(
                (b) => b.endpoint === e.target.value
              );
              if (box) {
                setSelectedStashBox(box);
              }
            }}
          >
            {stashBoxes.map((box, index) => (
              <MenuItem key={box.endpoint} value={box.endpoint}>
                {stashboxDisplayName(box.name, index)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {selectedStashBox &&
          excludedStashBoxEndpoints.includes(selectedStashBox.endpoint) && (
            <span className="saved-filter-overwrite-warning" style={{ marginBottom: '1rem', display: 'block' }}>
              <FormattedMessage id="dialogs.stashid_exists_warning" />
            </span>
          )}

        <TextField
          fullWidth
          variant="outlined"
          onChange={(e) => setQuery(e.currentTarget.value)}
          value={query}
          placeholder={intl.formatMessage(
            { id: "stashbox_search.placeholder_name_or_id" },
            { entityType: entityTypeDisplayName }
          )}
          inputRef={inputRef}
          onKeyPress={(e: React.KeyboardEvent<HTMLDivElement>) =>
            e.key === "Enter" && doSearch()
          }
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <Button
                  onClick={doSearch}
                  variant="contained"
                  color="primary"
                  disabled={!selectedStashBox}
                  title={intl.formatMessage({ id: "actions.search" })}
                >
                  <Icon icon={faSearch} />
                </Button>
              </InputAdornment>
            ),
          }}
        />

        {loading ? (
          <div style={{ margin: '1.5rem', textAlign: 'center' }}>
            <LoadingIndicator inline />
          </div>
        ) : results && results.length > 0 ? (
          renderResults()
        ) : (
          results !== undefined &&
          results.length === 0 && (
            <h5 style={{ textAlign: 'center', marginTop: '1.5rem' }}>
              <FormattedMessage id="stashbox_search.no_results" />
            </h5>
          )
        )}
      </div>
    </ModalComponent>
  );
};

export default StashBoxIDSearchModal;
