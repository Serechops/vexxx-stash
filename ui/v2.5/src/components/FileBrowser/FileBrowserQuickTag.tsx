import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import RemoveIcon from "@mui/icons-material/Remove";
import SearchIcon from "@mui/icons-material/Search";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import * as GQL from "src/core/generated-graphql";

// ─── Storage helpers ──────────────────────────────────────────────────────────
const FAV_KEY = "fileBrowser.quickTag.favorites";
const RECENT_KEY = "fileBrowser.quickTag.recent";
const LOCKED_KEY = "fileBrowser.quickTag.locked";
const MAX_RECENT = 8;

export interface TagEntry {
  id: string;
  name: string;
}

function loadStorage<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveStorage<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// ─── Prop types ───────────────────────────────────────────────────────────────

/** Minimal shape we need from a FileBrowser row */
export type QuickTagRow = {
  id: string;
  type: "scene" | "image" | "gallery";
  tags?: Array<{ id: string; name: string }>;
  label?: string;
};

interface IFileBrowserQuickTagProps {
  selectedRows: QuickTagRow[];
  locked: boolean;
  onLockedChange: (locked: boolean) => void;
  onClose: () => void;
  /** Called after each successful tag apply so the parent can refetch. */
  onApplied?: () => void;
}

// ─── Main component ───────────────────────────────────────────────────────────

