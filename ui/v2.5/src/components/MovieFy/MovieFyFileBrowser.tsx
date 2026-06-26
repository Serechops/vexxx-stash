import React, { useMemo, useState } from "react";
import {
  Box,
  Checkbox,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import StorageIcon from "@mui/icons-material/Storage";
import * as GQL from "src/core/generated-graphql";
import { useConfigurationContext } from "src/hooks/Config";

// SceneItem mirrors the shape MovieFy keeps in its selection/queue state. Kept
// structurally identical so scenes picked via the browser flow through the same
// "Add to Queue" / "Process Now" paths as scenes picked via the search tab.
export interface SceneItem {
  id: string;
  title?: string | null;
  paths: {
    screenshot?: string | null;
  };
  files: Array<{
    path: string;
    basename?: string;
  }>;
  groups?: Array<{
    group: { id: string; name: string };
    scene_index?: number;
  }>;
  new_scene_index?: number;
  studio?: { id: string } | null;
  tags?: Array<{ id: string }>;
  performers?: Array<{ id: string }>;
}

const basename = (p: string) => {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || p;
};

// ─── Recursive filesystem folder node (backed by the directory() query) ───────
// Unlike the File Browser tree, this walks the real disk via GQL rather than
// scanned Folder records, so every configured library is browsable even if it
// has never been scanned.

interface IDirNodeProps {
  path: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (path: string) => void;
  /** Override the label (used to show the full path on library roots). */
  label?: string;
}

const DirectoryNode: React.FC<IDirNodeProps> = ({
  path,
  depth,
  selectedPath,
  onSelect,
  expandedPaths,
  onToggleExpanded,
  label,
}) => {
  const expanded = expandedPaths.has(path);

  const { data, loading, error } = GQL.useDirectoryQuery({
    variables: { path },
    skip: !expanded,
    fetchPolicy: "cache-first",
  });

  const children = data?.directory?.directories ?? [];
  const isSelected = selectedPath === path;

  return (
    <>
      <Tooltip title={path} placement="right" enterDelay={600} arrow>
        <ListItemButton
          selected={isSelected}
          sx={{ pl: 1 + depth * 2 }}
          onClick={() => onSelect(path)}
          onDoubleClick={() => onToggleExpanded(path)}
        >
          <ListItemIcon sx={{ minWidth: 24 }}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpanded(path);
              }}
              sx={{ p: 0.25 }}
              aria-label={expanded ? "Collapse folder" : "Expand folder"}
            >
              {loading ? (
                <CircularProgress size={16} />
              ) : expanded ? (
                <ExpandMoreIcon fontSize="small" />
              ) : (
                <ChevronRightIcon fontSize="small" />
              )}
            </IconButton>
          </ListItemIcon>
          <ListItemIcon sx={{ minWidth: 32 }}>
            {depth === 0 ? (
              <StorageIcon
                fontSize="small"
                color={isSelected ? "primary" : "inherit"}
              />
            ) : isSelected || expanded ? (
              <FolderOpenIcon
                fontSize="small"
                color={isSelected ? "primary" : "inherit"}
              />
            ) : (
              <FolderIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText
            primary={label ?? basename(path)}
            slotProps={{ primary: { variant: "body2", noWrap: true } }}
          />
        </ListItemButton>
      </Tooltip>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <List disablePadding>
          {children.map((child) => (
            <DirectoryNode
              key={child}
              path={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              expandedPaths={expandedPaths}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
          {expanded && !loading && children.length === 0 && (
            <ListItemButton disabled sx={{ pl: 1 + (depth + 1) * 2 }}>
              <ListItemText
                primary={error ? "Unable to read folder" : "No subfolders"}
                slotProps={{ primary: { variant: "body2", color: "text.disabled" } }}
              />
            </ListItemButton>
          )}
        </List>
      </Collapse>
    </>
  );
};

interface IMovieFyFileBrowserProps {
  selectedSceneIds: Set<string>;
  excludeGrouped: boolean;
  onToggleScene: (scene: SceneItem) => void;
  onBulkToggle: (scenes: SceneItem[], select: boolean) => void;
}

// Folder-driven scene picker for MovieFy's left column. Browses the real
// filesystem of every configured library (via the directory() query) so users
// can pick scene files by their actual path, instead of relying on the
// title-based search that assumed a depth-1 folder named after the movie.
export const MovieFyFileBrowser: React.FC<IMovieFyFileBrowserProps> = ({
  selectedSceneIds,
  excludeGrouped,
  onToggleScene,
  onBulkToggle,
}) => {
  const { configuration } = useConfigurationContext();
  const libraryPaths = useMemo(
    () => (configuration?.general.stashes ?? []).map((s) => s.path),
    [configuration]
  );

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const toggleExpanded = (p: string) =>
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  // Resolve the selected filesystem path to its scanned folder record. We can't
  // filter scenes by path string: Stash's INCLUDES modifier tokenises the value
  // on whitespace and OR-matches each word, so a folder like "Jenna Haze_Naomi"
  // would pull in every scene whose path contains any of those words, across all
  // libraries. Matching by folder id (as the File Browser does) is exact.
  const { data: folderData, loading: folderLoading } =
    GQL.useFindFoldersForQueryQuery({
      skip: !selectedPath,
      variables: {
        folder_filter: {
          path: {
            value: selectedPath ?? "",
            modifier: GQL.CriterionModifier.Equals,
          },
        },
      },
    });
  const folderId = folderData?.findFolders.folders[0]?.id;

  const { data, loading: scenesLoading } = GQL.useMovieFyFolderScenesQuery({
    skip: !folderId,
    variables: {
      filter: { per_page: -1, sort: "path" },
      // depth -1 → recurse into sub-folders, matching the File Browser.
      scene_filter: {
        parent_folder: {
          value: folderId ? [folderId] : [],
          modifier: GQL.CriterionModifier.Includes,
          depth: -1,
        },
      },
    },
  });

  const loading = folderLoading || scenesLoading;

  const scenes: SceneItem[] = useMemo(() => {
    const raw = data?.findScenes?.scenes ?? [];
    // Like the File Browser, this is every scene beneath the selected folder
    // (parent_folder with depth -1 recurses into sub-folders).
    const mapped: SceneItem[] = raw.map((s) => ({
      id: s.id,
      title: s.title,
      paths: { screenshot: s.paths.screenshot },
      files: s.files.map((f) => ({ path: f.path, basename: f.basename })),
      groups: s.groups?.map((g) => ({
        group: { id: g.group.id, name: g.group.name },
        scene_index: g.scene_index ?? undefined,
      })),
      studio: s.studio ? { id: s.studio.id } : null,
      tags: s.tags?.map((t) => ({ id: t.id })) ?? [],
      performers: s.performers?.map((p) => ({ id: p.id })) ?? [],
    }));
    return excludeGrouped
      ? mapped.filter((s) => !s.groups || s.groups.length === 0)
      : mapped;
  }, [data, excludeGrouped]);

  const allSelected =
    scenes.length > 0 && scenes.every((s) => selectedSceneIds.has(s.id));
  const someSelected = scenes.some((s) => selectedSceneIds.has(s.id));

  return (
    <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
      {/* Filesystem folder tree, seeded from configured libraries */}
      <Box
        sx={{
          width: 280,
          flexShrink: 0,
          borderRight: 1,
          borderColor: "divider",
          overflow: "auto",
        }}
      >
        {libraryPaths.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            No library folders configured.
          </Typography>
        ) : (
          <List dense disablePadding>
            {libraryPaths.map((p, idx) => (
              <React.Fragment key={p}>
                {idx > 0 && <Divider />}
                <DirectoryNode
                  path={p}
                  depth={0}
                  label={p}
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                  expandedPaths={expandedPaths}
                  onToggleExpanded={toggleExpanded}
                />
              </React.Fragment>
            ))}
          </List>
        )}
      </Box>

      {/* Scene list for the selected folder */}
      <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        {selectedPath ? (
          <>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                px: 1,
                py: 0.5,
                borderBottom: 1,
                borderColor: "divider",
                minHeight: 40,
              }}
            >
              <Checkbox
                size="small"
                checked={allSelected}
                indeterminate={!allSelected && someSelected}
                disabled={scenes.length === 0}
                onChange={(e) => onBulkToggle(scenes, e.target.checked)}
              />
              <Typography variant="caption" color="text.secondary" noWrap title={selectedPath} sx={{ flexGrow: 1, minWidth: 0 }}>
                {selectedPath}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1, flexShrink: 0 }}>
                {scenes.length} scene{scenes.length === 1 ? "" : "s"}
              </Typography>
            </Box>

            <Box sx={{ flexGrow: 1, overflow: "auto" }}>
              {loading ? (
                <Box display="flex" justifyContent="center" p={4}>
                  <CircularProgress size={28} />
                </Box>
              ) : scenes.length === 0 ? (
                <Box textAlign="center" p={4} color="text.secondary">
                  No scenes found under this folder
                </Box>
              ) : (
                <List dense disablePadding>
                  {scenes.map((scene) => {
                    const checked = selectedSceneIds.has(scene.id);
                    const path = scene.files[0]?.path ?? "";
                    const grouped = (scene.groups?.length ?? 0) > 0;
                    return (
                      <React.Fragment key={scene.id}>
                        <ListItemButton
                          selected={checked}
                          onClick={() => onToggleScene(scene)}
                          sx={{ gap: 1, alignItems: "center" }}
                        >
                          <Checkbox
                            edge="start"
                            size="small"
                            checked={checked}
                            tabIndex={-1}
                            disableRipple
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => onToggleScene(scene)}
                          />
                          {scene.paths.screenshot && (
                            <Box
                              component="img"
                              src={scene.paths.screenshot}
                              alt=""
                              sx={{
                                width: 80,
                                height: 45,
                                objectFit: "cover",
                                borderRadius: 1,
                                flexShrink: 0,
                                bgcolor: "action.hover",
                              }}
                            />
                          )}
                          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                            <Typography variant="body2" noWrap title={scene.title ?? undefined}>
                              {scene.title || scene.files[0]?.basename || "Untitled"}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              noWrap
                              display="block"
                              title={path}
                            >
                              {path}
                            </Typography>
                          </Box>
                          {grouped && (
                            <Typography
                              variant="caption"
                              color="warning.main"
                              sx={{ flexShrink: 0 }}
                              title={scene.groups?.map((g) => g.group.name).join(", ")}
                            >
                              in group
                            </Typography>
                          )}
                        </ListItemButton>
                        <Divider component="li" />
                      </React.Fragment>
                    );
                  })}
                </List>
              )}
            </Box>
          </>
        ) : (
          <Box textAlign="center" p={4} color="text.secondary" sx={{ m: "auto" }}>
            Select a folder to browse its scenes
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default MovieFyFileBrowser;
