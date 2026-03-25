import React, { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import RestoreIcon from "@mui/icons-material/Restore";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import { FormattedMessage, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { useToast } from "src/hooks/Toast";
import { SettingSection } from "./SettingSection";

const PAGE_SIZE = 50;

const ENTITY_TYPE_LABELS: Record<string, string> = {
  tag: "Tag",
  performer: "Performer",
  studio: "Studio",
  gallery: "Gallery",
  image: "Image",
  group: "Group",
  scene_marker: "Scene Marker",
};

const ACTION_COLORS: Record<string, "error" | "success" | "default"> = {
  deleted: "error",
  restored: "success",
  purged: "default",
};

// ── Recycle Bin tab ───────────────────────────────────────────────────────────

const RecycleBinTab: React.FC = () => {
  const intl = useIntl();
  const Toast = useToast();
  const [offset, setOffset] = useState(0);
  const [purgeAllOpen, setPurgeAllOpen] = useState(false);

  const { data, loading, error, refetch } = GQL.useRecycleBinQuery({
    variables: { limit: PAGE_SIZE, offset },
    fetchPolicy: "network-only",
  });

  const { data: countData, refetch: refetchCount } =
    GQL.useRecycleBinCountQuery({ fetchPolicy: "network-only" });

  const [restoreEntry, { loading: restoring }] =
    GQL.useRestoreRecycleBinEntryMutation();
  const [purgeEntry, { loading: purging }] =
    GQL.usePurgeRecycleBinEntryMutation();
  const [purgeAll, { loading: purgingAll }] = GQL.usePurgeRecycleBinMutation();

  const entries = data?.recycleBin ?? [];
  const totalCount = countData?.recycleBinCount ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const busy = restoring || purging || purgingAll;

  const handleRestore = async (id: string) => {
    try {
      await restoreEntry({ variables: { id } });
      refetch();
      refetchCount();
    } catch (e) {
      Toast.error(e);
    }
  };

  const handlePurge = async (id: string) => {
    try {
      await purgeEntry({ variables: { id } });
      refetch();
      refetchCount();
    } catch (e) {
      Toast.error(e);
    }
  };

  const handlePurgeAll = async () => {
    setPurgeAllOpen(false);
    try {
      await purgeAll();
      setOffset(0);
      refetch();
      refetchCount();
    } catch (e) {
      Toast.error(e);
    }
  };

  const formatDate = (isoString: string) => {
    try {
      return intl.formatDate(isoString, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <>
      <Box sx={{ mb: 2, display: "flex", alignItems: "center", gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          <FormattedMessage
            id="recycle_bin.count"
            values={{ count: totalCount }}
          />
        </Typography>
        {totalCount > 0 && (
          <Button
            variant="outlined"
            color="error"
            size="small"
            startIcon={<DeleteSweepIcon />}
            onClick={() => setPurgeAllOpen(true)}
            disabled={busy}
          >
            <FormattedMessage id="recycle_bin.purge_all" />
          </Button>
        )}
      </Box>

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error.message}
        </Alert>
      )}

      {!loading && entries.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          <FormattedMessage id="recycle_bin.empty" />
        </Typography>
      )}

      {!loading && entries.length > 0 && (
        <>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>
                    <FormattedMessage id="recycle_bin.column.type" />
                  </TableCell>
                  <TableCell>
                    <FormattedMessage id="recycle_bin.column.name" />
                  </TableCell>
                  <TableCell>
                    <FormattedMessage id="recycle_bin.column.deleted_at" />
                  </TableCell>
                  <TableCell align="right">
                    <FormattedMessage id="recycle_bin.column.actions" />
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id} hover>
                    <TableCell>
                      <Chip
                        label={
                          ENTITY_TYPE_LABELS[entry.entityType] ??
                          entry.entityType
                        }
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{entry.entityName || `#${entry.entityId}`}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {formatDate(entry.deletedAt)}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      <Tooltip
                        title={
                          entry.groupId
                            ? intl.formatMessage({
                                id: "recycle_bin.restore_group",
                              })
                            : intl.formatMessage({ id: "recycle_bin.restore" })
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            color="primary"
                            disabled={busy}
                            onClick={() => handleRestore(entry.id)}
                          >
                            <RestoreIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip
                        title={intl.formatMessage({ id: "recycle_bin.purge" })}
                      >
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={busy}
                            onClick={() => handlePurge(entry.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {totalPages > 1 && (
            <Box sx={{ display: "flex", justifyContent: "center", gap: 2, mt: 2 }}>
              <Button
                variant="outlined"
                size="small"
                disabled={offset === 0 || busy}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <FormattedMessage id="pagination.previous" />
              </Button>
              <Typography variant="body2" sx={{ alignSelf: "center" }}>
                <FormattedMessage
                  id="pagination.page_of"
                  values={{ page: currentPage, total: totalPages }}
                />
              </Typography>
              <Button
                variant="outlined"
                size="small"
                disabled={currentPage >= totalPages || busy}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                <FormattedMessage id="pagination.next" />
              </Button>
            </Box>
          )}
        </>
      )}

      <Dialog open={purgeAllOpen} onClose={() => setPurgeAllOpen(false)}>
        <DialogTitle>
          <FormattedMessage id="recycle_bin.purge_all_confirm.title" />
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            <FormattedMessage
              id="recycle_bin.purge_all_confirm.message"
              values={{ count: totalCount }}
            />
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPurgeAllOpen(false)}>
            <FormattedMessage id="actions.cancel" />
          </Button>
          <Button color="error" variant="contained" onClick={handlePurgeAll}>
            <FormattedMessage id="recycle_bin.purge_all" />
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

// ── History tab ───────────────────────────────────────────────────────────────

const HistoryTab: React.FC = () => {
  const intl = useIntl();
  const [offset, setOffset] = useState(0);

  const { data, loading, error } = GQL.useRecycleBinHistoryQuery({
    variables: { limit: PAGE_SIZE, offset },
    fetchPolicy: "network-only",
  });

  const { data: countData } = GQL.useRecycleBinHistoryCountQuery({
    fetchPolicy: "network-only",
  });

  const entries = data?.recycleBinHistory ?? [];
  const totalCount = countData?.recycleBinHistoryCount ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const formatDate = (isoString: string) => {
    try {
      return intl.formatDate(isoString, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <>
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          <FormattedMessage
            id="recycle_bin.history.count"
            values={{ count: totalCount }}
          />
        </Typography>
      </Box>

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error.message}
        </Alert>
      )}

      {!loading && entries.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          <FormattedMessage id="recycle_bin.history.empty" />
        </Typography>
      )}

      {!loading && entries.length > 0 && (
        <>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>
                    <FormattedMessage id="recycle_bin.column.type" />
                  </TableCell>
                  <TableCell>
                    <FormattedMessage id="recycle_bin.column.name" />
                  </TableCell>
                  <TableCell>
                    <FormattedMessage id="recycle_bin.column.action" />
                  </TableCell>
                  <TableCell>
                    <FormattedMessage id="recycle_bin.column.actioned_at" />
                  </TableCell>
                  <TableCell>
                    <FormattedMessage id="recycle_bin.column.notes" />
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id} hover>
                    <TableCell>
                      <Chip
                        label={
                          ENTITY_TYPE_LABELS[entry.entityType] ??
                          entry.entityType
                        }
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{entry.entityName || `#${entry.entityId}`}</TableCell>
                    <TableCell>
                      <Chip
                        label={intl.formatMessage({
                          id: `recycle_bin.history.action.${entry.action}`,
                          defaultMessage: entry.action,
                        })}
                        size="small"
                        color={ACTION_COLORS[entry.action] ?? "default"}
                      />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {formatDate(entry.actionedAt)}
                    </TableCell>
                    <TableCell sx={{ color: "text.secondary", fontSize: "0.8em" }}>
                      {entry.notes || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {totalPages > 1 && (
            <Box sx={{ display: "flex", justifyContent: "center", gap: 2, mt: 2 }}>
              <Button
                variant="outlined"
                size="small"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <FormattedMessage id="pagination.previous" />
              </Button>
              <Typography variant="body2" sx={{ alignSelf: "center" }}>
                <FormattedMessage
                  id="pagination.page_of"
                  values={{ page: currentPage, total: totalPages }}
                />
              </Typography>
              <Button
                variant="outlined"
                size="small"
                disabled={currentPage >= totalPages}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                <FormattedMessage id="pagination.next" />
              </Button>
            </Box>
          )}
        </>
      )}
    </>
  );
};

// ── Root panel ────────────────────────────────────────────────────────────────

export const SettingsRecycleBinPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"bin" | "history">("bin");

  return (
    <SettingSection headingID="config.categories.recycle_bin">
      <Tabs
        value={activeTab}
        onChange={(_e, v) => setActiveTab(v)}
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab
          value="bin"
          label={<FormattedMessage id="recycle_bin.tab" />}
        />
        <Tab
          value="history"
          label={<FormattedMessage id="recycle_bin.history.tab" />}
        />
      </Tabs>

      {activeTab === "bin" && <RecycleBinTab />}
      {activeTab === "history" && <HistoryTab />}
    </SettingSection>
  );
};
