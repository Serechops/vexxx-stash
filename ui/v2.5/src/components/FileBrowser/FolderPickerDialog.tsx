import React, { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { FileBrowserTree } from "./FileBrowserTree";

interface IFolderPickerDialogProps {
  open: boolean;
  onClose: () => void;
  fileIds: string[];
  onSuccess: () => void;
}

export const FolderPickerDialog: React.FC<IFolderPickerDialogProps> = ({
  open,
  onClose,
  fileIds,
  onSuccess,
}) => {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [moveFiles, { loading }] = GQL.useFileBrowserMoveFilesMutation();

  const handleClose = () => {
    setSelectedFolderId(null);
    setError(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (!selectedFolderId) return;
    setError(null);
    try {
      await moveFiles({
        variables: {
          input: {
            ids: fileIds,
            destination_folder_id: selectedFolderId,
          },
        },
      });
      handleClose();
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "An error occurred");
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Move To Folder</DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        {error && (
          <Alert severity="error" sx={{ m: 2, mb: 0 }}>
            {error}
          </Alert>
        )}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ px: 2, pt: 1.5, display: "block" }}
        >
          Select a destination folder
        </Typography>
        <Box sx={{ maxHeight: 400, overflow: "auto", mt: 0.5 }}>
          <FileBrowserTree
            selectedId={selectedFolderId}
            onSelect={setSelectedFolderId}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={loading || !selectedFolderId}
        >
          {loading ? "Moving…" : "Move Here"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
