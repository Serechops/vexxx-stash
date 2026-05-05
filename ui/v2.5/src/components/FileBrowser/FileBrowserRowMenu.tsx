import React, { useState } from "react";
import {
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DriveFileMoveIcon from "@mui/icons-material/DriveFileMove";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import EditIcon from "@mui/icons-material/Edit";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
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
  filePath?: string;
}

interface IFileBrowserRowMenuProps {
  row: IContentRowActions;
  open: boolean;
  onClose: () => void;
  onRefetch: () => void;
  onShowDetails?: () => void;
  /** For MoreVert-button trigger */
  anchorEl?: HTMLElement | null;
  /** For right-click context menu trigger */
  anchorPosition?: { top: number; left: number };
}

export const FileBrowserRowMenu: React.FC<IFileBrowserRowMenuProps> = ({
  row,
  open,
  onClose,
  onRefetch,
  onShowDetails,
  anchorEl,
  anchorPosition,
}) => {
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameFileOpen, setRenameFileOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const handleSuccess = () => {
    onClose();
    onRefetch();
  };

  const handleCopyPath = () => {
    if (row.filePath) {
      navigator.clipboard.writeText(row.filePath).catch(() => {});
    }
    onClose();
  };

  return (
    <>
      <Menu
        open={open}
        onClose={onClose}
        onClick={(e) => e.stopPropagation()}
        disableScrollLock
        {...(anchorPosition
          ? { anchorReference: "anchorPosition", anchorPosition }
          : { anchorEl })}
        slotProps={{
          backdrop: {
            sx: { backgroundColor: "transparent", backdropFilter: "none" },
          },
        }}
      >
        {onShowDetails && (
          <MenuItem
            onClick={() => {
              onShowDetails();
              onClose();
            }}
          >
            <ListItemIcon>
              <InfoOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Show Details</ListItemText>
          </MenuItem>
        )}
        {onShowDetails && <Divider />}
        <MenuItem
          onClick={() => {
            setRenameOpen(true);
            onClose();
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
            onClose();
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
            onClose();
          }}
        >
          <ListItemIcon>
            <DriveFileMoveIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Move To…</ListItemText>
        </MenuItem>
        {row.filePath && (
          <MenuItem onClick={handleCopyPath}>
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Copy Path</ListItemText>
          </MenuItem>
        )}
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
