import React, { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Button,
  Collapse,
  TextField,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  IconButton,
  Box,
  Typography,
} from "@mui/material";
import { Icon } from "../Icon";
import { LoadingIndicator } from "../LoadingIndicator";
import { faEllipsis, faTimes } from "@fortawesome/free-solid-svg-icons";
import { useDebounce } from "src/hooks/debounce";
import TextUtils from "src/utils/text";
import { useDirectoryPaths } from "./useDirectoryPaths";
import { PatchComponent } from "src/patch";

interface IProps {
  currentDirectory: string;
  onChangeDirectory: (value: string) => void;
  defaultDirectories?: string[];
  appendButton?: JSX.Element;
  collapsible?: boolean;
  quotePath?: boolean;
  hideError?: boolean;
}

const _FolderSelect: React.FC<IProps> = ({
  currentDirectory,
  onChangeDirectory,
  defaultDirectories = [],
  appendButton,
  collapsible = false,
  quotePath = false,
  hideError = false,
}) => {
  const intl = useIntl();
  const [showBrowser, setShowBrowser] = useState(false);
  const [path, setPath] = useState(currentDirectory);

  // Sync internal state with prop changes
  React.useEffect(() => {
    setPath(currentDirectory);
  }, [currentDirectory]);

  const normalizedPath = quotePath ? TextUtils.stripQuotes(path) : path;
  const { directories, parent, error, loading } = useDirectoryPaths(
    normalizedPath,
    hideError
  );

  const selectableDirectories =
    (currentDirectory ? directories : defaultDirectories) ?? defaultDirectories;

  const debouncedSetDirectory = useDebounce(setPath, 250);

  function setInstant(value: string) {
    const normalizedValue =
      quotePath && value.includes(" ") ? TextUtils.addQuotes(value) : value;
    onChangeDirectory(normalizedValue);
    setPath(normalizedValue);
  }

  function setDebounced(value: string) {
    onChangeDirectory(value);
    debouncedSetDirectory(value);
  }

  function goUp() {
    if (defaultDirectories?.includes(currentDirectory)) {
      setInstant("");
    } else if (parent) {
      setInstant(parent);
    }
  }

  const topDirectory = currentDirectory && parent && (
    <ListItem disablePadding className="folder-list-parent" dense>
      <ListItemButton onClick={() => goUp()} disabled={loading}>
        <ListItemText
          primary={<FormattedMessage id="setup.folder.up_dir" />}
        />
      </ListItemButton>
    </ListItem>
  );

  return (
    <>
      <TextField
        fullWidth
        variant="outlined"
        size="small"
        placeholder={intl.formatMessage({ id: "setup.folder.file_path" })}
        onChange={(e) => {
          setDebounced(e.currentTarget.value);
        }}
        value={currentDirectory}
        InputProps={{
          spellCheck: false,
          endAdornment: (
            <InputAdornment position="end">
              {appendButton}
              {collapsible && (
                <IconButton
                  onClick={() => setShowBrowser(!showBrowser)}
                  size="small"
                >
                  <Icon icon={faEllipsis} />
                </IconButton>
              )}
              {(loading || error) && (
                <Box display="flex" alignItems="center" ml={1}>
                  {loading ? (
                    <LoadingIndicator inline small message="" />
                  ) : (
                    !hideError && (
                      <Icon icon={faTimes} color="red" className="ml-3" />
                    )
                  )}
                </Box>
              )}
            </InputAdornment>
          ),
        }}
      />

      {!hideError && error !== undefined && (
        <Typography variant="h6" color="error" className="mt-4 text-break">
          Error: {error.message}
        </Typography>
      )}

      <Collapse in={!collapsible || showBrowser}>
        <List dense className="folder-list">
          {topDirectory}
          {selectableDirectories.map((dir) => (
            <ListItem
              key={dir}
              disablePadding
              className="folder-list-item"
            >
              <ListItemButton
                onClick={() => setInstant(dir)}
                disabled={loading}
              >
                <ListItemText primary={dir} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Collapse>
    </>
  );
};

export const FolderSelect = PatchComponent("FolderSelect", _FolderSelect);

