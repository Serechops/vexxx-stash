import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FormattedMessage } from "react-intl";
import {
  Box,
  Chip,
  CircularProgress,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { FileSize } from "src/components/Shared/FileSize";

const PAGE_SIZE = 100;

interface IFileBrowserContentProps {
  folderId: string;
}

type ContentRow = {
  id: string;
  type: "scene" | "image" | "gallery";
  basename: string;
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
  const [page, setPage] = useState(1);
  const pageFilter = { page, per_page: PAGE_SIZE };
  const filter = folderFilter(folderId);

  const { data: scenesData, loading: scenesLoading } =
    GQL.useFileBrowserScenesQuery({
      variables: {
        filter: pageFilter,
        scene_filter: { parent_folder: filter },
      },
    });

  const { data: imagesData, loading: imagesLoading } =
    GQL.useFileBrowserImagesQuery({
      variables: {
        filter: pageFilter,
        image_filter: { parent_folder: filter },
      },
    });

  const { data: galleriesData, loading: galleriesLoading } =
    GQL.useFileBrowserGalleriesQuery({
      variables: {
        filter: pageFilter,
        gallery_filter: { parent_folder: filter },
      },
    });

  const rows = useMemo<ContentRow[]>(() => {
    const result: ContentRow[] = [];

    for (const scene of scenesData?.findScenes.scenes ?? []) {
      const file = scene.files[0];
      if (file) {
        result.push({
          id: scene.id,
          type: "scene",
          basename: file.basename,
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
          basename: file.basename,
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
          basename: file.basename,
          href: `/galleries/${gallery.id}`,
          size: file.size,
          mod_time: file.mod_time,
        });
      }
    }

    return result.sort((a, b) =>
      a.basename.localeCompare(b.basename, undefined, { sensitivity: "base" })
    );
  }, [scenesData, imagesData, galleriesData]);

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

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TableContainer sx={{ flex: 1, overflow: "auto" }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>
                <FormattedMessage
                  id="file_browser.col_name"
                  defaultMessage="Name"
                />
              </TableCell>
              <TableCell sx={{ width: 90 }}>
                <FormattedMessage
                  id="file_browser.col_type"
                  defaultMessage="Type"
                />
              </TableCell>
              <TableCell sx={{ width: 100 }} align="right">
                <FormattedMessage
                  id="file_browser.col_size"
                  defaultMessage="Size"
                />
              </TableCell>
              <TableCell sx={{ width: 170 }}>
                <FormattedMessage
                  id="file_browser.col_modified"
                  defaultMessage="Modified"
                />
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={`${row.type}-${row.id}`}
                hover
                sx={{ "&:last-child td": { borderBottom: 0 } }}
              >
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
