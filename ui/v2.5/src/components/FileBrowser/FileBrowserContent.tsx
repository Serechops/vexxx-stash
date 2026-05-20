import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  LinearProgress,
  Pagination,
  Popover,
  Slider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import DriveFileMoveIcon from "@mui/icons-material/DriveFileMove";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import SearchIcon from "@mui/icons-material/Search";
import SettingsIcon from "@mui/icons-material/Settings";
import StopIcon from "@mui/icons-material/Stop";
import ViewListIcon from "@mui/icons-material/ViewList";
import ViewModuleIcon from "@mui/icons-material/ViewModule";
import * as GQL from "src/core/generated-graphql";
import { FileSize } from "src/components/Shared/FileSize";
import { FileBrowserDetailsPanel } from "./FileBrowserDetailsPanel";
import { FileBrowserQuickTag } from "./FileBrowserQuickTag";
import { FileBrowserRowActions } from "./FileBrowserRowActions";
import { FileBrowserRowMenu } from "./FileBrowserRowMenu";
import { FolderPickerDialog } from "./FolderPickerDialog";
import { useStashTagStore } from "./useStashTagStore";

const PAGE_SIZE = 100;

interface IFileBrowserContentProps {
  folderId: string;
}

type ContentRow = {
  id: string;
  type: "scene" | "image" | "gallery";
  title: string | null;
  basename: string;
  fileId: string;
  parentFolderId: string;
  filePath: string;
  href: string;
  size: number;
  mod_time: string;
  thumbnailUrl: string | null;
  studioName: string | null;
  studioId: string | null;
  studioLogoUrl: string | null;
  tags: Array<{ id: string; name: string }>;
};

const TYPE_LABELS: Record<ContentRow["type"], string> = {
  scene: "Scene",
  image: "Image",
  gallery: "Gallery",
};

const TYPE_COLORS: Record<
  ContentRow["type"],
  | "default"
  | "primary"
  | "secondary"
  | "info"
  | "success"
  | "warning"
  | "error"
> = {
  scene: "primary",
  image: "success",
  gallery: "info",
};

const folderFilter = (
  folderId: string
): GQL.HierarchicalMultiCriterionInput => ({
  value: [folderId],
  modifier: GQL.CriterionModifier.Includes,
  depth: -1,
});

