import React, { useEffect, useMemo, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import StorageRoundedIcon from "@mui/icons-material/StorageRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  Skeleton,
  Tooltip,
  Typography,
} from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { FileBrowserTree } from "./FileBrowserTree";
import { FileBrowserContent } from "./FileBrowserContent";
import { FileBrowserBreadcrumb } from "./FileBrowserBreadcrumb";

const SELECTED_FOLDER_STORAGE_KEY = "fileBrowser.selectedFolderId";
const EXPANDED_FOLDERS_STORAGE_KEY = "fileBrowser.expandedFolderIds";

const FileBrowser: React.FC = () => {
  const intl = useIntl();
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(() =>
    localStorage.getItem(SELECTED_FOLDER_STORAGE_KEY)
  );
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => {
    const raw = localStorage.getItem(EXPANDED_FOLDERS_STORAGE_KEY);
    if (!raw) return new Set();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((id): id is string => typeof id === "string"));
      }
    } catch {
      // ignore malformed persisted state
    }
    return new Set();
  });
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [refreshTicker, setRefreshTicker] = useState(() => Date.now());

  const {
    data: libraryDiskData,
    loading: libraryDiskLoading,
    refetch: refetchLibraryDiskStats,
  } =
    GQL.useLibraryDiskStatsQuery({
      pollInterval: 60000,
      fetchPolicy: "cache-and-network",
    });

  useEffect(() => {
    if (selectedFolderId) {
      localStorage.setItem(SELECTED_FOLDER_STORAGE_KEY, selectedFolderId);
    } else {
      localStorage.removeItem(SELECTED_FOLDER_STORAGE_KEY);
    }
  }, [selectedFolderId]);

  useEffect(() => {
    localStorage.setItem(
      EXPANDED_FOLDERS_STORAGE_KEY,
      JSON.stringify(Array.from(expandedFolderIds))
    );
  }, [expandedFolderIds]);

  useEffect(() => {
    if (libraryDiskData?.libraryDiskStats?.length) {
      setLastRefreshAt(Date.now());
    }
  }, [libraryDiskData]);

  useEffect(() => {
    const interval = window.setInterval(() => setRefreshTicker(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const lastUpdatedLabel = useMemo(() => {
    if (!lastRefreshAt) {
      return intl.formatMessage({
        id: "config.general.library_disk_stats.last_updated.pending",
        defaultMessage: "Waiting for first refresh",
      });
    }

    const deltaSeconds = Math.max(0, Math.floor((refreshTicker - lastRefreshAt) / 1000));
    return intl.formatMessage(
      { id: "config.general.library_disk_stats.last_updated", defaultMessage: "Updated {seconds}s ago" },
      { seconds: deltaSeconds }
    );
  }, [intl, lastRefreshAt, refreshTicker]);

  const handleToggleExpanded = (id: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  function formatBytes(value?: number | null) {
    if (!value || value <= 0) return "0 B";

    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let size = value;
    let idx = 0;
    while (size >= 1024 && idx < units.length - 1) {
      size /= 1024;
      idx++;
    }

    const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2;
    return `${size.toFixed(digits)} ${units[idx]}`;
  }

  function formatPercent(value?: number | null) {
    if (!value || value <= 0) return "0.00%";
    return `${value.toFixed(2)}%`;
  }

  function percentOf(part?: number | null, total?: number | null) {
    if (!part || !total || total <= 0) return 0;
    return Math.max(0, Math.min(100, (part / total) * 100));
  }

  function getLibraryChipLabel(path: string) {
    const parts = path.split(/[/\\]+/).filter(Boolean);
    return parts[parts.length - 1] || path;
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "calc(100vh - 3.4rem)", overflow: "hidden", mx: "-15px" }}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
        <Typography variant="h5">
          <FormattedMessage id="file-browser" defaultMessage="File Browser" />
        </Typography>

        <Box sx={{ mt: 0.5, display: "flex", alignItems: "center", gap: 0.75 }}>
          <Typography variant="caption" color="text.secondary">
            {lastUpdatedLabel}
          </Typography>
          <Tooltip
            title={intl.formatMessage({
              id: "config.general.library_disk_stats.refresh",
              defaultMessage: "Refresh disk stats",
            })}
          >
            <IconButton
              size="small"
              onClick={() => {
                void refetchLibraryDiskStats();
                setLastRefreshAt(Date.now());
              }}
              aria-label={intl.formatMessage({
                id: "config.general.library_disk_stats.refresh",
                defaultMessage: "Refresh disk stats",
              })}
            >
              <RefreshRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ mt: 0.9, minHeight: 56 }}>
          {libraryDiskLoading && !libraryDiskData?.libraryDiskStats?.length ? (
            <Box sx={{ display: "flex", gap: 1, overflowX: "auto", pb: 0.25, pr: 0.5 }}>
              {[0, 1, 2].map((idx) => (
                <Box
                  key={idx}
                  sx={{
                    minWidth: 220,
                    maxWidth: 240,
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1.5,
                    p: 1,
                    bgcolor: "background.paper",
                  }}
                >
                  <Skeleton variant="circular" width={40} height={40} />
                  <Skeleton sx={{ mt: 1 }} width="75%" />
                  <Skeleton width="90%" />
                  <Skeleton sx={{ mt: 1 }} width="55%" />
                  <Skeleton width="100%" height={18} />
                  <Skeleton width="100%" height={18} />
                </Box>
              ))}
            </Box>
          ) : libraryDiskData?.libraryDiskStats?.length ? (
            <Box
              sx={{
                display: "flex",
                gap: 1,
                overflowX: "auto",
                pb: 0.25,
                pr: 0.5,
                maxWidth: "100%",
                scrollSnapType: "x mandatory",
                "&::-webkit-scrollbar": {
                  height: 8,
                },
                "&::-webkit-scrollbar-thumb": {
                  backgroundColor: "divider",
                  borderRadius: 8,
                },
              }}
            >
              {libraryDiskData.libraryDiskStats.map((entry) => (
                <Box
                  key={entry.pathAbs}
                  sx={{
                    minWidth: 220,
                    maxWidth: 240,
                    scrollSnapAlign: "start",
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1.5,
                    p: 1,
                    bgcolor: "background.paper",
                  }}
                >
                  <Box sx={{ display: "flex", gap: 0.9, alignItems: "center", mb: 0.9 }}>
                    <Box sx={{ position: "relative", width: 40, height: 40, flexShrink: 0 }}>
                      <CircularProgress
                        variant="determinate"
                        value={100}
                        size={40}
                        thickness={5}
                        sx={{ color: "divider", position: "absolute", left: 0, top: 0 }}
                      />
                      <CircularProgress
                        variant="determinate"
                        value={percentOf(entry.usedBytes, entry.totalBytes)}
                        size={40}
                        thickness={5}
                        sx={{
                          color:
                            percentOf(entry.usedBytes, entry.totalBytes) > 90
                              ? "error.main"
                              : "primary.main",
                          position: "absolute",
                          left: 0,
                          top: 0,
                        }}
                      />
                      <StorageRoundedIcon
                        sx={{ fontSize: 16,
                          position: "absolute",
                          left: "50%",
                          top: "50%",
                          transform: "translate(-50%, -50%)",
                          color: "text.secondary",
                        }}
                      />
                    </Box>

                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 600, lineHeight: 1.2 }}
                        title={entry.path}
                        noWrap
                      >
                        {entry.path}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", fontFamily: "monospace", fontSize: "0.67rem" }}
                        title={entry.pathAbs}
                        noWrap
                      >
                        {entry.pathAbs}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", fontSize: "0.67rem" }}
                      >
                        {intl.formatMessage(
                          { id: "config.general.library_disk_stats.group_count" },
                          { count: entry.libraryCount }
                        )}
                      </Typography>
                      {entry.libraryPaths.length > 0 && (
                        <Box sx={{ mt: 0.25 }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block", fontSize: "0.65rem", mb: 0.25 }}
                          >
                            {intl.formatMessage({ id: "config.general.library_disk_stats.libraries_label" })}
                          </Typography>
                          <Box
                            sx={{
                              display: "flex",
                              gap: 0.4,
                              overflowX: "auto",
                              pb: 0.2,
                              "&::-webkit-scrollbar": {
                                height: 5,
                              },
                              "&::-webkit-scrollbar-thumb": {
                                backgroundColor: "divider",
                                borderRadius: 999,
                              },
                            }}
                          >
                            {entry.libraryPaths.map((p) => (
                              <Chip
                                key={p}
                                label={getLibraryChipLabel(p)}
                                size="small"
                                variant="outlined"
                                title={p}
                                sx={{
                                  height: 18,
                                  fontSize: "0.62rem",
                                  borderRadius: 999,
                                  "& .MuiChip-label": { px: 0.7 },
                                }}
                              />
                            ))}
                          </Box>
                        </Box>
                      )}
                    </Box>
                  </Box>

                  <Box sx={{ mb: 0.8 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.25 }}>
                      <Typography variant="caption" color="text.secondary">
                        <FormattedMessage id="config.general.library_disk_stats.disk_used" />
                      </Typography>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {formatPercent(percentOf(entry.usedBytes, entry.totalBytes))}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={percentOf(entry.usedBytes, entry.totalBytes)}
                      sx={{ height: 5, borderRadius: 999 }}
                    />
                  </Box>

                  <Box sx={{ mb: 0.8 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.25 }}>
                      <Typography variant="caption" color="text.secondary">
                        <FormattedMessage id="config.general.library_disk_stats.collection" />
                      </Typography>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {formatPercent(entry.collectionPercentOfDisk)}
                      </Typography>
                    </Box>
                    <LinearProgress
                      color="secondary"
                      variant="determinate"
                      value={percentOf(entry.collectionBytes, entry.totalBytes)}
                      sx={{ height: 5, borderRadius: 999 }}
                    />
                  </Box>

                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: "0.68rem" }}>
                    {intl.formatMessage(
                      { id: "config.general.library_disk_stats.media_usage" },
                      { collection: formatBytes(entry.collectionBytes) }
                    )}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: "0.68rem" }}>
                    {intl.formatMessage(
                      { id: "config.general.library_disk_stats.capacity" },
                      {
                        free: formatBytes(entry.freeBytes),
                        total: formatBytes(entry.totalBytes),
                      }
                    )}
                  </Typography>

                  {entry.error && (
                    <Box sx={{ mt: 0.5, display: "flex", gap: 0.5, alignItems: "center" }}>
                      <Typography
                        variant="caption"
                        color="warning.main"
                        sx={{ display: "block", fontSize: "0.68rem", flex: 1, minWidth: 0 }}
                        title={entry.error}
                        noWrap
                      >
                        {entry.error}
                      </Typography>
                      <Tooltip
                        title={intl.formatMessage({
                          id: "config.general.library_disk_stats.retry",
                          defaultMessage: "Retry",
                        })}
                      >
                        <IconButton
                          size="small"
                          onClick={() => {
                            void refetchLibraryDiskStats();
                            setLastRefreshAt(Date.now());
                          }}
                          sx={{ p: 0.35 }}
                          aria-label={intl.formatMessage({
                            id: "config.general.library_disk_stats.retry",
                            defaultMessage: "Retry",
                          })}
                        >
                          <RefreshRoundedIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              <FormattedMessage id="config.general.library_disk_stats.empty" />
            </Typography>
          )}
        </Box>
      </Box>

      <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left: Folder tree */}
        <Box
          sx={{
            width: 280,
            flexShrink: 0,
            overflow: "auto",
            borderRight: 1,
            borderColor: "divider",
          }}
        >
          <FileBrowserTree
            selectedId={selectedFolderId}
            onSelect={setSelectedFolderId}
            expandedIds={expandedFolderIds}
            onToggleExpanded={handleToggleExpanded}
          />
        </Box>

        {/* Right: Content panel */}
        <Box sx={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {selectedFolderId && (
            <>
              <Box sx={{ px: 2, pt: 1.5, flexShrink: 0 }}>
                <FileBrowserBreadcrumb
                  folderId={selectedFolderId}
                  onNavigate={setSelectedFolderId}
                />
              </Box>
              <Divider />
            </>
          )}
          <Box sx={{ flex: 1, overflow: "auto" }}>
            {selectedFolderId ? (
              <FileBrowserContent
                key={selectedFolderId}
                folderId={selectedFolderId}
              />
            ) : (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "text.secondary",
                }}
              >
                <Typography variant="body1">
                  <FormattedMessage
                    id="file-browser.select_folder"
                    defaultMessage="Select a folder to view its contents"
                  />
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default FileBrowser;

