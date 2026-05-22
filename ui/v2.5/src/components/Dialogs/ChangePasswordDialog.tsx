import React, { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { useToast } from "src/hooks/Toast";

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
}

export const ChangePasswordDialog: React.FC<ChangePasswordDialogProps> = ({
  open,
  onClose,
}) => {
  const intl = useIntl();
  const Toast = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const [changeOwnPassword] = GQL.useChangeOwnPasswordMutation();

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 6 &&
    newPassword === confirmPassword &&
    !saving;

  const handleClose = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    onClose();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await changeOwnPassword({
        variables: {
          current_password: currentPassword,
          new_password: newPassword,
        },
      });
      Toast.success(
        intl.formatMessage({
          id: "users.password_changed",
          defaultMessage: "Password changed successfully",
        })
      );
      handleClose();
    } catch (e) {
      Toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        <FormattedMessage
          id="users.change_password"
          defaultMessage="Change Password"
        />
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
          <TextField
            fullWidth
            type="password"
            label={intl.formatMessage({
              id: "users.current_password",
              defaultMessage: "Current Password",
            })}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
          <TextField
            fullWidth
            type="password"
            label={intl.formatMessage({
              id: "users.new_password",
              defaultMessage: "New Password",
            })}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            helperText={intl.formatMessage({
              id: "users.password_hint_new",
              defaultMessage: "Minimum 6 characters",
            })}
            autoComplete="new-password"
          />
          <TextField
            fullWidth
            type="password"
            label={intl.formatMessage({
              id: "users.confirm_password",
              defaultMessage: "Confirm New Password",
            })}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            error={mismatch}
            helperText={
              mismatch
                ? intl.formatMessage({
                    id: "users.passwords_do_not_match",
                    defaultMessage: "Passwords do not match",
                  })
                : undefined
            }
            autoComplete="new-password"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          <FormattedMessage id="actions.cancel" defaultMessage="Cancel" />
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!canSubmit}
        >
          {saving ? (
            <FormattedMessage id="actions.saving" defaultMessage="Saving..." />
          ) : (
            <FormattedMessage
              id="users.change_password"
              defaultMessage="Change Password"
            />
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
