import React, { useMemo, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
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
  LockOpen as LockOpenIcon,
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
}

const defaultFormData: UserFormData = {
  username: "",
  password: "",
  role: GQL.UserRole.Viewer,
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
          ? { username: user.username, password: "", role: user.role }
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
                : undefined
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
  const { user: currentUser, canManageUsers, isSetupMode, loading: userContextLoading } = useCurrentUser();

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
  const [searchQuery, setSearchQuery] = useState("");

  // Setup mode state — inline first-admin creation form
  const [setupSkipped, setSetupSkipped] = useState(false);
  const [setupUsername, setSetupUsername] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");
  const [setupSaving, setSetupSaving] = useState(false);

  const users = data?.findUsers ?? [];
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredUsers = useMemo(() => {
    if (!normalizedSearch) {
      return users;
    }

    return users.filter((user) => {
      const username = user.username.toLowerCase();
      const role = user.role.toLowerCase();
      return username.includes(normalizedSearch) || role.includes(normalizedSearch);
    });
  }, [users, normalizedSearch]);

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
    const isSelf = user.id === currentUser?.id;
    try {
      await userDestroy({ variables: { id: user.id } });
      Toast.success(intl.formatMessage({ id: "users.deleted", defaultMessage: "User deleted" }));
      setDeleteConfirmUser(null);
      if (isSelf) {
        // Redirect to root; the server will forward to /login if other users
        // exist, or show the setup page if this was the last user.
        window.location.href = "/";
      } else {
        refetch();
      }
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

  const setupPasswordMismatch =
    setupConfirm.length > 0 && setupPassword !== setupConfirm;
  const canCreateFirstAdmin =
    setupUsername.trim().length > 0 &&
    setupPassword.length >= 1 &&
    setupPassword === setupConfirm &&
    !setupSaving;

  const handleCreateFirstAdmin = async () => {
    setSetupSaving(true);
    try {
      await userCreate({
        variables: {
          input: {
            username: setupUsername.trim(),
            password: setupPassword,
            role: GQL.UserRole.Admin,
          },
        },
      });
      Toast.success(
        intl.formatMessage({
          id: "users.first_admin_created",
          defaultMessage:
            "Admin account created. Please log in to continue.",
        })
      );
      await refetch();
      // Navigate to login so the user authenticates with the new account
      window.location.href = "/login?returnURL=/";
    } catch (e) {
      Toast.error(e);
    } finally {
      setSetupSaving(false);
    }
  };

  // Wait for UserContext to resolve before evaluating permissions
  if (userContextLoading) return <LoadingIndicator />;

  // Setup mode takes priority — show the first-run card regardless of query state
  if (isSetupMode && !setupSkipped) {
    return (
      <Box sx={{ maxWidth: 520, mx: "auto", mt: 4 }}>
        <Paper
          sx={{
            p: 4,
            border: 1,
            borderColor: "primary.main",
            borderRadius: 2,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1.5 }}>
            <LockOpenIcon color="primary" sx={{ fontSize: 32 }} />
            <Box>
              <Typography variant="h6" fontWeight={600}>
                <FormattedMessage
                  id="users.setup.title"
                  defaultMessage="Enable Authentication"
                />
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <FormattedMessage
                  id="users.setup.subtitle"
                  defaultMessage="No user accounts exist. Create an admin account to restrict access."
                />
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              fullWidth
              label={intl.formatMessage({
                id: "users.username",
                defaultMessage: "Username",
              })}
              value={setupUsername}
              onChange={(e) => setSetupUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
            <TextField
              fullWidth
              type="password"
              label={intl.formatMessage({
                id: "users.password",
                defaultMessage: "Password",
              })}
              value={setupPassword}
              onChange={(e) => setSetupPassword(e.target.value)}
              autoComplete="new-password"
            />
            <TextField
              fullWidth
              type="password"
              label={intl.formatMessage({
                id: "users.confirm_password",
                defaultMessage: "Confirm Password",
              })}
              value={setupConfirm}
              onChange={(e) => setSetupConfirm(e.target.value)}
              error={setupPasswordMismatch}
              helperText={
                setupPasswordMismatch
                  ? intl.formatMessage({
                      id: "users.passwords_do_not_match",
                      defaultMessage: "Passwords do not match",
                    })
                  : undefined
              }
              autoComplete="new-password"
            />
          </Box>

          <Box sx={{ display: "flex", gap: 2, mt: 3, alignItems: "center" }}>
            <Button
              variant="contained"
              onClick={handleCreateFirstAdmin}
              disabled={!canCreateFirstAdmin}
              size="large"
            >
              {setupSaving ? (
                <FormattedMessage id="actions.saving" defaultMessage="Saving..." />
              ) : (
                <FormattedMessage
                  id="users.setup.create_admin"
                  defaultMessage="Create Admin Account"
                />
              )}
            </Button>
            <Button
              variant="text"
              color="inherit"
              onClick={() => setSetupSkipped(true)}
              sx={{ color: "text.secondary" }}
            >
              <FormattedMessage
                id="users.setup.skip"
                defaultMessage="Skip for now"
              />
            </Button>
          </Box>
        </Paper>
      </Box>
    );
  }

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
      {isSetupMode && setupSkipped && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>
            <FormattedMessage
              id="users.setup.skipped_title"
              defaultMessage="Authentication is disabled"
            />
          </AlertTitle>
          <FormattedMessage
            id="users.setup.skipped_body"
            defaultMessage="No user accounts exist. Anyone with network access can use this server. Create an admin account below to enable authentication."
          />
        </Alert>
      )}
      <SettingSection headingID="users.management" headingDefault="User Management">
        <Box sx={{ mb: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            <FormattedMessage
              id="users.description"
              defaultMessage="Manage user accounts and their access levels. Admins have full access, while Viewers have read-only access."
            />
          </Typography>

          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
            <TextField
              size="small"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={intl.formatMessage({
                id: "users.search_placeholder",
                defaultMessage: "Search users by name or role",
              })}
              sx={{ minWidth: 260, flex: 1, maxWidth: 420 }}
            />

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
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          <FormattedMessage
            id="users.filtered_count"
            defaultMessage="Showing {shown} of {total} users"
            values={{ shown: filteredUsers.length, total: users.length }}
          />
        </Typography>

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
              {filteredUsers.map((user) => (
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
                      <IconButton
                        onClick={() => setDeleteConfirmUser(user)}
                        size="small"
                        color="error"
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {filteredUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography color="text.secondary">
                      {users.length === 0 ? (
                        <FormattedMessage id="users.no_users" defaultMessage="No users found" />
                      ) : (
                        <FormattedMessage
                          id="users.no_matching_users"
                          defaultMessage="No users match the current search"
                        />
                      )}
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
          {deleteConfirmUser?.id === currentUser?.id && (
            <Typography sx={{ mt: 1.5 }} color="warning.main">
              <FormattedMessage
                id="users.delete_self_warning"
                defaultMessage="You are deleting your own account. You will be logged out immediately."
              />
            </Typography>
          )}
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
