import React, { useState } from "react";
import {
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from "@mui/material";
import DriveFileMoveIcon from "@mui/icons-material/DriveFileMove";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import EditIcon from "@mui/icons-material/Edit";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { FileBrowserRenameDialog } from "./FileBrowserRenameDialog";
import { FileBrowserRenameFileDialog } from "./FileBrowserRenameFileDialog";
import { FolderPickerDialog } from "./FolderPickerDialog";

export interface IContentRowActions {
  id: string;
  type: "scene" | "image" | "gallery";
  title: string | null;
  basename: string;
  fileId: string;
  parentFolderId: string;
}

interface IFileBrowserRowActionsProps {
  row: IContentRowActions;
  onRefetch: () => void;
}

export const FileBrowserRowActions: React.FC<IFileBrowserRowActionsProps> = ({
  row,
  onRefetch,
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameFileOpen, setRenameFileOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const menuOpen = Boolean(anchorEl);

  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
  };

  const handleMenuClose = () => setAnchorEl(null);

  const handleSuccess = () => {
    handleMenuClose();
    onRefetch();
  };

  return (
    <>
      <IconButton
        size="small"
        onClick={handleMenuOpen}
        aria-label="row actions"
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>

      <Menu
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={handleMenuClose}
        onClick={(e) => e.stopPropagation()}
        disableScrollLock
        slotProps={{
          backdrop: { sx: { backgroundColor: "transparent", backdropFilter: "none" } },
        }}
      >
        <MenuItem
          onClick={() => {
            setRenameOpen(true);
            handleMenuClose();
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Rename Title</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setRenameFileOpen(true);
            handleMenuClose();
          }}
        >
          <ListItemIcon>
            <DriveFileRenameOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Rename File</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMoveOpen(true);
            handleMenuClose();
          }}
        >
          <ListItemIcon>
            <DriveFileMoveIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Move To…</ListItemText>
        </MenuItem>
      </Menu>

      <FileBrowserRenameDialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        type={row.type}
        id={row.id}
        currentTitle={row.title ?? row.basename}
        onSuccess={handleSuccess}
      />

      <FileBrowserRenameFileDialog
        open={renameFileOpen}
        onClose={() => setRenameFileOpen(false)}
        fileId={row.fileId}
        parentFolderId={row.parentFolderId}
        currentBasename={row.basename}
        onSuccess={handleSuccess}
      />

      <FolderPickerDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        fileIds={[row.fileId]}
        onSuccess={handleSuccess}
      />
    </>
  );
};
