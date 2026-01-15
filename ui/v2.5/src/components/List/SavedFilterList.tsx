import React, { HTMLAttributes, useEffect, useMemo, useState } from "react";
import {
  Button,
  ButtonGroup,
  Menu,
  MenuItem,
  TextField,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tooltip,
  IconButton,
  Typography,
} from "@mui/material";
import {
  useConfigureUISetting,
  useFindSavedFilters,
  useSavedFilterDestroy,
  useSaveFilter,
} from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import { ListFilterModel } from "src/models/list-filter/filter";
import {
  FilterMode,
  SavedFilterDataFragment,
} from "src/core/generated-graphql";
import { View } from "./views";
import { FormattedMessage, useIntl } from "react-intl";
import { Icon } from "../Shared/Icon";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { faBookmark, faSave, faTimes } from "@fortawesome/free-solid-svg-icons";
import { AlertModal } from "../Shared/Alert";
import cx from "classnames";
import { TruncatedInlineText } from "../Shared/TruncatedText";
import { OperationButton } from "../Shared/OperationButton";
import { createPortal } from "react-dom";

const ExistingSavedFilterList: React.FC<{
  name: string;
  onSelect: (value: SavedFilterDataFragment) => void;
  savedFilters: SavedFilterDataFragment[];
  disabled?: boolean;
}> = ({ name, onSelect, savedFilters: existing, disabled = false }) => {
  const filtered = useMemo(() => {
    if (!name) return existing;

    return existing.filter((f) =>
      f.name.toLowerCase().includes(name.toLowerCase())
    );
  }, [existing, name]);

  return (
    <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0, maxHeight: "200px", overflowY: "auto" }}>
      {filtered.map((f) => (
        <Box component="li" key={f.id}>
          <Button
            variant="text"
            size="small"
            onClick={() => onSelect(f)}
            disabled={disabled}
            sx={{
              justifyContent: "flex-start",
              textAlign: "left",
              width: "100%",
              padding: "2px 8px",
              color: "text.primary",
              "&:hover": {
                backgroundColor: "action.hover",
              }
            }}
          >
            {f.name}
          </Button>
        </Box>
      ))}
    </Box>
  );
};

