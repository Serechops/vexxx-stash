import React, { useMemo } from "react";
import { FormattedMessage } from "react-intl";
import {
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

// ─── Recursive sub-folder tree node ──────────────────────────────────────────

interface IFolderTreeNodeProps {
  folder: { id: string; basename: string; path?: string };
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expandedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  /** Override the display label (used to show full path for library roots). */
  label?: string;
}

const FolderTreeNode: React.FC<IFolderTreeNodeProps> = ({
  folder,
  depth,
  selectedId,
  onSelect,
  expandedIds,
  onToggleExpanded,
  label,
}) => {
  const expanded = expandedIds.has(folder.id);

  const { data, loading } = GQL.useFileBrowserFolderChildrenQuery({
    variables: { id: folder.id },
    skip: !expanded,
  });

  const children = data?.findFolders.folders[0]?.sub_folders ?? [];
  const isSelected = selectedId === folder.id;
  const tooltipTitle = folder.path ?? label ?? folder.basename;

  return (
    <>
      <Tooltip
        title={tooltipTitle}
        placement="right"
        enterDelay={600}
        enterNextDelay={300}
        arrow
      >
        <ListItemButton
          selected={isSelected}
          sx={{ pl: 1 + depth * 2 }}
          onClick={() => onSelect(folder.id)}
          onDoubleClick={() => onToggleExpanded(folder.id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" && !expanded) {
              e.preventDefault();
              onToggleExpanded(folder.id);
              return;
            }

            if (e.key === "ArrowLeft" && expanded) {
              e.preventDefault();
              onToggleExpanded(folder.id);
              return;
            }

            if (e.key === "Enter") {
              e.preventDefault();
              onSelect(folder.id);
              return;
            }

            if (e.key === " ") {
              e.preventDefault();
              onToggleExpanded(folder.id);
            }
          }}
        >
          <ListItemIcon sx={{ minWidth: 24 }}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpanded(folder.id);
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
            {isSelected || expanded ? (
              <FolderOpenIcon
                fontSize="small"
                color={isSelected ? "primary" : "inherit"}
              />
            ) : (
              <FolderIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText
            primary={label ?? folder.basename}
            slotProps={{ primary: { variant: "body2", noWrap: true } }}
          />
        </ListItemButton>
      </Tooltip>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <List disablePadding>
          {children.map((child) => (
            <FolderTreeNode
              key={child.id}
              folder={{ id: child.id, basename: child.basename, path: child.path }}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              expandedIds={expandedIds}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
          {expanded && !loading && children.length === 0 && (
            <ListItemButton disabled sx={{ pl: 1 + (depth + 1) * 2 }}>
              <ListItemText
                primary={<FormattedMessage id="file-browser.no_subfolders" defaultMessage="No subfolders" />}
                slotProps={{
                  primary: { variant: "body2", color: "text.disabled" },
                }}
              />
            </ListItemButton>
          )}
        </List>
      </Collapse>
    </>
  );
};

// ─── Library root node – resolves a stash path to a folder record ─────────────

interface ILibraryRootNodeProps {
  path: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expandedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  resolvedFolder?: { id: string; basename: string; path?: string };
  rootResolutionLoading: boolean;
}

const LibraryRootNode: React.FC<ILibraryRootNodeProps> = ({
  path,
  selectedId,
  onSelect,
  expandedIds,
  onToggleExpanded,
  resolvedFolder,
  rootResolutionLoading,
}) => {
  const shouldQueryByPath = !resolvedFolder && !rootResolutionLoading;

  const { data, loading, error } = GQL.useFindFoldersForQueryQuery({
    variables: {
      folder_filter: {
        path: { value: path, modifier: GQL.CriterionModifier.Equals },
      },
    },
    skip: !shouldQueryByPath,
  });

  const folder = resolvedFolder ?? data?.findFolders.folders[0];

  if (rootResolutionLoading || loading) {
    return (
      <ListItemButton sx={{ pl: 1 }}>
        <ListItemIcon sx={{ minWidth: 32 }}>
          <CircularProgress size={16} />
        </ListItemIcon>
        <ListItemText
          primary={path}
          slotProps={{
            primary: { variant: "body2", noWrap: true, color: "text.secondary" },
          }}
        />
      </ListItemButton>
    );
  }

  if (error || !folder) {
    return (
      <ListItemButton disabled sx={{ pl: 1 }}>
        <ListItemIcon sx={{ minWidth: 32 }}>
          <StorageIcon fontSize="small" color="disabled" />
        </ListItemIcon>
        <ListItemText
          primary={path}
          slotProps={{
            primary: { variant: "body2", noWrap: true, color: "text.disabled" },
          }}
        />
      </ListItemButton>
    );
  }

  return (
    <FolderTreeNode
      folder={{ id: folder.id, basename: folder.basename, path: folder.path }}
      depth={0}
      selectedId={selectedId}
      onSelect={onSelect}
      expandedIds={expandedIds}
      onToggleExpanded={onToggleExpanded}
      label={path}
    />
  );
};

// ─── Public tree component ────────────────────────────────────────────────────

interface IFileBrowserTreeProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  expandedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
}

export const FileBrowserTree: React.FC<IFileBrowserTreeProps> = ({
  selectedId,
  onSelect,
  expandedIds,
  onToggleExpanded,
}) => {
  const { configuration } = useConfigurationContext();
  const stashPaths = configuration?.general.stashes ?? [];

  const { data: rootFoldersData, loading: rootFoldersLoading } =
    GQL.useFindRootFoldersForSelectQuery({
      fetchPolicy: "cache-first",
    });

  const rootFoldersByPath = useMemo(() => {
    const byPath = new Map<string, { id: string; basename: string; path?: string }>();
    for (const folder of rootFoldersData?.findFolders.folders ?? []) {
      byPath.set(folder.path, { id: folder.id, basename: folder.basename, path: folder.path });
    }
    return byPath;
  }, [rootFoldersData]);

  if (stashPaths.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        <FormattedMessage
          id="file-browser.no_library_folders"
          defaultMessage="No library folders configured."
        />
      </Typography>
    );
  }

  return (
    <List dense disablePadding>
      {stashPaths.map((stash, idx) => (
        <React.Fragment key={stash.path}>
          {idx > 0 && <Divider />}
          <LibraryRootNode
            path={stash.path}
            selectedId={selectedId}
            onSelect={onSelect}
            expandedIds={expandedIds}
            onToggleExpanded={onToggleExpanded}
            resolvedFolder={rootFoldersByPath.get(stash.path)}
            rootResolutionLoading={rootFoldersLoading}
          />
        </React.Fragment>
      ))}
    </List>
  );
};
