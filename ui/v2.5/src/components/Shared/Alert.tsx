import { Button, Dialog, DialogActions, DialogContent, DialogContentText } from "@mui/material";
import { FormattedMessage } from "react-intl";
import { PatchComponent } from "src/patch";

export interface IAlertModalProps {
  text: JSX.Element | string;
  confirmVariant?: "inherit" | "primary" | "secondary" | "success" | "error" | "info" | "warning";
  show?: boolean;
  confirmButtonText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const AlertModal: React.FC<IAlertModalProps> = PatchComponent(
  "AlertModal",
  ({
    text,
    show,
    confirmVariant = "error",
    confirmButtonText,
    onConfirm,
    onCancel,
  }) => {
    return (
      <Dialog open={!!show} onClose={onCancel}>
        <DialogContent>
          <DialogContentText>{text}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color={confirmVariant} onClick={() => onConfirm()}>
            {confirmButtonText ?? <FormattedMessage id="actions.confirm" />}
          </Button>
          <Button variant="text" onClick={() => onCancel()}>
            <FormattedMessage id="actions.cancel" />
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
);
