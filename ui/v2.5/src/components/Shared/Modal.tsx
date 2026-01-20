import { Button, Dialog, DialogTitle, DialogContent, DialogActions, Box, IconButton, Tooltip, CircularProgress, SxProps, Theme } from "@mui/material";
import { Breakpoint } from "@mui/material/styles";
import { Icon } from "./Icon";
import { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FormattedMessage } from "react-intl";
import React from "react";

interface IButton {
  text?: string;
  variant?: string;
  onClick?: () => void;
}

interface IModal {
  show: boolean;
  onHide?: () => void;
  header?: JSX.Element | string;
  icon?: IconDefinition | React.ReactNode;
  cancel?: IButton;
  accept?: IButton;
  isRunning?: boolean;
  disabled?: boolean;
  maxWidth?: Breakpoint;
  dialogClassName?: string;
  footerButtons?: React.ReactNode;
  leftFooterButtons?: React.ReactNode;
  hideAccept?: boolean;
  modalProps?: any; // Shim for backward compatibility
  sx?: SxProps<Theme>;
}

// Helper to check if icon is a FontAwesome IconDefinition
function isFaIcon(icon: any): icon is IconDefinition {
  return icon && typeof icon === "object" && "iconName" in icon && "prefix" in icon;
}

const defaultOnHide = () => { };

export const ModalComponent: React.FC<IModal> = ({
  children,
  show,
  icon,
  header,
  cancel,
  accept,
  onHide,
  isRunning,
  disabled,
  maxWidth = "sm",
  dialogClassName,
  footerButtons,
  leftFooterButtons,
  hideAccept,
  modalProps,
  sx,
}) => {
  // Map RB size to MUI maxWidth
  let calculatedMaxWidth = maxWidth;
  if (modalProps?.size === "lg") calculatedMaxWidth = "md";
  if (modalProps?.size === "xl") calculatedMaxWidth = "lg";
  if (modalProps?.size === "sm") calculatedMaxWidth = "xs";

  const combinedClassName = `${dialogClassName ?? ""} ${modalProps?.dialogClassName ?? ""}`;

  return (
    <Dialog
      open={show}
      onClose={onHide ?? defaultOnHide}
      maxWidth={calculatedMaxWidth}
      fullWidth
      className={combinedClassName}
      sx={sx}
      {...modalProps}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center">
          {icon && (isFaIcon(icon) ? <Icon icon={icon} className="mr-2" /> : <Box component="span" className="modal-icon-container">{icon}</Box>)}
          <span>{header ?? ""}</span>
        </Box>
      </DialogTitle>
      <DialogContent dividers>{children}</DialogContent>
      <DialogActions>
        <Box className="modal-footer-content">
          <Box>
            {leftFooterButtons}
          </Box>
          <Box>
            {footerButtons}
            {cancel ? (
              <Button
                disabled={isRunning}
                variant={cancel.variant === "outline-secondary" ? "outlined" : "text"}
                color="secondary"
                onClick={cancel.onClick}
                className="ml-2"
              >
                {cancel.text ?? (
                  <FormattedMessage
                    id="actions.cancel"
                    defaultMessage="Cancel"
                    description="Cancels the current action and dismisses the modal."
                  />
                )}
              </Button>
            ) : null}
            {!hideAccept && (
              <Button
                disabled={isRunning || disabled}
                variant="contained"
                color={(accept?.variant as any) === "danger" ? "error" : "primary"}
                onClick={accept?.onClick}
                className="ml-2"
              >
                {isRunning ? (
                  <CircularProgress size={24} color="inherit" />
                ) : (
                  accept?.text ?? (
                    <FormattedMessage
                      id="actions.close"
                      defaultMessage="Close"
                      description="Closes the current modal."
                    />
                  )
                )}
              </Button>
            )}
          </Box>
        </Box>
      </DialogActions>
    </Dialog>
  );
};
