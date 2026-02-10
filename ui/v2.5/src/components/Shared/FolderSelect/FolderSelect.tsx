import React, { useState, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
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
  Chip,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloseIcon from "@mui/icons-material/Close";
import { LoadingIndicator } from "../LoadingIndicator";
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
  // Start expanded when collapsible, so users can see directory contents immediately
  const [showBrowser, setShowBrowser] = useState(true);
  const [path, setPath] = useState(currentDirectory);

  // Sync internal state with prop changes
  useEffect(() => {
    setPath(currentDirectory);
  }, [currentDirectory]);

  const normalizedPath = quotePath ? TextUtils.stripQuotes(path) : path;
  const { directories, parent, error, loading } = useDirectoryPaths(
    normalizedPath,
    hideError
  );

  // When at root (empty path) and default directories are configured, show them
  // instead of the query result (which returns the home directory for empty path)
  const isAtRoot = !normalizedPath && defaultDirectories.length > 0;
  const selectableDirectories = isAtRoot
    ? defaultDirectories
    : (directories ?? defaultDirectories);
  const hasDirectories = selectableDirectories.length > 0;
  const isValidPath = !error && !loading && currentDirectory.length > 0;

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
    <ListItem disablePadding dense>
      <ListItemButton onClick={() => goUp()} disabled={loading}>
        <ListItemText
          primary={<FormattedMessage id="setup.folder.up_dir" />}
          sx={{ fontWeight: 500 }}
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
              {/* Show status indicators */}
              <Box display="flex" alignItems="center" gap={0.5}>
                {loading && (
                  <LoadingIndicator inline small message="" />
                )}
                {!loading && isValidPath && (
                  <CheckCircleIcon fontSize="small" color="success" />
                )}
                {!loading && error && !hideError && (
                  <CloseIcon fontSize="small" color="error" />
                )}
                {collapsible && hasDirectories && (
                  <IconButton
                    onClick={() => setShowBrowser(!showBrowser)}
                    size="small"
                    title={showBrowser 
                      ? intl.formatMessage({ id: "actions.hide" }) 
                      : intl.formatMessage({ id: "actions.show" })}
                  >
                    {showBrowser ? (
                      <ExpandLessIcon fontSize="small" />
                    ) : (
                      <ExpandMoreIcon fontSize="small" />
                    )}
                  </IconButton>
                )}
              </Box>
            </InputAdornment>
          ),
        }}
      />

      {/* Show subdirectory count when collapsed */}
      {collapsible && !showBrowser && hasDirectories && (
        <Box sx={{ mt: 0.5 }}>
          <Chip
            size="small"
            label={intl.formatMessage(
              { id: "folder_select.subdirectories_available" },
              { count: selectableDirectories.length }
            )}
            onClick={() => setShowBrowser(true)}
            sx={{ cursor: "pointer" }}
          />
        </Box>
      )}

      {!hideError && error !== undefined && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
          {error.message}
        </Typography>
      )}

      <Collapse in={!collapsible || showBrowser}>
        {hasDirectories ? (
          <List
            dense
            sx={{
              listStyleType: "none",
              margin: 0,
              maxHeight: "30vh",
              overflowY: "auto",
              overflowX: "hidden",
              paddingBottom: "0.5rem",
              paddingTop: "1rem",
              "&::-webkit-scrollbar": {
                width: "8px",
              },
              "&::-webkit-scrollbar-thumb": {
                background: "#888",
                borderRadius: "4px",
              }
            }}
          >
            {topDirectory}
            {selectableDirectories.map((dir) => (
              <ListItem
                key={dir}
                disablePadding
              >
                <ListItemButton
                  onClick={() => setInstant(dir)}
                  disabled={loading}
                  sx={{
                    whiteSpace: "nowrap",
                    "& .MuiListItemText-primary": {
                      "&::before": {
                        content: '"├ \uD83D\uDCC1"',
                        display: "inline-block",
                        paddingRight: "1rem",
                        transform: "scale(1.5)",
                      }
                    },
                    "&:last-child .MuiListItemText-primary::before": {
                      content: '"└ \uD83D\uDCC1"',
                    }
                  }}
                >
                  <ListItemText 
                    primary={dir} 
                    sx={{ 
                      "& .MuiTypography-root": { 
                        color: "text.primary", 
                        fontWeight: 400,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      } 
                    }} 
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        ) : !loading && currentDirectory && !error ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontStyle: "italic" }}>
            <FormattedMessage id="folder_select.no_subdirectories" />
          </Typography>
        ) : null}
      </Collapse>
    </>
  );
};

export const FolderSelect = PatchComponent("FolderSelect", _FolderSelect);

