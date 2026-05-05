import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  TextField,
  Typography,
} from "@mui/material";
import * as GQL from "src/core/generated-graphql";

interface IFileBrowserRenameFileDialogProps {
  open: boolean;
  onClose: () => void;
  fileId: string;
  parentFolderId: string;
  currentBasename: string;
  onSuccess: () => void;
}

export const FileBrowserRenameFileDialog: React.FC<
  IFileBrowserRenameFileDialogProps
> = ({ open, onClose, fileId, parentFolderId, currentBasename, onSuccess }) => {
  const { stem, ext } = useMemo(() => {
    const lastDot = currentBasename.lastIndexOf(".");
    if (lastDot <= 0) return { stem: currentBasename, ext: "" };
    return {
      stem: currentBasename.slice(0, lastDot),
      ext: currentBasename.slice(lastDot), // includes the dot
    };
  }, [currentBasename]);

  const [newStem, setNewStem] = useState(stem);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNewStem(stem);
      setError(null);
    }
  }, [open, stem]);

  const [moveFiles, { loading }] = GQL.useFileBrowserMoveFilesMutation();

  const handleSubmit = async () => {
    const trimmed = newStem.trim();
    if (!trimmed) {
      setError("Filename cannot be empty");
      return;
    }
    setError(null);
    try {
      await moveFiles({
        variables: {
          input: {
            ids: [fileId],
            destination_folder_id: parentFolderId,
            destination_basename: trimmed + ext,
          },
        },
      });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "An error occurred");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Rename File on Disk</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          autoFocus
          fullWidth
          label="Filename"
          value={newStem}
          onChange={(e) => setNewStem(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          sx={{ mt: 1 }}
          slotProps={{
            input: ext
              ? {
                  endAdornment: (
                    <InputAdornment position="end">
                      <Typography variant="body2" color="text.secondary">
                        {ext}
                      </Typography>
                    </InputAdornment>
                  ),
                }
              : undefined,
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading || !newStem.trim()}
        >
          {loading ? "Renaming…" : "Rename"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