export const FileBrowserContent: React.FC<IFileBrowserContentProps> = ({
  folderId,
}) => {
  const intl = useIntl();
  const store = useStashTagStore();
  const [page, setPage] = useState(1);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortCol, setSortCol] = useState<"basename" | "size" | "mod_time" | "studio">("basename");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">(
    () => (localStorage.getItem("fileBrowser.viewMode") as "list" | "grid") ?? "list"
  );
  const [filterAIReady, setFilterAIReady] = useState(false);
  // AI settings popover
  const [aiSettingsAnchor, setAiSettingsAnchor] = useState<HTMLElement | null>(null);
  const [aiThreshold, setAiThreshold] = useState(0.5);
  const [aiAcceptThreshold, setAiAcceptThreshold] = useState(75);

  const handleSetViewMode = (v: "list" | "grid") => {
    localStorage.setItem("fileBrowser.viewMode", v);
    setViewMode(v);
  };
  const [detailsRow, setDetailsRow] = useState<ContentRow | null>(null);
  const [isQuickTagOpen, setIsQuickTagOpen] = useState(() =>
    localStorage.getItem("fileBrowser.quickTag.open") === "true"
  );
  const [isQuickTagLocked, setIsQuickTagLocked] = useState(() =>
    localStorage.getItem("fileBrowser.quickTag.locked") === "true"
  );

  const handleQuickTagLockedChange = (locked: boolean) => {
    setIsQuickTagLocked(locked);
    localStorage.setItem("fileBrowser.quickTag.locked", String(locked));
    if (!locked) {
      setIsQuickTagOpen(false);
      localStorage.setItem("fileBrowser.quickTag.open", "false");
    }
  };

  const handleQuickTagToggle = () => {
    setIsQuickTagOpen((o) => {
      const next = !o;
      localStorage.setItem("fileBrowser.quickTag.open", String(next));
      return next;
    });
  };
  const [contextMenuRow, setContextMenuRow] = useState<ContentRow | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [contextMenuOpen, setContextMenuOpen] = useState(false);

  // Debounce the search so query variables (and thus fetches) only update
  // after the user stops typing, preventing the input from losing focus.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
      setSelectedFileIds(new Set());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSort = (col: "basename" | "size" | "mod_time" | "studio") => {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
  };

  const pageFilter = { page, per_page: PAGE_SIZE, q: debouncedSearch || undefined };
  const filter = folderFilter(folderId);

  const {
    data: scenesData,
    loading: scenesLoading,
    refetch: refetchScenes,
  } = GQL.useFileBrowserScenesQuery({
    variables: {
      filter: pageFilter,
      scene_filter: { parent_folder: filter },
    },
  });

  const {
    data: imagesData,
    loading: imagesLoading,
    refetch: refetchImages,
  } = GQL.useFileBrowserImagesQuery({
    variables: {
      filter: pageFilter,
      image_filter: { parent_folder: filter },
    },
  });

  const {
    data: galleriesData,
    loading: galleriesLoading,
    refetch: refetchGalleries,
  } = GQL.useFileBrowserGalleriesQuery({
    variables: {
      filter: pageFilter,
      gallery_filter: { parent_folder: filter },
    },
  });

  const handleRefetch = () => {
    refetchScenes();
    refetchImages();
    refetchGalleries();
    setSelectedFileIds(new Set());
  };

  const handleRowSelect = (fileId: string, checked: boolean) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(fileId);
      else next.delete(fileId);
      return next;
    });
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedFileIds(
      checked ? new Set(rows.map((r) => r.fileId)) : new Set()
    );
  };

  const rows = useMemo<ContentRow[]>(() => {
    const result: ContentRow[] = [];

    for (const scene of scenesData?.findScenes.scenes ?? []) {
      const file = scene.files[0];
      if (file) {
        result.push({
          id: scene.id,
          type: "scene",
          title: scene.title ?? null,
          basename: file.basename,
          fileId: file.id,
          parentFolderId: file.parent_folder?.id ?? "",
          filePath: "",
          href: `/scenes/${scene.id}`,
          size: file.size,
          mod_time: file.mod_time,
          thumbnailUrl: scene.paths.screenshot ?? null,
          studioName: scene.studio?.name ?? null,
          studioId: scene.studio?.id ?? null,
          studioLogoUrl: scene.studio?.image_path ?? null,
          tags: scene.tags.map((t) => ({ id: t.id, name: t.name })),
        });
      }
    }

    for (const image of imagesData?.findImages.images ?? []) {
      const file = image.visual_files[0];
      if (file) {
        result.push({
          id: image.id,
          type: "image",
          title: image.title ?? null,
          basename: file.basename,
          fileId: file.id,
          parentFolderId:
            "parent_folder" in file ? (file.parent_folder?.id ?? "") : "",
          filePath: "",
          href: `/images/${image.id}`,
          size: file.size,
          mod_time: file.mod_time,
          thumbnailUrl: image.paths.thumbnail ?? null,
          studioName: image.studio?.name ?? null,
          studioId: image.studio?.id ?? null,
          studioLogoUrl: image.studio?.image_path ?? null,
          tags: image.tags.map((t) => ({ id: t.id, name: t.name })),
        });
      }
    }

    for (const gallery of galleriesData?.findGalleries.galleries ?? []) {
      const file = gallery.files[0];
      if (file) {
        result.push({
          id: gallery.id,
          type: "gallery",
          title: gallery.title ?? null,
          basename: file.basename,
          fileId: file.id,
          parentFolderId: file.parent_folder?.id ?? "",
          filePath: "",
          href: `/galleries/${gallery.id}`,
          size: file.size,
          mod_time: file.mod_time,
          thumbnailUrl: gallery.paths.cover ?? null,
          studioName: gallery.studio?.name ?? null,
          studioId: gallery.studio?.id ?? null,
          studioLogoUrl: gallery.studio?.image_path ?? null,
          tags: gallery.tags.map((t) => ({ id: t.id, name: t.name })),
        });
      }
    }

    result.sort((a, b) => {
      let cmp = 0;
      if (sortCol === "basename") {
        cmp = a.basename.localeCompare(b.basename, undefined, {
          sensitivity: "base",
        });
      } else if (sortCol === "size") {
        cmp = a.size - b.size;
      } else if (sortCol === "studio") {
        cmp = (a.studioName ?? "").localeCompare(b.studioName ?? "", undefined, { sensitivity: "base" });
      } else {
        cmp =
          new Date(a.mod_time).getTime() - new Date(b.mod_time).getTime();
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [scenesData, imagesData, galleriesData, sortCol, sortDir]);

  // Total counts (from server, not just this page)
  const totalScenes = scenesData?.findScenes.count ?? 0;
  const totalImages = imagesData?.findImages.count ?? 0;
  const totalGalleries = galleriesData?.findGalleries.count ?? 0;
  const totalItems = totalScenes + totalImages + totalGalleries;
  // Page count is the maximum across all three independent query streams
  const pageCount = Math.max(
    Math.ceil(totalScenes / PAGE_SIZE),
    Math.ceil(totalImages / PAGE_SIZE),
    Math.ceil(totalGalleries / PAGE_SIZE),
    1
  );

  const loading = scenesLoading || imagesLoading || galleriesLoading;

  const numSelected = selectedFileIds.size;
  const allSelected = rows.length > 0 && numSelected === rows.length;
  const someSelected = numSelected > 0 && !allSelected;
  const selectedSize = useMemo(
    () =>
      rows
        .filter((r) => selectedFileIds.has(r.fileId))
        .reduce((acc, r) => acc + r.size, 0),
    [rows, selectedFileIds]
  );

  // Scene IDs currently selected (for AI analysis)
  const selectedSceneIds = useMemo(
    () =>
      rows
        .filter((r) => r.type === "scene" && selectedFileIds.has(r.fileId))
        .map((r) => r.id),
    [rows, selectedFileIds]
  );

  // Client-side AI-ready filter
  const displayRows = useMemo(
    () =>
      filterAIReady
        ? rows.filter((r) => r.type === "scene" && store.hasResult(r.id))
        : rows,
    [rows, filterAIReady, store.hasResult]
  );

  if (loading && rows.length === 0) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!loading && rows.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          <FormattedMessage
            id="file_browser.no_files"
            defaultMessage="No scenes, images, or galleries in this folder."
          />
        </Typography>
      </Box>
    );
  }

  const handleContextMenu = (
    e: React.MouseEvent,
    row: ContentRow
  ) => {
    e.preventDefault();
    e.stopPropagation();
    // Auto-select the right-clicked row if not already selected
    if (!selectedFileIds.has(row.fileId)) {
      setSelectedFileIds((prev) => new Set([...prev, row.fileId]));
    }
    setContextMenuRow(row);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setContextMenuOpen(true);
  };

  return (
    <Box sx={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Main content column */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Context menu — kept mounted so child dialogs survive menu close */}
      {contextMenuRow && (
        <FileBrowserRowMenu
          row={contextMenuRow}
          open={contextMenuOpen}
          onClose={() => setContextMenuOpen(false)}
          onRefetch={() => {
            setContextMenuOpen(false);
            setContextMenuRow(null);
            handleRefetch();
          }}
          onShowDetails={() => {
            setDetailsRow(contextMenuRow);
            setContextMenuOpen(false);
          }}
          anchorPosition={{ top: contextMenuPos.y, left: contextMenuPos.x }}
        />
      )}

      {/* Bulk action toolbar — visible only when items are selected */}
      {numSelected > 0 && (
        <Toolbar
          variant="dense"
          sx={{
            bgcolor: "action.selected",
            flexShrink: 0,
            gap: 2,
            px: 2,
          }}
        >
          <Typography variant="body2" sx={{ flex: 1 }}>
            <FormattedMessage
              id="file_browser.selected_count"
              defaultMessage="{count, plural, one {# item selected} other {# items selected}}"
              values={{ count: numSelected }}
            />
            {" · "}
            <FileSize size={selectedSize} />
          </Typography>

          {/* AI analysis actions */}
          {store.isRunning ? (
            <>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 120 }}>
                <CircularProgress size={14} />
                <Typography variant="caption">
                  {store.jobProgress != null
                    ? `AI ${Math.round(store.jobProgress * 100)}%`
                    : "Analysing…"}
                </Typography>
              </Box>
              {store.jobProgress != null && (
                <LinearProgress
                  variant="determinate"
                  value={store.jobProgress * 100}
                  sx={{ width: 60 }}
                />
              )}
              <Tooltip title="Stop AI analysis">
                <IconButton size="small" onClick={store.stopJob}>
                  <StopIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          ) : selectedSceneIds.length > 0 ? (
            <>
              <Tooltip title="Configure analysis settings">
                <IconButton
                  size="small"
                  onClick={(e) => setAiSettingsAnchor(e.currentTarget)}
                >
                  <SettingsIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AutoFixHighIcon />}
                onClick={() =>
                  store.runAnalysis(selectedSceneIds, {
                    threshold: aiThreshold,
                    autoAcceptThreshold: aiAcceptThreshold,
                    autoGenerateSprites: false,
                  })
                }
              >
                Analyse {selectedSceneIds.length} scene
                {selectedSceneIds.length !== 1 ? "s" : ""}
              </Button>
            </>
          ) : null}

          <Button
            size="small"
            variant="outlined"
            startIcon={<DriveFileMoveIcon />}
            onClick={() => setBulkMoveOpen(true)}
          >
            <FormattedMessage
              id="file_browser.bulk_move"
              defaultMessage="Move To…"
            />
          </Button>
          <Button
            size="small"
            onClick={() => setSelectedFileIds(new Set())}
          >
            <FormattedMessage
              id="file_browser.clear_selection"
              defaultMessage="Clear"
            />
          </Button>
        </Toolbar>
      )}

      {/* AI settings popover */}
      <Popover
        open={Boolean(aiSettingsAnchor)}
        anchorEl={aiSettingsAnchor}
        onClose={() => setAiSettingsAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Box sx={{ p: 2, width: 240 }}>
          <Typography variant="caption" gutterBottom display="block" fontWeight={600}>
            Analysis Settings
          </Typography>
          <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>
            Confidence threshold: {Math.round(aiThreshold * 100)}%
          </Typography>
          <Slider
            size="small"
            min={20}
            max={90}
            value={Math.round(aiThreshold * 100)}
            onChange={(_, v) => setAiThreshold((v as number) / 100)}
          />
          <Typography variant="caption" display="block" sx={{ mt: 1, mb: 0.5 }}>
            Auto-accept threshold: {aiAcceptThreshold}%
          </Typography>
          <Slider
            size="small"
            min={50}
            max={95}
            value={aiAcceptThreshold}
            onChange={(_, v) => setAiAcceptThreshold(v as number)}
          />
        </Box>
      </Popover>

      <FolderPickerDialog
        open={bulkMoveOpen}
        onClose={() => setBulkMoveOpen(false)}
        fileIds={Array.from(selectedFileIds)}
        onSuccess={handleRefetch}
      />

      {/* Search bar + view toggle */}
      <Box
        sx={{
          px: 2,
          py: 1,
          flexShrink: 0,
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <TextField
          size="small"
          fullWidth
          placeholder={intl.formatMessage({
            id: "file_browser.search_placeholder",
            defaultMessage: "Filter by name…",
          })}
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        {/* AI-ready filter chip */}
        {store.pendingReviewCount > 0 && (
          <Tooltip title="Show only AI-ready scenes">
            <Chip
              icon={<AutoFixHighIcon sx={{ fontSize: "0.85rem !important" }} />}
              label={`AI: ${store.pendingReviewCount}`}
              size="small"
              color={filterAIReady ? "secondary" : "default"}
              variant={filterAIReady ? "filled" : "outlined"}
              onClick={() => setFilterAIReady((f) => !f)}
            />
          </Tooltip>
        )}
        <IconButton
          size="small"
          onClick={() => handleSetViewMode(viewMode === "list" ? "grid" : "list")}
          title={viewMode === "list" ? "Switch to grid view" : "Switch to list view"}
        >
          {viewMode === "list" ? <ViewModuleIcon fontSize="small" /> : <ViewListIcon fontSize="small" />}
        </IconButton>
        <IconButton
          size="small"
          onClick={handleQuickTagToggle}
          title="Quick Tag"
          color={isQuickTagOpen ? "primary" : "default"}
        >
          <LocalOfferIcon fontSize="small" />
        </IconButton>
      </Box>

      {viewMode === "grid" ? (
        /* ── Grid view: Windows Explorer–style tiles ── */
        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 0.75,
            }}
          >
            {displayRows.map((row) => {
              const selected = selectedFileIds.has(row.fileId);
              const hovered = hoveredId === row.fileId;
              return (
                <Box
                  key={`${row.type}-${row.id}`}
                  onContextMenu={(e) => handleContextMenu(e, row)}
                  onMouseEnter={() => setHoveredId(row.fileId)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey || numSelected > 0) {
                      handleRowSelect(row.fileId, !selected);
                    } else {
                      setDetailsRow(row);
                    }
                  }}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    p: "4px 6px",
                    borderRadius: 1,
                    cursor: "pointer",
                    userSelect: "none",
                    border: "1px solid",
                    borderColor: selected ? "primary.main" : "transparent",
                    bgcolor: selected ? "action.selected" : "transparent",
                    "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" },
                    transition: "background-color 0.1s, border-color 0.1s",
                  }}
                >
                  {/* Thumbnail */}
                  <Box
                    sx={{
                      width: 128,
                      height: 128,
                      flexShrink: 0,
                      borderRadius: 0.5,
                      overflow: "hidden",
                      bgcolor: "action.hover",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      position: "relative",
                    }}
                  >
                    {row.thumbnailUrl ? (
                      <Box
                        component="img"
                        src={row.thumbnailUrl}
                        alt=""
                        sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    ) : (
                      <Typography sx={{ fontSize: "1.4rem", lineHeight: 1, color: "text.disabled" }}>
                        {row.type === "scene" ? "🎬" : row.type === "image" ? "🖼" : "🗂"}
                      </Typography>
                    )}
                    {/* Tiny type badge */}
                    <Box
                      sx={{
                        position: "absolute",
                        bottom: 1,
                        right: 1,
                        bgcolor: TYPE_COLORS[row.type] === "primary" ? "primary.main"
                          : TYPE_COLORS[row.type] === "success" ? "success.main"
                          : "info.main",
                        borderRadius: "2px",
                        width: 6,
                        height: 6,
                      }}
                    />
                    {/* Hover/selection checkbox — top-left of thumbnail */}
                    {(hovered || selected) && (
                      <Checkbox
                        size="small"
                        checked={selected}
                        onChange={(e) => { e.stopPropagation(); handleRowSelect(row.fileId, e.target.checked); }}
                        onClick={(e) => e.stopPropagation()}
                        sx={{
                          position: "absolute",
                          top: 2,
                          left: 2,
                          p: 0,
                          bgcolor: "rgba(0,0,0,0.45)",
                          borderRadius: "3px",
                          "& .MuiSvgIcon-root": { fontSize: 18, color: "white" },
                        }}
                      />
                    )}
                  </Box>

                  {/* Label */}
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography
                      variant="caption"
                      sx={{
                        display: "inline-block",
                        maxWidth: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        lineHeight: 1.25,
                        color: "text.primary",
                      }}
                    >
                      {row.title || row.basename}
                    </Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: "0.6rem", display: "block" }}>
                      <FileSize size={row.size} />
                    </Typography>
                    <Chip
                      label={TYPE_LABELS[row.type]}
                      color={TYPE_COLORS[row.type]}
                      size="small"
                      variant="outlined"
                      sx={{ mt: 0.5, height: 16, fontSize: "0.6rem", "& .MuiChip-label": { px: 0.75 } }}
                    />
                    {row.type === "scene" && store.hasResult(row.id) && (
                      <Chip
                        icon={<AutoFixHighIcon sx={{ fontSize: "0.7rem !important" }} />}
                        label="AI"
                        color="secondary"
                        size="small"
                        variant="filled"
                        sx={{ mt: 0.5, ml: 0.5, height: 16, fontSize: "0.6rem", "& .MuiChip-label": { px: 0.5 } }}
                      />
                    )}
                    {row.studioId && (
                      <Typography
                        variant="caption"
                        component={Link}
                        to={`/studios/${row.studioId}`}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        color="text.secondary"
                        noWrap
                        sx={{ display: "block", mt: 0.5, fontSize: "0.6rem", textDecoration: "none", "&:hover": { textDecoration: "underline", color: "primary.main" } }}
                      >
                        {row.studioName}
                      </Typography>
                    )}
                  </Box>


                </Box>
              );
            })}
          </Box>
        </Box>
      ) : (
      <TableContainer sx={{ flex: 1, overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    inputProps={{ "aria-label": "select all" }}
                  />
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortCol === "basename"}
                    direction={sortCol === "basename" ? sortDir : "asc"}
                    onClick={() => handleSort("basename")}
                  >
                    <FormattedMessage id="file_browser.col_name" defaultMessage="Name" />
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ width: 90 }}>
                  <FormattedMessage id="file_browser.col_type" defaultMessage="Type" />
                </TableCell>
                <TableCell sx={{ width: 100 }} align="right">
                  <FormattedMessage id="file_browser.col_actions" defaultMessage="Actions" />
                </TableCell>
                <TableCell sx={{ width: 100 }} align="right">
                  <TableSortLabel
                    active={sortCol === "size"}
                    direction={sortCol === "size" ? sortDir : "asc"}
                    onClick={() => handleSort("size")}
                  >
                    <FormattedMessage id="file_browser.col_size" defaultMessage="Size" />
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ width: 170 }}>
                  <TableSortLabel
                    active={sortCol === "mod_time"}
                    direction={sortCol === "mod_time" ? sortDir : "asc"}
                    onClick={() => handleSort("mod_time")}
                  >
                    <FormattedMessage id="file_browser.col_modified" defaultMessage="Modified" />
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ width: 120 }}>
                  <FormattedMessage id="file_browser.col_preview" defaultMessage="Preview" />
                </TableCell>
                <TableCell sx={{ width: 140 }}>
                  <TableSortLabel
                    active={sortCol === "studio"}
                    direction={sortCol === "studio" ? sortDir : "asc"}
                    onClick={() => handleSort("studio")}
                  >
                    <FormattedMessage id="file_browser.col_studio" defaultMessage="Studio" />
                  </TableSortLabel>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
            {displayRows.map((row) => (
                <TableRow
                  key={`${row.type}-${row.id}`}
                  hover
                  selected={selectedFileIds.has(row.fileId)}
                  onContextMenu={(e) => handleContextMenu(e, row)}
                  onClick={() => setDetailsRow(row)}
                  sx={{ "&:last-child td": { borderBottom: 0 }, cursor: "pointer" }}
                >
                  <TableCell padding="checkbox" sx={{ pr: 0 }}>
                    <Box sx={{ display: "flex", alignItems: "center" }}>
                      <Checkbox
                        size="small"
                        checked={selectedFileIds.has(row.fileId)}
                        onChange={(e) => {
                          handleRowSelect(row.fileId, e.target.checked);
                          setDetailsRow(row);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        inputProps={{ "aria-label": `select ${row.basename}` }}
                      />
                      <IconButton
                        size="small"
                        onClick={(e) => { e.stopPropagation(); setDetailsRow(row); }}
                        sx={{ p: 0.25, color: detailsRow?.id === row.id ? "primary.main" : "action.disabled", "&:hover": { color: "primary.main" } }}
                        aria-label="show details"
                      >
                        <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Link to={row.href} style={{ textDecoration: "none" }} onClick={(e) => e.stopPropagation()}>
                      <Typography
                        variant="body2"
                        color="primary"
                        noWrap
                        sx={{ display: "inline-block", maxWidth: "100%", verticalAlign: "bottom", "&:hover": { textDecoration: "underline" } }}
                      >
                        {row.basename}
                      </Typography>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                      <Chip
                        label={TYPE_LABELS[row.type]}
                        color={TYPE_COLORS[row.type]}
                        size="small"
                        variant="outlined"
                      />
                      {row.type === "scene" && store.hasResult(row.id) && (
                        <Chip
                          icon={<AutoFixHighIcon sx={{ fontSize: "0.7rem !important" }} />}
                          label="AI"
                          color="secondary"
                          size="small"
                          variant="filled"
                          sx={{ height: 20, fontSize: "0.6rem", "& .MuiChip-label": { px: 0.5 } }}
                        />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ py: 0 }} onClick={(e) => e.stopPropagation()}>
                    <FileBrowserRowActions
                      row={row}
                      onRefetch={handleRefetch}
                      onShowDetails={() => setDetailsRow(row)}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" color="text.secondary">
                      <FileSize size={row.size} />
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {new Date(row.mod_time).toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 0.5 }}>
                    {row.thumbnailUrl ? (
                      <Box
                        component="img"
                        src={row.thumbnailUrl}
                        alt=""
                        onClick={() => setDetailsRow(row)}
                        sx={{
                          display: "block",
                          width: 112,
                          height: 63,
                          objectFit: "cover",
                          borderRadius: 0.5,
                          cursor: "pointer",
                          "&:hover": { opacity: 0.85 },
                        }}
                      />
                    ) : (
                      <Box sx={{ width: 112, height: 63, borderRadius: 0.5, bgcolor: "action.hover" }} />
                    )}
                  </TableCell>
                  <TableCell sx={{ py: 0.5 }}>
                    {row.studioId ? (
                      <Link
                        to={`/studios/${row.studioId}`}
                        style={{ textDecoration: "none" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 130 }}>
                          {row.studioName}
                        </Typography>
                      </Link>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}{/* end view mode */}

      {/* Footer: item count + pagination */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1,
          borderTop: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {loading ? (
            <CircularProgress size={12} sx={{ mr: 1 }} />
          ) : (
            <FormattedMessage
              id="file_browser.item_count"
              defaultMessage="{count, plural, one {# item} other {# items}}"
              values={{ count: totalItems }}
            />
          )}
        </Typography>
        {pageCount > 1 && (
          <Pagination
            count={pageCount}
            page={page}
            onChange={(_, p) => setPage(p)}
            size="small"
            siblingCount={1}
          />
        )}
      </Box>
      </Box>{/* end main content column */}

      {/* Details panel */}
      {detailsRow && (
        <FileBrowserDetailsPanel
          id={detailsRow.id}
          type={detailsRow.type}
          onClose={() => setDetailsRow(null)}
          getSceneResult={store.getResult}
          onSceneDismissed={store.dismissScene}
          onApplied={handleRefetch}
        />
      )}

      {/* Quick Tag panel */}
      {isQuickTagOpen && (
        <FileBrowserQuickTag
          selectedRows={rows
            .filter((r) => selectedFileIds.has(r.fileId))
            .map((r) => ({
              id: r.id,
              type: r.type,
              tags: r.tags,
              label: r.title || r.basename,
            }))}
          locked={isQuickTagLocked}
          onLockedChange={handleQuickTagLockedChange}
          onClose={() => {
            setIsQuickTagOpen(false);
            localStorage.setItem("fileBrowser.quickTag.open", "false");
          }}
          onApplied={() => {
            refetchScenes();
            refetchImages();
            refetchGalleries();
          }}
        />
      )}
    </Box>
  );
};
