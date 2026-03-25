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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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

export const SettingsRecycleBinPanel: React.FC = () => {
  const intl = useIntl();
  const Toast = useToast();
  const [offset, setOffset] = useState(0);
  const [purgeAllOpen, setPurgeAllOpen] = useState(false);

  const { data, loading, error, refetch } = GQL.useRecycleBinQuery({
    variables: { limit: PAGE_SIZE, offset },
    fetchPolicy: "network-only",
  });

  const { data: countData, refetch: refetchCount } = GQL.useRecycleBinCountQuery({
    fetchPolicy: "network-only",
  });

  const [restoreEntry, { loading: restoring }] = GQL.useRestoreRecycleBinEntryMutation();
  const [purgeEntry, { loading: purging }] = GQL.usePurgeRecycleBinEntryMutation();
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
      <SettingSection headingID="config.categories.recycle_bin">
        <Box sx={{ mb: 2, display: "flex", alignItems: "center", gap: 2 }}>
          <Typography variant="body2" color="text.secondary">
            <FormattedMessage
              id="recycle_bin.count"
              defaultMessage="{count, plural, one {# item} other {# items}} in recycle bin"
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
              <FormattedMessage id="recycle_bin.purge_all" defaultMessage="Purge All" />
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
            <FormattedMessage id="recycle_bin.empty" defaultMessage="The recycle bin is empty." />
          </Typography>
        )}

        {!loading && entries.length > 0 && (
          <>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <FormattedMessage id="recycle_bin.column.type" defaultMessage="Type" />
                    </TableCell>
                    <TableCell>
                      <FormattedMessage id="recycle_bin.column.name" defaultMessage="Name" />
                    </TableCell>
                    <TableCell>
                      <FormattedMessage id="recycle_bin.column.deleted_at" defaultMessage="Deleted At" />
                    </TableCell>
                    <TableCell align="right">
                      <FormattedMessage id="recycle_bin.column.actions" defaultMessage="Actions" />
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id} hover>
                      <TableCell>
                        <Chip
                          label={ENTITY_TYPE_LABELS[entry.entityType] ?? entry.entityType}
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
                                  defaultMessage: "Restore entire group",
                                })
                              : intl.formatMessage({
                                  id: "recycle_bin.restore",
                                  defaultMessage: "Restore",
                                })
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
                          title={intl.formatMessage({
                            id: "recycle_bin.purge",
                            defaultMessage: "Permanently delete",
                          })}
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
                  <FormattedMessage id="pagination.previous" defaultMessage="Previous" />
                </Button>
                <Typography variant="body2" sx={{ alignSelf: "center" }}>
                  <FormattedMessage
                    id="pagination.page_of"
                    defaultMessage="{page} / {total}"
                    values={{ page: currentPage, total: totalPages }}
                  />
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={currentPage >= totalPages || busy}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  <FormattedMessage id="pagination.next" defaultMessage="Next" />
                </Button>
              </Box>
            )}
          </>
        )}
      </SettingSection>

      <Dialog open={purgeAllOpen} onClose={() => setPurgeAllOpen(false)}>
        <DialogTitle>
          <FormattedMessage id="recycle_bin.purge_all_confirm.title" defaultMessage="Purge All" />
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            <FormattedMessage
              id="recycle_bin.purge_all_confirm.message"
              defaultMessage="This will permanently delete all {count} items in the recycle bin. This action cannot be undone."
              values={{ count: totalCount }}
            />
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPurgeAllOpen(false)}>
            <FormattedMessage id="actions.cancel" defaultMessage="Cancel" />
          </Button>
          <Button color="error" variant="contained" onClick={handlePurgeAll}>
            <FormattedMessage id="recycle_bin.purge_all" defaultMessage="Purge All" />
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
