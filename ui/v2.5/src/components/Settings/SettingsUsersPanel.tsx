import React, { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Key as KeyIcon,
  Refresh as RefreshIcon,
} from "@mui/icons-material";
import * as GQL from "src/core/generated-graphql";
import { useToast } from "src/hooks/Toast";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { SettingSection } from "./SettingSection";
import { useCurrentUser } from "src/hooks/UserContext";

interface UserFormData {
  username: string;
  password: string;
  role: GQL.UserRole;
  is_active: boolean;
}

const defaultFormData: UserFormData = {
  username: "",
  password: "",
  role: GQL.UserRole.Viewer,
  is_active: true,
};

interface UserDialogProps {
  open: boolean;
  user: GQL.UserDataFragment | null;
  onClose: () => void;
  onSave: (data: UserFormData, userId?: string) => Promise<void>;
}

const UserDialog: React.FC<UserDialogProps> = ({
  open,
  user,
  onClose,
  onSave,
}) => {
  const intl = useIntl();
  const [formData, setFormData] = useState<UserFormData>(defaultFormData);
  const [saving, setSaving] = useState(false);

  // Reset form data when dialog opens or user changes
  React.useEffect(() => {
    if (open) {
      setFormData(
        user
          ? {
              username: user.username,
              password: "",
              role: user.role,
              is_active: user.is_active,
            }
          : defaultFormData
      );
    }
  }, [open, user]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(formData, user?.id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const isEdit = !!user;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {isEdit ? (
          <FormattedMessage id="users.edit_user" defaultMessage="Edit User" />
        ) : (
          <FormattedMessage id="users.create_user" defaultMessage="Create User" />
        )}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
          <TextField
            fullWidth
            label={intl.formatMessage({ id: "users.username", defaultMessage: "Username" })}
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            required
          />
          <TextField
            fullWidth
            type="password"
            label={
              isEdit
                ? intl.formatMessage({ id: "users.new_password", defaultMessage: "New Password (leave blank to keep)" })
                : intl.formatMessage({ id: "users.password", defaultMessage: "Password" })
            }
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            required={!isEdit}
            helperText={
              isEdit
                ? intl.formatMessage({ id: "users.password_hint_edit", defaultMessage: "Leave blank to keep current password" })
                : intl.formatMessage({ id: "users.password_hint_new", defaultMessage: "Minimum 6 characters" })
            }
          />
          <FormControl fullWidth>
            <InputLabel>
              <FormattedMessage id="users.role" defaultMessage="Role" />
            </InputLabel>
            <Select
              value={formData.role}
              label={intl.formatMessage({ id: "users.role", defaultMessage: "Role" })}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as GQL.UserRole })}
            >
              <MenuItem value={GQL.UserRole.Admin}>
                <FormattedMessage id="users.role.admin" defaultMessage="Admin" />
              </MenuItem>
              <MenuItem value={GQL.UserRole.Viewer}>
                <FormattedMessage id="users.role.viewer" defaultMessage="Viewer" />
              </MenuItem>
            </Select>
          </FormControl>
          {isEdit && (
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                />
              }
              label={intl.formatMessage({ id: "users.active", defaultMessage: "Active" })}
            />
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          <FormattedMessage id="actions.cancel" defaultMessage="Cancel" />
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving || !formData.username || (!isEdit && !formData.password)}
        >
          {saving ? (
            <FormattedMessage id="actions.saving" defaultMessage="Saving..." />
          ) : (
            <FormattedMessage id="actions.save" defaultMessage="Save" />
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const SettingsUsersPanel: React.FC = () => {
  const intl = useIntl();
  const Toast = useToast();
  const { user: currentUser, canManageUsers } = useCurrentUser();

  const { data, loading, error, refetch } = GQL.useFindUsersQuery({
    fetchPolicy: "cache-and-network",
  });

  const [userCreate] = GQL.useUserCreateMutation();
  const [userUpdate] = GQL.useUserUpdateMutation();
  const [userDestroy] = GQL.useUserDestroyMutation();
  const [regenerateAPIKey] = GQL.useUserRegenerateApiKeyMutation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<GQL.UserDataFragment | null>(null);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<GQL.UserDataFragment | null>(null);

  const users = data?.findUsers ?? [];

  const handleOpenCreate = () => {
    setEditingUser(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (user: GQL.UserDataFragment) => {
    setEditingUser(user);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingUser(null);
  };

  const handleSaveUser = async (formData: UserFormData, userId?: string) => {
    try {
      if (userId) {
        // Update existing user
        await userUpdate({
          variables: {
            input: {
              id: userId,
              username: formData.username,
              password: formData.password || undefined,
              role: formData.role,
              is_active: formData.is_active,
            },
          },
        });
        Toast.success(intl.formatMessage({ id: "users.updated", defaultMessage: "User updated" }));
      } else {
        // Create new user
        await userCreate({
          variables: {
            input: {
              username: formData.username,
              password: formData.password,
              role: formData.role,
            },
          },
        });
        Toast.success(intl.formatMessage({ id: "users.created", defaultMessage: "User created" }));
      }
      refetch();
    } catch (e) {
      Toast.error(e);
      throw e;
    }
  };

  const handleDeleteUser = async (user: GQL.UserDataFragment) => {
    try {
      await userDestroy({
        variables: { id: user.id },
      });
      Toast.success(intl.formatMessage({ id: "users.deleted", defaultMessage: "User deleted" }));
      setDeleteConfirmUser(null);
      refetch();
    } catch (e) {
      Toast.error(e);
    }
  };

  const handleRegenerateAPIKey = async (user: GQL.UserDataFragment) => {
    try {
      const result = await regenerateAPIKey({
        variables: { id: user.id },
      });
      Toast.success(
        intl.formatMessage(
          { id: "users.api_key_regenerated", defaultMessage: "New API key: {key}" },
          { key: result.data?.userRegenerateAPIKey }
        )
      );
      refetch();
    } catch (e) {
      Toast.error(e);
    }
  };

  if (!canManageUsers) {
    return (
      <Box sx={{ p: 3, textAlign: "center" }}>
        <Typography color="error">
          <FormattedMessage
            id="users.no_permission"
            defaultMessage="You do not have permission to manage users."
          />
        </Typography>
      </Box>
    );
  }

  if (error) return <Typography color="error">{error.message}</Typography>;
  if (loading && !data) return <LoadingIndicator />;

  return (
    <>
      <SettingSection headingID="users.management" headingDefault="User Management">
        <Box sx={{ mb: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="body2" color="text.secondary">
            <FormattedMessage
              id="users.description"
              defaultMessage="Manage user accounts and their access levels. Admins have full access, while Viewers have read-only access."
            />
          </Typography>
          <Box>
            <Tooltip title={intl.formatMessage({ id: "actions.refresh", defaultMessage: "Refresh" })}>
              <IconButton onClick={() => refetch()}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleOpenCreate}
            >
              <FormattedMessage id="users.add_user" defaultMessage="Add User" />
            </Button>
          </Box>
        </Box>

        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>
                  <FormattedMessage id="users.username" defaultMessage="Username" />
                </TableCell>
                <TableCell>
                  <FormattedMessage id="users.role" defaultMessage="Role" />
                </TableCell>
                <TableCell>
                  <FormattedMessage id="users.status" defaultMessage="Status" />
                </TableCell>
                <TableCell>
                  <FormattedMessage id="users.last_login" defaultMessage="Last Login" />
                </TableCell>
                <TableCell>
                  <FormattedMessage id="users.created" defaultMessage="Created" />
                </TableCell>
                <TableCell align="right">
                  <FormattedMessage id="users.actions" defaultMessage="Actions" />
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    {user.username}
                    {user.id === currentUser?.id && (
                      <Chip
                        label={intl.formatMessage({ id: "users.you", defaultMessage: "You" })}
                        size="small"
                        color="primary"
                        sx={{ ml: 1 }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={
                        user.role === GQL.UserRole.Admin
                          ? intl.formatMessage({ id: "users.role.admin", defaultMessage: "Admin" })
                          : intl.formatMessage({ id: "users.role.viewer", defaultMessage: "Viewer" })
                      }
                      color={user.role === GQL.UserRole.Admin ? "primary" : "default"}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={
                        user.is_active
                          ? intl.formatMessage({ id: "users.active", defaultMessage: "Active" })
                          : intl.formatMessage({ id: "users.inactive", defaultMessage: "Inactive" })
                      }
                      color={user.is_active ? "success" : "error"}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    {user.last_login_at
                      ? new Date(user.last_login_at).toLocaleString()
                      : intl.formatMessage({ id: "users.never", defaultMessage: "Never" })}
                  </TableCell>
                  <TableCell>{new Date(user.created_at).toLocaleDateString()}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={intl.formatMessage({ id: "users.regenerate_api_key", defaultMessage: "Regenerate API Key" })}>
                      <IconButton onClick={() => handleRegenerateAPIKey(user)} size="small">
                        <KeyIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={intl.formatMessage({ id: "actions.edit", defaultMessage: "Edit" })}>
                      <IconButton onClick={() => handleOpenEdit(user)} size="small">
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={intl.formatMessage({ id: "actions.delete", defaultMessage: "Delete" })}>
                      <span>
                        <IconButton
                          onClick={() => setDeleteConfirmUser(user)}
                          size="small"
                          color="error"
                          disabled={user.id === currentUser?.id}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography color="text.secondary">
                      <FormattedMessage id="users.no_users" defaultMessage="No users found" />
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </SettingSection>

      <UserDialog
        open={dialogOpen}
        user={editingUser}
        onClose={handleCloseDialog}
        onSave={handleSaveUser}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteConfirmUser}
        onClose={() => setDeleteConfirmUser(null)}
      >
        <DialogTitle>
          <FormattedMessage id="users.delete_confirm_title" defaultMessage="Delete User" />
        </DialogTitle>
        <DialogContent>
          <Typography>
            <FormattedMessage
              id="users.delete_confirm_message"
              defaultMessage="Are you sure you want to delete user '{username}'? This action cannot be undone."
              values={{ username: deleteConfirmUser?.username }}
            />
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmUser(null)}>
            <FormattedMessage id="actions.cancel" defaultMessage="Cancel" />
          </Button>
          <Button
            onClick={() => deleteConfirmUser && handleDeleteUser(deleteConfirmUser)}
            color="error"
            variant="contained"
          >
            <FormattedMessage id="actions.delete" defaultMessage="Delete" />
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
