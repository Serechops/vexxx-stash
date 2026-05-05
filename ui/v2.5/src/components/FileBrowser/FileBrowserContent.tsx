import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  InputAdornment,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Toolbar,
  Typography,
} from "@mui/material";
import DriveFileMoveIcon from "@mui/icons-material/DriveFileMove";
import SearchIcon from "@mui/icons-material/Search";
import * as GQL from "src/core/generated-graphql";
import { FileSize } from "src/components/Shared/FileSize";
import { FileBrowserRowActions } from "./FileBrowserRowActions";
import { FolderPickerDialog } from "./FolderPickerDialog";

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
  href: string;
  size: number;
  mod_time: string;
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
  const [page, setPage] = useState(1);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(
    new Set()
  );
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortCol, setSortCol] = useState<"basename" | "size" | "mod_time">(
    "basename"
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

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

  const handleSort = (col: "basename" | "size" | "mod_time") => {
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
          href: `/scenes/${scene.id}`,
          size: file.size,
          mod_time: file.mod_time,
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
          href: `/images/${image.id}`,
          size: file.size,
          mod_time: file.mod_time,
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
          href: `/galleries/${gallery.id}`,
          size: file.size,
          mod_time: file.mod_time,
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

  const numSelected = selectedFileIds.size;
  const allSelected = rows.length > 0 && numSelected === rows.length;
  const someSelected = numSelected > 0 && !allSelected;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
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
          </Typography>
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

      <FolderPickerDialog
        open={bulkMoveOpen}
        onClose={() => setBulkMoveOpen(false)}
        fileIds={Array.from(selectedFileIds)}
        onSuccess={handleRefetch}
      />

      {/* Search bar */}
      <Box
        sx={{
          px: 2,
          py: 1,
          flexShrink: 0,
          borderBottom: 1,
          borderColor: "divider",
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
      </Box>

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
                  <FormattedMessage
                    id="file_browser.col_name"
                    defaultMessage="Name"
                  />
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ width: 90 }}>
                <FormattedMessage
                  id="file_browser.col_type"
                  defaultMessage="Type"
                />
              </TableCell>
              <TableCell sx={{ width: 100 }} align="right">
                <FormattedMessage
                  id="file_browser.col_actions"
                  defaultMessage="Actions"
                />
              </TableCell>
              <TableCell sx={{ width: 100 }} align="right">
                <TableSortLabel
                  active={sortCol === "size"}
                  direction={sortCol === "size" ? sortDir : "asc"}
                  onClick={() => handleSort("size")}
                >
                  <FormattedMessage
                    id="file_browser.col_size"
                    defaultMessage="Size"
                  />
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ width: 170 }}>
                <TableSortLabel
                  active={sortCol === "mod_time"}
                  direction={sortCol === "mod_time" ? sortDir : "asc"}
                  onClick={() => handleSort("mod_time")}
                >
                  <FormattedMessage
                    id="file_browser.col_modified"
                    defaultMessage="Modified"
                  />
                </TableSortLabel>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={`${row.type}-${row.id}`}
                hover
                selected={selectedFileIds.has(row.fileId)}
                sx={{ "&:last-child td": { borderBottom: 0 } }}
              >
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={selectedFileIds.has(row.fileId)}
                    onChange={(e) =>
                      handleRowSelect(row.fileId, e.target.checked)
                    }
                    onClick={(e) => e.stopPropagation()}
                    inputProps={{ "aria-label": `select ${row.basename}` }}
                  />
                </TableCell>
                <TableCell>
                  <Link to={row.href} style={{ textDecoration: "none" }}>
                    <Typography
                      variant="body2"
                      color="primary"
                      sx={{ "&:hover": { textDecoration: "underline" } }}
                    >
                      {row.basename}
                    </Typography>
                  </Link>
                </TableCell>
                <TableCell>
                  <Chip
                    label={TYPE_LABELS[row.type]}
                    color={TYPE_COLORS[row.type]}
                    size="small"
                    variant="outlined"
                  />
                </TableCell>
                <TableCell align="right" sx={{ py: 0 }}>
                  <FileBrowserRowActions row={row} onRefetch={handleRefetch} />
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

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
    </Box>
  );
};
