import React, { useState } from "react";
import { IconButton } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import {
  FileBrowserRowMenu,
  IContentRowActions,
} from "./FileBrowserRowMenu";

export type { IContentRowActions };

interface IFileBrowserRowActionsProps {
  row: IContentRowActions;
  onRefetch: () => void;
  onShowDetails?: () => void;
}

export const FileBrowserRowActions: React.FC<IFileBrowserRowActionsProps> = ({
  row,
  onRefetch,
  onShowDetails,
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          setAnchorEl(e.currentTarget);
        }}
        aria-label="row actions"
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>

      <FileBrowserRowMenu
        row={row}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        onRefetch={onRefetch}
        onShowDetails={onShowDetails}
        anchorEl={anchorEl}
      />
    </>
  );
};