export const FileBrowserQuickTag: React.FC<IFileBrowserQuickTagProps> = ({
  selectedRows,
  locked,
  onLockedChange,
  onClose,
  onApplied,
}) => {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [feedbackTagIds, setFeedbackTagIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  // Pending queue: tags staged for a single bulk apply
  const [pendingTags, setPendingTags] = useState<TagEntry[]>([]);

  const [favorites, setFavorites] = useState<TagEntry[]>(() =>
    loadStorage<TagEntry[]>(FAV_KEY, [])
  );
  const [recent, setRecent] = useState<TagEntry[]>(() =>
    loadStorage<TagEntry[]>(RECENT_KEY, [])
  );

  // Bulk mutation hooks
  const [bulkUpdateScenes] = GQL.useBulkSceneUpdateMutation();
  const [bulkUpdateImages] = GQL.useBulkImageUpdateMutation();
  const [bulkUpdateGalleries] = GQL.useBulkGalleryUpdateMutation();

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const { data: searchData, loading: searchLoading } = GQL.useFindTagsQuery({
    variables: {
      filter: {
        q: debouncedSearch,
        per_page: 20,
        sort: "name",
        direction: GQL.SortDirectionEnum.Asc,
      },
    },
    skip: debouncedSearch.trim().length === 0,
  });

  const searchResults = searchData?.findTags.tags ?? [];

  // ── Favorites helpers ────────────────────────────────────────────────────
  const isFavorite = (id: string) => favorites.some((f) => f.id === id);
  const isPending = (id: string) => pendingTags.some((t) => t.id === id);

  const toggleFavorite = (tag: TagEntry) => {
    setFavorites((prev) => {
      const next = prev.some((f) => f.id === tag.id)
        ? prev.filter((f) => f.id !== tag.id)
        : [...prev, tag];
      saveStorage(FAV_KEY, next);
      return next;
    });
  };

  const addToRecent = (tags: TagEntry[]) => {
    setRecent((prev) => {
      let next = [...prev];
      for (const tag of tags) {
        next = [tag, ...next.filter((r) => r.id !== tag.id)];
      }
      next = next.slice(0, MAX_RECENT);
      saveStorage(RECENT_KEY, next);
      return next;
    });
  };

  // ── Queue helpers ────────────────────────────────────────────────────────
  /** Toggle a tag in the pending queue. */
  const togglePending = (tag: TagEntry) => {
    setPendingTags((prev) =>
      prev.some((t) => t.id === tag.id)
        ? prev.filter((t) => t.id !== tag.id)
        : [...prev, tag]
    );
  };

  // ── Apply all pending tags at once ───────────────────────────────────────
  const applyPending = useCallback(async () => {
    if (selectedRows.length === 0 || pendingTags.length === 0) return;
    setApplying(true);

    const sceneIds = selectedRows.filter((r) => r.type === "scene").map((r) => r.id);
    const imageIds = selectedRows.filter((r) => r.type === "image").map((r) => r.id);
    const galleryIds = selectedRows.filter((r) => r.type === "gallery").map((r) => r.id);

    const tagInput: GQL.BulkUpdateIds = {
      ids: pendingTags.map((t) => t.id),
      mode: mode === "add" ? GQL.BulkUpdateIdMode.Add : GQL.BulkUpdateIdMode.Remove,
    };

    const promises: Promise<unknown>[] = [];
    if (sceneIds.length)
      promises.push(bulkUpdateScenes({ variables: { input: { ids: sceneIds, tag_ids: tagInput } } }));
    if (imageIds.length)
      promises.push(bulkUpdateImages({ variables: { input: { ids: imageIds, tag_ids: tagInput } } }));
    if (galleryIds.length)
      promises.push(bulkUpdateGalleries({ variables: { input: { ids: galleryIds, tag_ids: tagInput } } }));

    await Promise.all(promises);

    // Flash all applied tags
    const applied = new Set(pendingTags.map((t) => t.id));
    setFeedbackTagIds(applied);
    setTimeout(() => setFeedbackTagIds(new Set()), 1200);

    addToRecent(pendingTags);
    setPendingTags([]);
    setApplying(false);
    onApplied?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRows, pendingTags, mode, bulkUpdateScenes, bulkUpdateImages, bulkUpdateGalleries, onApplied]);

  // ── Single-click quick apply (from favorites/recent) ─────────────────────
  const applyOneTag = useCallback(
    async (tag: TagEntry) => {
      if (selectedRows.length === 0) return;

      const sceneIds = selectedRows.filter((r) => r.type === "scene").map((r) => r.id);
      const imageIds = selectedRows.filter((r) => r.type === "image").map((r) => r.id);
      const galleryIds = selectedRows.filter((r) => r.type === "gallery").map((r) => r.id);

      const tagInput: GQL.BulkUpdateIds = {
        ids: [tag.id],
        mode: mode === "add" ? GQL.BulkUpdateIdMode.Add : GQL.BulkUpdateIdMode.Remove,
      };

      const promises: Promise<unknown>[] = [];
      if (sceneIds.length)
        promises.push(bulkUpdateScenes({ variables: { input: { ids: sceneIds, tag_ids: tagInput } } }));
      if (imageIds.length)
        promises.push(bulkUpdateImages({ variables: { input: { ids: imageIds, tag_ids: tagInput } } }));
      if (galleryIds.length)
        promises.push(bulkUpdateGalleries({ variables: { input: { ids: galleryIds, tag_ids: tagInput } } }));

      await Promise.all(promises);

      setFeedbackTagIds(new Set([tag.id]));
      setTimeout(() => setFeedbackTagIds(new Set()), 1200);

      addToRecent([tag]);
      onApplied?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedRows, mode, bulkUpdateScenes, bulkUpdateImages, bulkUpdateGalleries, onApplied]
  );

  const numSelected = selectedRows.length;

  // ── Existing tags on selected items ─────────────────────────────────────
  const selectedTagCounts = useMemo(() => {
    const counts = new Map<string, { tag: TagEntry; count: number }>();
    for (const row of selectedRows) {
      for (const tag of row.tags ?? []) {
        const existing = counts.get(tag.id);
        if (existing) existing.count++;
        else counts.set(tag.id, { tag, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) =>
      a.tag.name.localeCompare(b.tag.name)
    );
  }, [selectedRows]);

  return (
    <Box
      sx={{
        width: 280,
        flexShrink: 0,
        borderLeft: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        bgcolor: "background.default",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 1.5,
          py: 0.75,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <LocalOfferIcon sx={{ fontSize: 18, color: "text.secondary" }} />
        <Typography
          variant="subtitle2"
          sx={{ flex: 1, fontSize: "0.875rem", fontWeight: 600 }}
        >
          Quick Tag
        </Typography>
        <Tooltip title={locked ? "Unlock (auto-close when navigating)" : "Lock open (keep open when navigating)"}>
          <IconButton
            size="small"
            onClick={() => onLockedChange(!locked)}
            sx={{ p: 0.25, color: locked ? "primary.main" : "action.disabled" }}
          >
            {locked ? <LockIcon sx={{ fontSize: 16 }} /> : <LockOpenIcon sx={{ fontSize: 16 }} />}
          </IconButton>
        </Tooltip>
        {!locked && (
          <IconButton size="small" onClick={onClose} sx={{ p: 0.25 }}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        )}
      </Box>

      {/* Mode toggle + selection count */}
      <Box
        sx={{
          px: 1.5,
          pt: 1,
          pb: 0.5,
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexShrink: 0,
        }}
      >
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={(_, v) => {
            if (v) setMode(v);
          }}
          size="small"
          sx={{
            height: 32,
            "& .MuiToggleButton-root": {
              px: 1.25,
              fontSize: "0.8rem",
              textTransform: "none",
              lineHeight: 1,
            },
          }}
        >
          <ToggleButton value="add">
            <AddIcon sx={{ fontSize: 14, mr: 0.5 }} />
            Add
          </ToggleButton>
          <ToggleButton value="remove">
            <RemoveIcon sx={{ fontSize: 14, mr: 0.5 }} />
            Remove
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}
        >
          {numSelected > 0
            ? `${numSelected} item${numSelected !== 1 ? "s" : ""}`
            : "none selected"}
        </Typography>
      </Box>

      {numSelected === 0 && (
        <Box sx={{ px: 1.5, pb: 0.5 }}>
          <Typography variant="body2" color="text.disabled">
            Select items to apply tags.
          </Typography>
        </Box>
      )}

      {/* Pending queue + Apply button */}
      {pendingTags.length > 0 && (
        <Box
          sx={{
            px: 1.5,
            py: 0.75,
            borderTop: 1,
            borderBottom: 1,
            borderColor: "divider",
            flexShrink: 0,
            bgcolor: "action.selected",
          }}
        >
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 0.75 }}>
            {pendingTags.map((t) => (
              <Chip
                key={t.id}
                label={t.name}
                size="small"
                onDelete={() => togglePending(t)}
                color={mode === "add" ? "primary" : "warning"}
                sx={{ fontSize: "0.8rem", height: 26 }}
              />
            ))}
          </Box>
          <Button
            variant="contained"
            size="small"
            fullWidth
            disabled={applying || numSelected === 0}
            onClick={applyPending}
            startIcon={applying ? <CircularProgress size={14} color="inherit" /> : undefined}
            sx={{ textTransform: "none", fontSize: "0.82rem" }}
          >
            {mode === "add" ? "Add" : "Remove"} {pendingTags.length} tag
            {pendingTags.length !== 1 ? "s" : ""} to {numSelected} item
            {numSelected !== 1 ? "s" : ""}
          </Button>
        </Box>
      )}

      {/* Scrollable tag content */}
      <Box sx={{ flex: 1, overflow: "auto", px: 1.5, pb: 1.5 }}>
        {/* Existing tags on selected items */}
        {numSelected > 0 && selectedTagCounts.length > 0 && (
          <>
            <SectionLabel label={`On selected (${selectedTagCounts.length})`} />
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, mb: 0.5, maxHeight: 160, overflowY: "auto" }}>
              {selectedTagCounts.map(({ tag, count }: { tag: TagEntry; count: number }) => (
                <TagRow
                  key={tag.id}
                  tag={tag}
                  isFavorite={isFavorite(tag.id)}
                  isPending={isPending(tag.id)}
                  isApplied
                  appliedCount={
                    numSelected > 1 && count < numSelected
                      ? `${count}/${numSelected}`
                      : undefined
                  }
                  feedback={feedbackTagIds.has(tag.id)}
                  mode={mode}
                  disabled={numSelected === 0}
                  onQueue={togglePending}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </Box>
            <Divider sx={{ mt: 0.5, mb: 0.25 }} />
          </>
        )}

        {/* Favorites section */}
        {favorites.length > 0 && (
          <>
            <SectionLabel label="★ Favorites" />
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 0.5 }}>
              {favorites.map((tag) => (
                <TagChip
                  key={tag.id}
                  tag={tag}
                  isFavorite
                  feedback={feedbackTagIds.has(tag.id)}
                  mode={mode}
                  disabled={numSelected === 0}
                  onApply={applyOneTag}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </Box>
            <Divider sx={{ mt: 0.5, mb: 0.25 }} />
          </>
        )}

        {/* Recent section */}
        {recent.length > 0 && (
          <>
            <SectionLabel label="Recent" />
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 0.5 }}>
              {recent.map((tag) => (
                <TagChip
                  key={tag.id}
                  tag={tag}
                  isFavorite={isFavorite(tag.id)}
                  feedback={feedbackTagIds.has(tag.id)}
                  mode={mode}
                  disabled={numSelected === 0}
                  onApply={applyOneTag}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </Box>
            <Divider sx={{ mt: 0.5, mb: 0.25 }} />
          </>
        )}

        {/* Search field */}
        <Box sx={{ mt: 0.75, mb: 0.5 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Search tags…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    {searchLoading ? (
                      <CircularProgress size={14} />
                    ) : (
                      <SearchIcon sx={{ fontSize: 18 }} />
                    )}
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              "& .MuiInputBase-input": { fontSize: "0.875rem", py: 0.75 },
            }}
          />
        </Box>

        {/* Search results */}
        {searchResults.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            {searchResults.map((tag) => (
              <TagRow
                key={tag.id}
                tag={{ id: tag.id, name: tag.name }}
                isFavorite={isFavorite(tag.id)}
                isPending={isPending(tag.id)}
                feedback={feedbackTagIds.has(tag.id)}
                mode={mode}
                disabled={numSelected === 0}
                onQueue={togglePending}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </Box>
        )}

        {debouncedSearch.length > 0 &&
          !searchLoading &&
          searchResults.length === 0 && (
            <Typography variant="body2" color="text.disabled">
              No tags found.
            </Typography>
          )}

        {debouncedSearch.length === 0 &&
          favorites.length === 0 &&
          recent.length === 0 && (
            <Typography
              variant="body2"
              color="text.disabled"
              sx={{ display: "block", mt: 0.5 }}
            >
              Search for tags above, or ★ star some to save as favorites.
            </Typography>
          )}
      </Box>
    </Box>
  );
};

// ─── Internal sub-components ──────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{
        display: "block",
        mt: 1,
        mb: 0.5,
        fontSize: "0.72rem",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontWeight: 600,
      }}
    >
      {label}
    </Typography>
  );
}

interface TagItemProps {
  tag: TagEntry;
  isFavorite: boolean;
  feedback: boolean;
  mode: "add" | "remove";
  disabled: boolean;
  onApply: (tag: TagEntry) => void;
  onToggleFavorite: (tag: TagEntry) => void;
}

interface TagRowProps {
  tag: TagEntry;
  isFavorite: boolean;
  isPending: boolean;
  isApplied?: boolean;
  appliedCount?: string;
  feedback: boolean;
  mode: "add" | "remove";
  disabled: boolean;
  onQueue: (tag: TagEntry) => void;
  onToggleFavorite: (tag: TagEntry) => void;
}

/** Compact chip — used in favorites & recent sections */
function TagChip({
  tag,
  isFavorite,
  feedback,
  mode,
  disabled,
  onApply,
  onToggleFavorite,
}: TagItemProps) {
  const tooltipText = disabled
    ? "Select items first"
    : `${mode === "add" ? "Add" : "Remove"} "${tag.name}" ${mode === "add" ? "to" : "from"} selected`;

  return (
    <Tooltip title={tooltipText} arrow placement="top">
      <span>
        <Chip
          label={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
              {feedback && <CheckIcon sx={{ fontSize: 14 }} />}
              <span
                style={{
                  maxWidth: 128,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {tag.name}
              </span>
              <Box
                component="span"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onToggleFavorite(tag);
                }}
                sx={{
                  ml: 0.25,
                  lineHeight: 1,
                  cursor: "pointer",
                  opacity: 0.6,
                  "&:hover": { opacity: 1 },
                }}
              >
                {isFavorite ? (
                  <StarIcon sx={{ fontSize: 13, color: "warning.main" }} />
                ) : (
                  <StarBorderIcon sx={{ fontSize: 13 }} />
                )}
              </Box>
            </Box>
          }
          size="small"
          color={
            feedback
              ? mode === "add"
                ? "success"
                : "warning"
              : "default"
          }
          variant={mode === "remove" ? "outlined" : "filled"}
          disabled={disabled}
          onClick={() => onApply(tag)}
          sx={{
            height: 28,
            fontSize: "0.8rem",
            cursor: disabled ? "default" : "pointer",
            "& .MuiChip-label": { px: 1 },
          }}
        />
      </span>
    </Tooltip>
  );
}

/** Row item — used in search results. Click queues/dequeues for bulk apply. */
function TagRow({
  tag,
  isFavorite,
  isPending,
  isApplied,
  appliedCount,
  feedback,
  mode,
  disabled,
  onQueue,
  onToggleFavorite,
}: TagRowProps) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px: 1,
        py: 0.6,
        borderRadius: 0.75,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        bgcolor: feedback
          ? mode === "add"
            ? "success.dark"
            : "warning.dark"
          : isPending
          ? "primary.dark"
          : "transparent",
        border: "1px solid",
        borderColor: isPending ? "primary.main" : "transparent",
        "&:hover": disabled
          ? {}
          : {
              bgcolor: feedback
                ? undefined
                : isPending
                ? "primary.dark"
                : "rgba(255,255,255,0.08)",
              borderColor: isPending ? "primary.light" : "rgba(255,255,255,0.15)",
            },
        transition: "background-color 0.12s, border-color 0.12s",
      }}
      onClick={() => !disabled && onQueue(tag)}
    >
      {feedback ? (
        <CheckIcon sx={{ fontSize: 16, color: "success.light", flexShrink: 0 }} />
      ) : isPending ? (
        <CheckIcon sx={{ fontSize: 16, color: "primary.light", flexShrink: 0 }} />
      ) : isApplied ? (
        <CheckCircleOutlineIcon sx={{ fontSize: 16, color: "success.main", flexShrink: 0 }} />
      ) : (
        <LocalOfferIcon sx={{ fontSize: 16, color: "text.disabled", flexShrink: 0 }} />
      )}
      <Typography
        variant="body2"
        sx={{
          flex: 1,
          fontSize: "0.875rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: feedback || isPending ? "text.primary" : "text.primary",
          fontWeight: isPending ? 600 : 400,
        }}
      >
        {tag.name}
        {appliedCount && (
          <Typography
            component="span"
            variant="caption"
            color="text.disabled"
            sx={{ ml: 0.5, fontSize: "0.72rem" }}
          >
            {appliedCount}
          </Typography>
        )}
      </Typography>
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(tag);
        }}
        sx={{
          p: 0.25,
          color: isFavorite ? "warning.main" : "action.disabled",
          "&:hover": { color: "warning.main" },
        }}
      >
        {isFavorite ? (
          <StarIcon sx={{ fontSize: 16 }} />
        ) : (
          <StarBorderIcon sx={{ fontSize: 16 }} />
        )}
      </IconButton>
    </Box>
  );
}
