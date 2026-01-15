import React, { useState } from "react";
import { FormattedMessage } from "react-intl";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  DialogProps,
} from "@mui/material";
import { FolderSelect } from "./FolderSelect";

interface IProps {
  defaultValue?: string;
  onClose: (directory?: string) => void;
  modalProps?: Partial<DialogProps>;
}

export const FolderSelectDialog: React.FC<IProps> = ({
  defaultValue: currentValue,
  onClose,
  modalProps,
}) => {
  const [currentDirectory, setCurrentDirectory] = useState<string>(
    currentValue ?? ""
  );

  return (
    <Dialog open onClose={() => onClose()} {...modalProps} fullWidth maxWidth="sm">
      <DialogTitle>Select Directory</DialogTitle>
      <DialogContent>
        <div className="dialog-content" style={{ marginTop: 8 }}>
          <FolderSelect
            currentDirectory={currentDirectory}
            onChangeDirectory={setCurrentDirectory}
            collapsible
          />
        </div>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="secondary" onClick={() => onClose()}>
          <FormattedMessage id="actions.cancel" />
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={() => onClose(currentDirectory)}
        >
          <FormattedMessage id="actions.confirm" />
        </Button>
      </DialogActions>
    </Dialog>
  );
};

