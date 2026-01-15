import React, { useState, useEffect } from "react";
import { Box, IconButton, Select, MenuItem, FormControl, InputLabel, List, ListItem, ListItemText, Typography, SelectChangeEvent } from "@mui/material";
import { ModalComponent } from "src/components/Shared/Modal";
import { Icon } from "src/components/Shared/Icon";
import { FormattedMessage, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { IScraperSource } from "./constants";
import { OptionsEditor } from "./Options";
import {
  faCog,
  faGripVertical,
  faMinus,
  faPencilAlt,
  faPlus,
} from "@fortawesome/free-solid-svg-icons";

interface ISourceEditor {
  isNew: boolean;
  availableSources: IScraperSource[];
  source: IScraperSource;
  saveSource: (s?: IScraperSource) => void;
  defaultOptions: GQL.IdentifyMetadataOptionsInput;
}

export const SourcesEditor: React.FC<ISourceEditor> = ({
  isNew,
  availableSources,
  source: initialSource,
  saveSource,
  defaultOptions,
}) => {
  const [source, setSource] = useState<IScraperSource>(initialSource);
  const [editingField, setEditingField] = useState(false);

  const intl = useIntl();

  // if id is empty, then we are adding a new source
  const headerMsgId = isNew ? "actions.add" : "dialogs.edit_entity_title";
  const acceptMsgId = isNew ? "actions.add" : "actions.confirm";

  function handleSourceSelect(e: SelectChangeEvent<string> | React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const selectedSource = availableSources.find(
      (s) => s.id === value
    );
    if (!selectedSource) return;

    setSource({
      ...source,
      id: selectedSource.id,
      displayName: selectedSource.displayName,
      scraper_id: selectedSource.scraper_id,
      stash_box_endpoint: selectedSource.stash_box_endpoint,
    });
  }

  return (
    <ModalComponent
      dialogClassName="identify-source-editor"
      modalProps={{ animation: false, size: "lg" }}
      show
      icon={isNew ? faPlus : faPencilAlt}
      header={intl.formatMessage(
        { id: headerMsgId },
        {
          count: 1,
          singularEntity: source?.displayName,
          pluralEntity: source?.displayName,
        }
      )}
      accept={{
        onClick: () => saveSource(source),
        text: intl.formatMessage({ id: acceptMsgId }),
      }}
      cancel={{
        onClick: () => saveSource(),
        text: intl.formatMessage({ id: "actions.cancel" }),
        variant: "secondary",
      }}
      disabled={
        (!source.scraper_id && !source.stash_box_endpoint) || editingField
      }
    >
      <Box>
        {isNew && (
          <Box mb={2}>
            <Typography variant="h6">
              <FormattedMessage id="config.tasks.identify.source" />
            </Typography>
            <FormControl fullWidth>
              <Select
                native
                value={source.id}
                className="input-control"
                onChange={handleSourceSelect}
                inputProps={{
                  name: 'source-id',
                  id: 'source-select',
                }}
              >
                {availableSources.map((i) => (
                  <option value={i.id} key={i.id}>
                    {i.displayName}
                  </option>
                ))}
              </Select>
            </FormControl>
          </Box>
        )}
        <OptionsEditor
          options={source.options ?? {}}
          setOptions={(o) => setSource({ ...source, options: o })}
          source={source}
          setEditingField={(v) => setEditingField(v)}
          defaultOptions={defaultOptions}
        />
      </Box>
    </ModalComponent>
  );
};

interface ISourcesList {
  sources: IScraperSource[];
  setSources: (s: IScraperSource[]) => void;
  editSource: (s?: IScraperSource) => void;
  canAdd: boolean;
}

export const SourcesList: React.FC<ISourcesList> = ({
  sources,
  setSources,
  editSource,
  canAdd,
}) => {
  const [tempSources, setTempSources] = useState(sources);
  const [dragIndex, setDragIndex] = useState<number | undefined>();
  const [mouseOverIndex, setMouseOverIndex] = useState<number | undefined>();

  useEffect(() => {
    setTempSources([...sources]);
  }, [sources]);

  function removeSource(index: number) {
    const newSources = [...sources];
    newSources.splice(index, 1);
    setSources(newSources);
  }

  function onDragStart(event: React.DragEvent<HTMLElement>, index: number) {
    event.dataTransfer.effectAllowed = "move";
    setDragIndex(index);
  }

  function onDragOver(event: React.DragEvent<HTMLElement>, index?: number) {
    if (dragIndex !== undefined && index !== undefined && index !== dragIndex) {
      const newSources = [...tempSources];
      const moved = newSources.splice(dragIndex, 1);
      newSources.splice(index, 0, moved[0]);
      setTempSources(newSources);
      setDragIndex(index);
    }

    event.dataTransfer.dropEffect = "move";
    event.preventDefault();
  }

  function onDragOverDefault(event: React.DragEvent<HTMLDivElement>) {
    event.dataTransfer.dropEffect = "move";
    event.preventDefault();
  }

  function onDrop() {
    // assume we've already set the temp source list
    // feed it up
    setSources(tempSources);
    setDragIndex(undefined);
    setMouseOverIndex(undefined);
  }

  return (
    <Box className="scraper-sources" onDragOver={onDragOverDefault}>
      <Typography variant="h5" gutterBottom>
        <FormattedMessage id="config.tasks.identify.sources" />
      </Typography>
      <List className="scraper-source-list">
        {tempSources.map((s, index) => (
          <ListItem
            key={s.id}
            className="d-flex justify-content-between align-items-center"
            draggable={mouseOverIndex === index}
            onDragStart={(e) => onDragStart(e, index)}
            onDragEnter={(e) => onDragOver(e, index)}
            onDrop={() => onDrop()}
            divider
          >
            <Box display="flex" alignItems="center">
              <Box
                className="minimal text-muted drag-handle mr-2"
                onMouseEnter={() => setMouseOverIndex(index)}
                onMouseLeave={() => setMouseOverIndex(undefined)}
                style={{ cursor: 'grab' }}
              >
                <Icon icon={faGripVertical} />
              </Box>
              <ListItemText primary={s.displayName} />
            </Box>
            <Box>
              <IconButton className="minimal" onClick={() => editSource(s)} size="small">
                <Icon icon={faCog} />
              </IconButton>
              <IconButton
                className="minimal text-danger"
                onClick={() => removeSource(index)}
                size="small"
              >
                <Icon icon={faMinus} />
              </IconButton>
            </Box>
          </ListItem>
        ))}
      </List>
      {canAdd && (
        <Box className="text-right" mt={2}>
          <IconButton
            className="minimal add-scraper-source-button"
            onClick={() => editSource()}
            size="large"
          >
            <Icon icon={faPlus} />
          </IconButton>
        </Box>
      )}
    </Box>
  );
};