export const SaveFilterDialog: React.FC<{
  mode: FilterMode;
  onClose: (name?: string, id?: string) => void;
  isSaving?: boolean;
}> = ({ mode, onClose, isSaving = false }) => {
  const intl = useIntl();
  const [filterName, setFilterName] = useState("");

  const { data } = useFindSavedFilters(mode);

  const overwritingFilter = useMemo(() => {
    const savedFilters = data?.findSavedFilters ?? [];
    return savedFilters.find(
      (f) => f.name.toLowerCase() === filterName.toLowerCase()
    );
  }, [data?.findSavedFilters, filterName]);

  return (
    <Dialog open maxWidth="sm" fullWidth>
      <DialogTitle>
        <FormattedMessage id="actions.save_filter" />
      </DialogTitle>
      <DialogContent>
        <Box mb={2}>
          <Typography variant="body2" component="label" sx={{ mb: 1, display: 'block' }}>
            <FormattedMessage id="filter_name" />
          </Typography>
          <TextField
            fullWidth
            size="small"
            placeholder={`${intl.formatMessage({ id: "filter_name" })}…`}
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            disabled={isSaving}
          />
        </Box>

        <ExistingSavedFilterList
          name={filterName}
          onSelect={(f) => setFilterName(f.name)}
          savedFilters={data?.findSavedFilters ?? []}
        />

        {!!overwritingFilter && (
          <Typography variant="body2" color="error" fontWeight="bold">
            <FormattedMessage
              id="dialogs.overwrite_filter_warning"
              values={{
                entityName: overwritingFilter.name,
              }}
            />
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          variant="contained"
          color="secondary"
          onClick={() => onClose()}
          disabled={isSaving}
        >
          {intl.formatMessage({ id: "actions.cancel" })}
        </Button>
        <OperationButton
          loading={isSaving}
          color="primary"
          onClick={() => onClose(filterName, overwritingFilter?.id)}
        >
          {intl.formatMessage({ id: "actions.save" })}
        </OperationButton>
      </DialogActions>
    </Dialog>
  );
};

export const LoadFilterDialog: React.FC<{
  mode: FilterMode;
  onClose: (filter?: SavedFilterDataFragment) => void;
}> = ({ mode, onClose }) => {
  const intl = useIntl();
  const [filterName, setFilterName] = useState("");

  const { data } = useFindSavedFilters(mode);

  return (
    <Dialog open maxWidth="sm" fullWidth>
      <DialogTitle>
        <FormattedMessage id="actions.load_filter" />
      </DialogTitle>
      <DialogContent>
        <Box mb={2}>
          <Typography variant="body2" component="label" sx={{ mb: 1, display: 'block' }}>
            <FormattedMessage id="filter_name" />
          </Typography>
          <TextField
            fullWidth
            size="small"
            placeholder={`${intl.formatMessage({ id: "filter_name" })}…`}
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
          />
        </Box>

        <ExistingSavedFilterList
          name={filterName}
          onSelect={(f) => onClose(f)}
          savedFilters={data?.findSavedFilters ?? []}
        />
      </DialogContent>
      <DialogActions>
        <Button variant="contained" color="secondary" onClick={() => onClose()}>
          {intl.formatMessage({ id: "actions.cancel" })}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const DeleteAlert: React.FC<{
  deletingFilter: SavedFilterDataFragment | undefined;
  onClose: (confirm?: boolean) => void;
}> = ({ deletingFilter, onClose }) => {
  if (!deletingFilter) {
    return null;
  }

  return (
    <Dialog open>
      <DialogContent>
        <FormattedMessage
          id="dialogs.delete_confirm"
          values={{
            entityName: deletingFilter.name,
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button variant="contained" color="error" onClick={() => onClose(true)}>
          <FormattedMessage id="actions.delete" />
        </Button>
        <Button variant="contained" color="secondary" onClick={() => onClose()}>
          <FormattedMessage id="actions.cancel" />
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const OverwriteAlert: React.FC<{
  overwritingFilter: SavedFilterDataFragment | undefined;
  onClose: (confirm?: boolean) => void;
}> = ({ overwritingFilter, onClose }) => {
  if (!overwritingFilter) {
    return null;
  }

  return (
    <Dialog open>
      <DialogContent>
        <FormattedMessage
          id="dialogs.overwrite_filter_warning"
          values={{
            entityName: overwritingFilter.name,
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button variant="contained" color="primary" onClick={() => onClose(true)}>
          <FormattedMessage id="actions.overwrite" />
        </Button>
        <Button variant="contained" color="secondary" onClick={() => onClose()}>
          <FormattedMessage id="actions.cancel" />
        </Button>
      </DialogActions>
    </Dialog>
  );
};

interface ISavedFilterListProps {
  filter: ListFilterModel;
  onSetFilter: (f: ListFilterModel) => void;
  view?: View;
  menuPortalTarget?: Element | DocumentFragment;
}

export const SavedFilterList: React.FC<ISavedFilterListProps> = ({
  filter,
  onSetFilter,
  view,
}) => {
  const Toast = useToast();
  const intl = useIntl();

  const { data, error, loading, refetch } = useFindSavedFilters(filter.mode);

  const [filterName, setFilterName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingFilter, setDeletingFilter] = useState<
    SavedFilterDataFragment | undefined
  >();
  const [overwritingFilter, setOverwritingFilter] = useState<
    SavedFilterDataFragment | undefined
  >();

  const saveFilter = useSaveFilter();
  const [destroyFilter] = useSavedFilterDestroy();
  const [saveUISetting] = useConfigureUISetting();

  const savedFilters = data?.findSavedFilters ?? [];

  async function onSaveFilter(name: string, id?: string) {
    const filterCopy = filter.clone();

    try {
      setSaving(true);
      await saveFilter(filterCopy, name, id);

      Toast.success(
        intl.formatMessage(
          {
            id: "toast.saved_entity",
          },
          {
            entity: intl.formatMessage({ id: "filter" }).toLocaleLowerCase(),
          }
        )
      );
      setFilterName("");
      setOverwritingFilter(undefined);
      refetch();
    } catch (err) {
      Toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteFilter(f: SavedFilterDataFragment) {
    try {
      setSaving(true);

      await destroyFilter({
        variables: {
          input: {
            id: f.id,
          },
        },
      });

      Toast.success(
        intl.formatMessage(
          {
            id: "toast.delete_past_tense",
          },
          {
            count: 1,
            singularEntity: intl.formatMessage({ id: "filter" }),
            pluralEntity: intl.formatMessage({ id: "filters" }),
          }
        )
      );
      refetch();
    } catch (err) {
      Toast.error(err);
    } finally {
      setSaving(false);
      setDeletingFilter(undefined);
    }
  }

  async function onSetDefaultFilter() {
    if (!view) {
      return;
    }

    const filterCopy = filter.clone();

    try {
      setSaving(true);

      await saveUISetting({
        variables: {
          key: `defaultFilters.${view.toString()}`,
          value: {
            mode: filter.mode,
            find_filter: filterCopy.makeFindFilter(),
            object_filter: filterCopy.makeSavedFilter(),
            ui_options: filterCopy.makeSavedUIOptions(),
          },
        },
      });

      Toast.success(
        intl.formatMessage({
          id: "toast.default_filter_set",
        })
      );
    } catch (err) {
      Toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  function filterClicked(f: SavedFilterDataFragment) {
    const newFilter = filter.clone();

    newFilter.currentPage = 1;
    // #1795 - reset search term if not present in saved filter
    newFilter.searchTerm = "";
    newFilter.configureFromSavedFilter(f);
    // #1507 - reset random seed when loaded
    newFilter.randomSeed = -1;

    onSetFilter(newFilter);
  }

  interface ISavedFilterItem {
    item: SavedFilterDataFragment;
  }
  const SavedFilterItem: React.FC<ISavedFilterItem> = ({ item }) => {
    return (
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <MenuItem onClick={() => filterClicked(item)} title={item.name} sx={{ flexGrow: 1, overflow: 'hidden' }}>
          <Typography noWrap>{item.name}</Typography>
        </MenuItem>
        <ButtonGroup size="small">
          <IconButton
            size="small"
            title={intl.formatMessage({ id: "actions.overwrite" })}
            onClick={(e) => {
              setOverwritingFilter(item);
              e.stopPropagation();
            }}
          >
            <Icon icon={faSave} />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            title={intl.formatMessage({ id: "actions.delete" })}
            onClick={(e) => {
              setDeletingFilter(item);
              e.stopPropagation();
            }}
          >
            <Icon icon={faTimes} />
          </IconButton>
        </ButtonGroup>
      </Box>
    );
  };

  function renderSavedFilters() {
    if (error) return <Typography variant="h6" align="center">{error.message}</Typography>;

    if (loading || saving) {
      return (
        <Box display="flex" justifyContent="center" p={2}>
          <LoadingIndicator message="" />
        </Box>
      );
    }

    return (
      <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0, mb: 1, maxHeight: "230px", overflowY: "auto" }}>
        {savedFilters
          .filter(
            (f) =>
              !filterName ||
              f.name.toLowerCase().includes(filterName.toLowerCase())
          )
          .map((f) => (
            <SavedFilterItem key={f.name} item={f} />
          ))}
      </Box>
    );
  }

  function maybeRenderSetDefaultButton() {
    if (view) {
      return (
        <Box mt={1}>
          <Button
            title={intl.formatMessage({ id: "actions.set_as_default" })}
            variant="contained"
            color="secondary"
            size="small"
            onClick={() => onSetDefaultFilter()}
            sx={{ float: "right" }}
          >
            {intl.formatMessage({ id: "actions.set_as_default" })}
          </Button>
        </Box>
      );
    }
  }

  return (
    <>
      <DeleteAlert
        deletingFilter={deletingFilter}
        onClose={(confirm) => {
          if (confirm) {
            onDeleteFilter(deletingFilter!);
          }
          setDeletingFilter(undefined);
        }}
      />
      <OverwriteAlert
        overwritingFilter={overwritingFilter}
        onClose={(confirm) => {
          if (confirm) {
            onSaveFilter(overwritingFilter!.name, overwritingFilter!.id);
          }
          setOverwritingFilter(undefined);
        }}
      />
      <Box display="flex" alignItems="center" gap={0.5}>
        <TextField
          size="small"
          placeholder={`${intl.formatMessage({ id: "filter_name" })}…`}
          value={filterName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterName(e.target.value)}
          sx={{ flex: 1 }}
        />
        <Tooltip title={<FormattedMessage id="actions.save_filter" />}>
          <span>
            <Button
              disabled={
                !filterName || !!savedFilters.find((f) => f.name === filterName)
              }
              variant="contained"
              color="secondary"
              size="small"
              onClick={() => {
                onSaveFilter(filterName);
              }}
            >
              <Icon icon={faSave} />
            </Button>
          </span>
        </Tooltip>
      </Box>
      {renderSavedFilters()}
      {maybeRenderSetDefaultButton()}
    </>
  );
};

interface ISavedFilterItem {
  item: SavedFilterDataFragment;
  onClick: () => void;
  onDelete: () => void;
  selected?: boolean;
}

const SavedFilterItem: React.FC<ISavedFilterItem> = ({
  item,
  onClick,
  onDelete,
  selected = false,
}) => {
  const intl = useIntl();

  return (
    <Box component="li" sx={{ mb: 0.5 }}>
      <Box
        onClick={onClick}
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          height: "2em",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", overflow: "hidden", pl: "28.7px" }}>
          <TruncatedInlineText
            className={cx({ selected })}
            text={item.name}
          />
        </Box>
        <Box>
          <IconButton
            size="small"
            color="error"
            title={intl.formatMessage({ id: "actions.delete" })}
            onClick={(e) => {
              onDelete();
              e.stopPropagation();
            }}
          >
            <Icon fixedWidth icon={faTimes} />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
};

const SavedFilters: React.FC<{
  error?: string;
  loading?: boolean;
  saving?: boolean;
  savedFilters: SavedFilterDataFragment[];
  onFilterClicked: (f: SavedFilterDataFragment) => void;
  onDeleteClicked: (f: SavedFilterDataFragment) => void;
  currentFilterID?: string;
}> = ({
  error,
  loading,
  saving,
  savedFilters,
  onFilterClicked,
  onDeleteClicked,
  currentFilterID,
}) => {
    if (error) return <Typography variant="h6" align="center">{error}</Typography>;

    if (loading || saving) {
      return (
        <Box display="flex" justifyContent="center" p={2}>
          <LoadingIndicator message="" />
        </Box>
      );
    }

    return (
      <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0, mb: 0.5, maxHeight: "300px", overflowY: "auto" }}>
        {savedFilters.map((f) => (
          <SavedFilterItem
            key={f.name}
            item={f}
            onClick={() => onFilterClicked(f)}
            onDelete={() => onDeleteClicked(f)}
            selected={currentFilterID === f.id}
          />
        ))}
      </Box>
    );
  };

export const SidebarSavedFilterList: React.FC<ISavedFilterListProps> = ({
  filter,
  onSetFilter,
  view,
}) => {
  const Toast = useToast();
  const intl = useIntl();

  const [currentSavedFilter, setCurrentSavedFilter] = useState<{
    id: string;
    name?: string;
    set: boolean;
  }>();

  const { data, error, loading, refetch } = useFindSavedFilters(filter.mode);

  const [filterName, setFilterName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingFilter, setDeletingFilter] = useState<
    SavedFilterDataFragment | undefined
  >();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);

  const saveFilter = useSaveFilter();
  const [destroyFilter] = useSavedFilterDestroy();
  const [saveUISetting] = useConfigureUISetting();

  const filteredFilters = useMemo(() => {
    const savedFilters = data?.findSavedFilters ?? [];
    if (!filterName) return savedFilters;

    return savedFilters.filter(
      (f) =>
        !filterName || f.name.toLowerCase().includes(filterName.toLowerCase())
    );
  }, [data?.findSavedFilters, filterName]);

  // handle when filter is changed to de-select the current filter
  useEffect(() => {
    // HACK - first change will be from setting the filter
    // second change is likely from somewhere else
    setCurrentSavedFilter((v) => {
      if (!v) return v;

      if (v.set) {
        return { ...v, set: false };
      } else {
        return undefined;
      }
    });
  }, [filter]);

  async function onSaveFilter(name: string, id?: string) {
    try {
      setSaving(true);
      await saveFilter(filter, name, id);

      Toast.success(
        intl.formatMessage(
          {
            id: "toast.saved_entity",
          },
          {
            entity: intl.formatMessage({ id: "filter" }).toLocaleLowerCase(),
          }
        )
      );
      setFilterName("");
      setShowSaveDialog(false);
      refetch();
    } catch (err) {
      Toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteFilter(f: SavedFilterDataFragment) {
    try {
      setSaving(true);

      await destroyFilter({
        variables: {
          input: {
            id: f.id,
          },
        },
      });

      Toast.success(
        intl.formatMessage(
          {
            id: "toast.delete_past_tense",
          },
          {
            count: 1,
            singularEntity: intl.formatMessage({ id: "filter" }),
            pluralEntity: intl.formatMessage({ id: "filters" }),
          }
        )
      );
      refetch();
    } catch (err) {
      Toast.error(err);
    } finally {
      setSaving(false);
      setDeletingFilter(undefined);
    }
  }

  async function onSetDefaultFilter() {
    if (!view) {
      return;
    }

    const filterCopy = filter.clone();

    try {
      setSaving(true);

      await saveUISetting({
        variables: {
          key: `defaultFilters.${view.toString()}`,
          value: {
            mode: filter.mode,
            find_filter: filterCopy.makeFindFilter(),
            object_filter: filterCopy.makeSavedFilter(),
            ui_options: filterCopy.makeSavedUIOptions(),
          },
        },
      });

      Toast.success(
        intl.formatMessage({
          id: "toast.default_filter_set",
        })
      );
    } catch (err) {
      Toast.error(err);
    } finally {
      setSaving(false);
      setSettingDefault(false);
    }
  }

  function filterClicked(f: SavedFilterDataFragment) {
    const newFilter = filter.clone();

    newFilter.currentPage = 1;
    // #1795 - reset search term if not present in saved filter
    newFilter.searchTerm = "";
    newFilter.configureFromSavedFilter(f);
    // #1507 - reset random seed when loaded
    newFilter.randomSeed = -1;

    setCurrentSavedFilter({ id: f.id, name: f.name, set: true });
    onSetFilter(newFilter);
  }

  return (
    <Box>
      <DeleteAlert
        deletingFilter={deletingFilter}
        onClose={(confirm) => {
          if (confirm) {
            onDeleteFilter(deletingFilter!);
          }
          setDeletingFilter(undefined);
        }}
      />
      {showSaveDialog && (
        <SaveFilterDialog
          mode={filter.mode}
          onClose={(name, id) => {
            setShowSaveDialog(false);
            if (name) {
              onSaveFilter(name, id);
            }
          }}
        />
      )}
      <AlertModal
        show={!!settingDefault}
        text={<FormattedMessage id="dialogs.set_default_filter_confirm" />}
        confirmVariant="primary"
        onConfirm={() => onSetDefaultFilter()}
        onCancel={() => setSettingDefault(false)}
      />

      <Box display="flex" justifyContent="space-between" alignItems="center" p={1}>
        <Button
          variant="text"
          size="small"
          onClick={() => setShowSaveDialog(true)}
          sx={{ fontWeight: "bold", color: "text.primary" }}
        >
          <Icon icon={faBookmark} />
          <FormattedMessage id="actions.save" />
        </Button>
        <Box>
          {view && (
            <Button
              variant="text"
              size="small"
              onClick={() => setSettingDefault(true)}
              title={intl.formatMessage({ id: "actions.set_as_default" })}
              sx={{ fontWeight: "bold", color: "text.primary" }}
            >
              <FormattedMessage id="default" />
            </Button>
          )}
        </Box>
      </Box>

      <Box mb={1}>
        <TextField
          value={filterName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterName(e.target.value)}
          size="small"
          fullWidth
          placeholder={intl.formatMessage({ id: "actions.search" })}
        />
      </Box>

      {currentSavedFilter && (
        <SavedFilters
          savedFilters={[
            {
              id: currentSavedFilter.id,
              name: currentSavedFilter.name ?? "",
              mode: filter.mode,
            },
          ]}
          onFilterClicked={() => setCurrentSavedFilter(undefined)}
          onDeleteClicked={() => setCurrentSavedFilter(undefined)}
          // always show the current filter as selected
          currentFilterID={currentSavedFilter.id}
        />
      )}

      <SavedFilters
        error={error?.message}
        loading={loading}
        saving={saving}
        savedFilters={filteredFilters}
        onFilterClicked={filterClicked}
        onDeleteClicked={(f) => setDeletingFilter(f)}
      />
    </Box>
  );
};

export const SavedFilterDropdown: React.FC<ISavedFilterListProps> = (props) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const menu = (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={handleClose}
      PaperProps={{
        sx: { width: "300px", display: "flex", flexDirection: "column" }
      }}
    >
      <Box p={1}>
        <SavedFilterList {...props} />
      </Box>
    </Menu>
  );

  return (
    <Box>
      <Tooltip title={<FormattedMessage id="search_filter.saved_filters" />}>
        <Button
          variant="contained"
          color="secondary"
          onClick={handleClick}
        >
          <Icon icon={faBookmark} />
        </Button>
      </Tooltip>
      {props.menuPortalTarget
        ? createPortal(menu, props.menuPortalTarget)
        : menu}
    </Box>
  );
};
