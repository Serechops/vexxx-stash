import { 
  Button, 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions, 
  Box, 
  CircularProgress, 
  SxProps, 
  Theme,
  Slide,
  alpha,
  useMediaQuery,
  useTheme
} from "@mui/material";
import { Breakpoint } from "@mui/material/styles";
import { TransitionProps } from "@mui/material/transitions";
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

// Slide transition for modern feel
const SlideTransition = React.forwardRef(function Transition(
  props: TransitionProps & { children: React.ReactElement },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

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
      fullScreen={isMobile}
      className={combinedClassName}
      TransitionComponent={SlideTransition}
      sx={{
        "& .MuiDialog-paper": {
          borderRadius: isMobile ? 0 : 2,
          m: isMobile ? 0 : 2,
          maxHeight: isMobile ? "100%" : "calc(100% - 64px)",
        },
        "& .MuiBackdrop-root": {
          backgroundColor: alpha("#000", 0.75),
          backdropFilter: "blur(4px)",
        },
        ...sx,
      }}
      {...modalProps}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          py: 2,
          px: 3,
          borderBottom: 1,
          borderColor: "divider",
          "& .MuiTypography-root": {
            fontWeight: 600,
          },
        }}
      >
        {icon && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 1,
              bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
              color: "primary.main",
            }}
          >
            {isFaIcon(icon) ? <Icon icon={icon} /> : icon}
          </Box>
        )}
        <Box component="span" sx={{ fontWeight: 600 }}>{header ?? ""}</Box>
      </DialogTitle>
      <DialogContent 
        sx={{ 
          py: 3,
          px: 3,
        }}
      >
        {children}
      </DialogContent>
      <DialogActions
        sx={{
          px: 3,
          py: 2,
          borderTop: 1,
          borderColor: "divider",
          gap: 1,
        }}
      >
        <Box 
          sx={{ 
            display: "flex", 
            justifyContent: "space-between", 
            width: "100%",
            flexDirection: isMobile ? "column" : "row",
            gap: isMobile ? 1 : 0,
          }}
        >
          <Box sx={{ display: "flex", gap: 1 }}>
            {leftFooterButtons}
          </Box>
          <Box sx={{ display: "flex", gap: 1, justifyContent: isMobile ? "stretch" : "flex-end" }}>
            {footerButtons}
            {cancel ? (
              <Button
                disabled={isRunning}
                variant="outlined"
                color="secondary"
                onClick={cancel.onClick}
                sx={{
                  flex: isMobile ? 1 : "none",
                  minWidth: 100,
                }}
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
                sx={{
                  flex: isMobile ? 1 : "none",
                  minWidth: 100,
                  position: "relative",
                }}
              >
                {isRunning ? (
                  <CircularProgress 
                    size={20} 
                    color="inherit" 
                    sx={{ position: "absolute" }}
                  />
                ) : null}
                <Box sx={{ visibility: isRunning ? "hidden" : "visible" }}>
                  {accept?.text ?? (
                    <FormattedMessage
                      id="actions.close"
                      defaultMessage="Close"
                      description="Closes the current modal."
                    />
                  )}
                </Box>
              </Button>
            )}
          </Box>
        </Box>
      </DialogActions>
    </Dialog>
  );
};
