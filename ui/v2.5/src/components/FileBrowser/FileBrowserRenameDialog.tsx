import React, { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import * as GQL from "src/core/generated-graphql";

interface IFileBrowserRenameDialogProps {
  open: boolean;
  onClose: () => void;
  type: "scene" | "image" | "gallery";
  id: string;
  currentTitle: string;
  onSuccess: () => void;
}

export const FileBrowserRenameDialog: React.FC<
  IFileBrowserRenameDialogProps
> = ({ open, onClose, type, id, currentTitle, onSuccess }) => {
  const [title, setTitle] = useState(currentTitle);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(currentTitle);
      setError(null);
    }
  }, [open, currentTitle]);

  const [updateScene, { loading: sceneLoading }] =
    GQL.useFileBrowserSceneUpdateTitleMutation();
  const [updateImage, { loading: imageLoading }] =
    GQL.useFileBrowserImageUpdateTitleMutation();
  const [updateGallery, { loading: galleryLoading }] =
    GQL.useFileBrowserGalleryUpdateTitleMutation();

  const loading = sceneLoading || imageLoading || galleryLoading;

  const handleSubmit = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title cannot be empty");
      return;
    }
    setError(null);
    try {
      if (type === "scene") {
        await updateScene({ variables: { input: { id, title: trimmed } } });
      } else if (type === "image") {
        await updateImage({ variables: { input: { id, title: trimmed } } });
      } else {
        await updateGallery({ variables: { input: { id, title: trimmed } } });
      }
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "An error occurred");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Rename Title</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          autoFocus
          fullWidth
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading || !title.trim()}
        >
          {loading ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
