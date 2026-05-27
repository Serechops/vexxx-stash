import React, { useState } from "react";
import { FormattedMessage } from "react-intl";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  TextField,
  InputAdornment,
  IconButton,
  Typography,
  Divider,
  CircularProgress,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import { useDirectory } from "src/core/StashService";

interface IProps {
  /** Title for the dialog */
  title?: string;
  /** Initial directory to browse */
  defaultDirectory?: string;
  /** File extensions to filter (e.g. [".funscript", ".srt"]). If empty all files are shown. */
  extensions?: string[];
  /** Called with the selected full file path, or undefined if cancelled */
  onClose: (filePath?: string) => void;
}

export const FileSelectDialog: React.FC<IProps> = ({
  title,
  defaultDirectory = "",
  extensions = [],
  onClose,
}) => {
  const [currentDirectory, setCurrentDirectory] = useState(defaultDirectory);
  const [selectedFile, setSelectedFile] = useState<string | undefined>();

  const { data, loading } = useDirectory(currentDirectory, extensions.length > 0 ? extensions : undefined);

  const dirs = data?.directory.directories ?? [];
  const files = data?.directory.files ?? [];
  const parent = data?.directory.parent;

  function navigateTo(dir: string) {
    setCurrentDirectory(dir);
    setSelectedFile(undefined);
  }

  function confirm() {
    if (selectedFile) {
      onClose(selectedFile);
    }
  }

  return (
    <Dialog open onClose={() => onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{title ?? "Select File"}</DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 1 }}>
          {/* Path display + up button */}
          <TextField
            fullWidth
            size="small"
            value={currentDirectory}
            onChange={(e) => { setCurrentDirectory(e.target.value); setSelectedFile(undefined); }}
            sx={{ mb: 1 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <IconButton
                    size="small"
                    disabled={!parent}
                    onClick={() => parent && navigateTo(parent)}
                    title="Go up"
                  >
                    <ArrowUpwardIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <List dense sx={{ maxHeight: 380, overflow: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
              {dirs.map((dir) => (
                <ListItem key={dir} disablePadding>
                  <ListItemButton onClick={() => navigateTo(dir)}>
                    <FolderIcon fontSize="small" sx={{ mr: 1, color: "text.secondary" }} />
                    <ListItemText primary={dir.split(/[\\/]/).pop()} />
                  </ListItemButton>
                </ListItem>
              ))}
              {dirs.length > 0 && files.length > 0 && <Divider />}
              {files.length === 0 && dirs.length === 0 && (
                <ListItem>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                    No matching files
                  </Typography>
                </ListItem>
              )}
              {files.map((file) => (
                <ListItem key={file} disablePadding>
                  <ListItemButton
                    selected={selectedFile === file}
                    onClick={() => setSelectedFile(file)}
                  >
                    <InsertDriveFileIcon fontSize="small" sx={{ mr: 1, color: "text.secondary" }} />
                    <ListItemText primary={file.split(/[\\/]/).pop()} secondary={file} secondaryTypographyProps={{ noWrap: true, fontSize: "0.7rem" }} />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}

          {/* Selected file path display */}
          {selectedFile && (
            <TextField
              fullWidth
              size="small"
              label="Selected file"
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
              sx={{ mt: 1 }}
            />
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="secondary" onClick={() => onClose()}>
          <FormattedMessage id="actions.cancel" />
        </Button>
        <Button
          variant="contained"
          color="primary"
          disabled={!selectedFile}
          onClick={confirm}
        >
          <FormattedMessage id="actions.confirm" />
        </Button>
      </DialogActions>
    </Dialog>
  );
};
