import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import WarningIcon from "@mui/icons-material/Warning";
import React, { useState, useContext, createContext, useMemo } from "react";
import { Button, Snackbar, Alert, AlertTitle, IconButton, Box } from "@mui/material";
import { FormattedMessage } from "react-intl";
import { ModalComponent } from "src/components/Shared/Modal";
import { errorToString } from "src/utils";
import cx from "classnames";

export interface IToast {
  content: JSX.Element | string;
  delay?: number;
  variant?: "success" | "danger" | "warning";
  priority?: number; // higher is more important
}

interface IActiveToast extends IToast {
  id: number;
}

// errors are always more important than regular toasts
const errorPriority = 100;
// errors should stay on screen longer
const errorDelay = 5000;

let toastID = 0;

type ToastFn = (item: IToast) => void;

const ToastContext = createContext<ToastFn | null>(null);

export const ToastProvider: React.FC = ({ children }) => {
  const [toast, setToast] = useState<IActiveToast>();
  const [hiding, setHiding] = useState(false);
  const [expanded, setExpanded] = useState(false);

  function expand() {
    setExpanded(true);
  }

  const toastItem = useMemo(() => {
    if (!toast || expanded) return null;

    return (
      <Snackbar
        open={!!toast && !hiding}
        autoHideDuration={toast.delay ?? 3000}
        onClose={() => setHiding(true)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={toast.variant === "danger" ? "error" : toast.variant === "warning" ? "warning" : "success"}
          variant="filled"
          className="toast-alert"
          action={
            toast.variant === "danger" ? (
              <IconButton
                size="small"
                color="inherit"
                onClick={() => expand()}
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            ) : undefined
          }
          onClose={() => setHiding(true)}
        >
          {typeof toast.content === 'string' ? (
            <Box component="span">{toast.content}</Box>
          ) : (
            toast.content
          )}
        </Alert>
      </Snackbar>
    );
  }, [toast, expanded, hiding]);

  function addToast(item: IToast) {
    if (hiding || !toast || (item.priority ?? 0) >= (toast.priority ?? 0)) {
      setHiding(false);
      setToast({ ...item, id: toastID++ });
    }
  }

  function copyToClipboard() {
    const { content } = toast ?? {};

    if (!!content && typeof content === "string" && navigator.clipboard) {
      navigator.clipboard.writeText(content);
    }
  }

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      {expanded && (
        <ModalComponent
          dialogClassName="toast-expanded-dialog"
          show={expanded}
          accept={{
            onClick: () => {
              setToast(undefined);
              setExpanded(false);
            },
          }}
          header={<FormattedMessage id="errors.header" />}
          icon={<WarningIcon />}
          footerButtons={
            <>
              {!!navigator.clipboard && (
                <Button variant="contained" color="secondary" onClick={() => copyToClipboard()}>
                  <FormattedMessage id="actions.copy_to_clipboard" />
                </Button>
              )}
            </>
          }
        >
          {toast?.content}
        </ModalComponent>
      )}
      <div className={cx("toast-container", { hidden: !toast || hiding })}>
        {toastItem}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const addToast = useContext(ToastContext);

  if (!addToast) {
    throw new Error("useToast must be used within a ToastProvider");
  }

  return useMemo(
    () => ({
      toast: addToast,
      success(message: JSX.Element | string) {
        addToast({
          content: message,
        });
      },
      error(error: unknown) {
        const message = errorToString(error);

        console.error(error);
        addToast({
          variant: "danger",
          content: message,
          priority: errorPriority,
          delay: errorDelay,
        });
      },
    }),
    [addToast]
  );
};

export function toastOperation(
  toast: ReturnType<typeof useToast>,
  o: () => Promise<void>,
  successMessage: string
) {
  async function operation() {
    try {
      await o();

      toast.success(successMessage);
    } catch (e) {
      toast.error(e);
    }
  }

  return operation;
}
