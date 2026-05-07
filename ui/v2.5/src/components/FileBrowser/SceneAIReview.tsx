/**
 * SceneAIReview — renders AI tag suggestions for a single scene inside the
 * FileBrowserDetailsPanel.  Tags are applied directly to the scene via a
 * mutation; no shared pending queue is involved.
 *
 * Tags that don't yet exist in Stash are created automatically when applied.
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import * as GQL from "src/core/generated-graphql";
import { useApolloClient } from "@apollo/client";
import type { PersistedSceneResult } from "./useStashTagStore";

// ─── helpers ─────────────────────────────────────────────────────────────────

function chipColor(
  confidence: number,
  threshold: number
): "success" | "warning" | "default" {
  if (confidence >= threshold) return "success";
  if (confidence >= 50) return "warning";
  return "default";
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SceneAIReviewProps {
  sceneId: string;
  /** Names of tags already on this scene (from the scene query). */
  existingTagNames: string[];
  result: PersistedSceneResult;
  onApplied?: () => void;
  /** Called immediately (before refetch) with the names of tags that were applied. */
  onTagsApplied?: (tagNames: string[]) => void;
  onDismiss?: () => void;
}

export const SceneAIReview: React.FC<SceneAIReviewProps> = ({
  sceneId,
  existingTagNames,
  result,
  onApplied,
  onTagsApplied,
  onDismiss,
}) => {
  const client = useApolloClient();
  const [locallyApplied, setLocallyApplied] = useState<Set<string>>(new Set());
  const [applyingChip, setApplyingChip] = useState<string | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);
  /** Tag names (lowercase) that do not yet exist in the DB. */
  const [missingTags, setMissingTags] = useState<Set<string>>(new Set());
  const [checkingTags, setCheckingTags] = useState(true);

  const [bulkUpdateScenes] = GQL.useBulkSceneUpdateMutation();
  const [tagCreate] = GQL.useTagCreateMutation();

  // Merge server tags with locally applied ones for instant feedback
  const appliedSet = useMemo(
    () =>
      new Set([
        ...existingTagNames.map((n) => n.toLowerCase()),
        ...locallyApplied,
      ]),
    [existingTagNames, locallyApplied]
  );

  // ── Check which AI-suggested tags exist in the DB ────────────────────────
  useEffect(() => {
    let cancelled = false;
    setCheckingTags(true);
    const names = result.tags.map((t) => t.name);

    Promise.all(
      names.map(async (name) => {
        try {
          const { data } = await client.query<
            GQL.FindTagsQuery,
            GQL.FindTagsQueryVariables
          >({
            query: GQL.FindTagsDocument,
            variables: {
              filter: {
                q: name,
                per_page: 5,
                sort: "name",
                direction: GQL.SortDirectionEnum.Asc,
              },
            },
            fetchPolicy: "network-only",
          });
          const exact = (data?.findTags?.tags ?? []).find(
            (t) => t.name.toLowerCase() === name.toLowerCase()
          );
          return { name, missing: !exact };
        } catch {
          return { name, missing: false };
        }
      })
    ).then((results) => {
      if (cancelled) return;
      const missing = new Set(
        results.filter((r) => r.missing).map((r) => r.name.toLowerCase())
      );
      setMissingTags(missing);
      setCheckingTags(false);
    });

    return () => { cancelled = true; };
  // Re-check only when the set of tag names changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.tags.map((t) => t.name).join(",")]);

  // ── Resolve or create a tag → ID ─────────────────────────────────────────
  const resolveOrCreateTagId = useCallback(
    async (name: string): Promise<string | null> => {
      try {
        // First try to find it
        const { data } = await client.query<
          GQL.FindTagsQuery,
          GQL.FindTagsQueryVariables
        >({
          query: GQL.FindTagsDocument,
          variables: {
            filter: {
              q: name,
              per_page: 5,
              sort: "name",
              direction: GQL.SortDirectionEnum.Asc,
            },
          },
          fetchPolicy: "network-only",
        });
        const exact = (data?.findTags?.tags ?? []).find(
          (t) => t.name.toLowerCase() === name.toLowerCase()
        );
        if (exact) return exact.id;

        // Tag doesn't exist — try to create it
        try {
          const { data: created } = await tagCreate({
            variables: { input: { name } },
          });
          const newId = created?.tagCreate?.id ?? null;
          if (newId) {
            setMissingTags((prev) => {
              const next = new Set(prev);
              next.delete(name.toLowerCase());
              return next;
            });
          }
          return newId;
        } catch (createErr: unknown) {
          // Stash rejects tag creation when the name is an alias for an existing
          // tag, e.g. "name 'Blow Job' is used as alias for 'Blowjob'".
          // In that case, resolve the canonical name from the error message and
          // look it up instead.
          const msg =
            createErr instanceof Error
              ? createErr.message
              : String(createErr);
          const aliasMatch = msg.match(
            /is used as alias for ['"]?([^'"]+)['"]?/i
          );
          if (aliasMatch) {
            const canonicalName = aliasMatch[1].trim();
            const { data: aliasData } = await client.query<
              GQL.FindTagsQuery,
              GQL.FindTagsQueryVariables
            >({
              query: GQL.FindTagsDocument,
              variables: {
                filter: {
                  q: canonicalName,
                  per_page: 5,
                  sort: "name",
                  direction: GQL.SortDirectionEnum.Asc,
                },
              },
              fetchPolicy: "network-only",
            });
            const canonical = (aliasData?.findTags?.tags ?? []).find(
              (t) => t.name.toLowerCase() === canonicalName.toLowerCase()
            );
            if (canonical) {
              // The alias resolves to an existing tag — treat as not-missing
              setMissingTags((prev) => {
                const next = new Set(prev);
                next.delete(name.toLowerCase());
                return next;
              });
              return canonical.id;
            }
          }
          return null;
        }
      } catch {
        return null;
      }
    },
    [client, tagCreate]
  );

  // ── Apply a single chip's tag to this scene ──────────────────────────────
  const applyTag = useCallback(
    async (tagName: string) => {
      const key = tagName.toLowerCase();
      setApplyingChip(key);
      try {
        const id = await resolveOrCreateTagId(tagName);
        if (!id) return;
        await bulkUpdateScenes({
          variables: {
            input: {
              ids: [sceneId],
              tag_ids: { ids: [id], mode: GQL.BulkUpdateIdMode.Add },
            },
          },
        });
        setLocallyApplied((prev) => new Set([...prev, key]));
        onTagsApplied?.([tagName]);
        onApplied?.();
      } catch {
        /* ignore */
      } finally {
        setApplyingChip(null);
      }
    },
    [sceneId, resolveOrCreateTagId, bulkUpdateScenes, onApplied, onTagsApplied]
  );

  // ── Apply all above-threshold tags at once ───────────────────────────────
  const applyAll = useCallback(async () => {
    const toApply = result.tags.filter(
      (t) =>
        t.confidence >= result.autoAcceptThreshold &&
        !appliedSet.has(t.name.toLowerCase())
    );
    if (toApply.length === 0) return;
    setApplyingAll(true);
    try {
      const ids: string[] = [];
      for (const tag of toApply) {
        const id = await resolveOrCreateTagId(tag.name);
        if (id) ids.push(id);
      }
      if (ids.length === 0) return;
      await bulkUpdateScenes({
        variables: {
          input: {
            ids: [sceneId],
            tag_ids: { ids, mode: GQL.BulkUpdateIdMode.Add },
          },
        },
      });
      setLocallyApplied((prev) =>
        new Set([...prev, ...toApply.map((t) => t.name.toLowerCase())])
      );
      onTagsApplied?.(toApply.map((t) => t.name));
      onApplied?.();
    } catch {
      /* ignore */
    } finally {
      setApplyingAll(false);
    }
  }, [result, appliedSet, sceneId, resolveOrCreateTagId, bulkUpdateScenes, onApplied, onTagsApplied]);

  const aboveThresholdCount = useMemo(
    () =>
      result.tags.filter(
        (t) =>
          t.confidence >= result.autoAcceptThreshold &&
          !appliedSet.has(t.name.toLowerCase())
      ).length,
    [result, appliedSet]
  );

  return (
    <Box sx={{ mt: 1.25 }}>
      <Divider sx={{ mb: 1 }} />

      {/* Section header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.75 }}>
        <AutoFixHighIcon sx={{ fontSize: 14, color: "primary.main" }} />
        <Typography
          sx={{
            fontSize: "0.68rem",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            fontWeight: 700,
            color: "text.secondary",
            flex: 1,
          }}
        >
          AI Suggestions
        </Typography>
        {checkingTags ? (
          <CircularProgress size={10} sx={{ mr: 0.5 }} />
        ) : missingTags.size > 0 ? (
          <Tooltip title={`${missingTags.size} tag${missingTags.size !== 1 ? "s" : ""} will be created when applied`}>
            <Typography
              variant="caption"
              color="warning.main"
              sx={{ fontSize: "0.62rem", display: "flex", alignItems: "center", gap: 0.25 }}
            >
              <AddCircleOutlineIcon sx={{ fontSize: 11 }} />
              {missingTags.size} new
            </Typography>
          </Tooltip>
        ) : null}
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ fontSize: "0.65rem" }}
        >
          ≥{result.autoAcceptThreshold}%
        </Typography>
        {onDismiss && (
          <Tooltip title="Dismiss suggestions for this scene">
            <IconButton size="small" sx={{ p: 0.25 }} onClick={onDismiss}>
              <CloseIcon sx={{ fontSize: 13 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Tag chips */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.4, mb: 0.75 }}>
        {result.tags.map((tag) => {
          const isApplied = appliedSet.has(tag.name.toLowerCase());
          const isApplying = applyingChip === tag.name.toLowerCase();
          const isMissing = missingTags.has(tag.name.toLowerCase());
          const tooltipTitle = isApplied
            ? "Already applied"
            : isApplying
            ? "Applying…"
            : isMissing
            ? `${tag.confidence.toFixed(1)}% confidence — tag doesn't exist yet, click to create & apply`
            : `${tag.confidence.toFixed(1)}% confidence — click to apply`;
          return (
            <Tooltip key={tag.name} title={tooltipTitle} placement="top">
              <span>
                <Chip
                  label={`${tag.name} ${Math.round(tag.confidence)}%`}
                  size="small"
                  icon={
                    isApplying ? (
                      <CircularProgress
                        size={10}
                        sx={{ color: "inherit !important" }}
                      />
                    ) : isApplied ? (
                      <DoneAllIcon sx={{ fontSize: "12px !important" }} />
                    ) : isMissing && !checkingTags ? (
                      <AddCircleOutlineIcon sx={{ fontSize: "12px !important" }} />
                    ) : undefined
                  }
                  color={
                    isApplied
                      ? "default"
                      : chipColor(tag.confidence, result.autoAcceptThreshold)
                  }
                  variant={
                    !isApplied && tag.confidence >= result.autoAcceptThreshold
                      ? "filled"
                      : "outlined"
                  }
                  clickable={!isApplied && !isApplying}
                  disabled={isApplied || isApplying || checkingTags}
                  onClick={
                    isApplied || isApplying
                      ? undefined
                      : () => applyTag(tag.name)
                  }
                  sx={{
                    fontSize: "0.62rem",
                    height: 20,
                    ...(isApplied ? { opacity: 0.5 } : {}),
                    // Dashed border for tags that need to be created
                    ...(isMissing && !isApplied
                      ? { borderStyle: "dashed" }
                      : {}),
                  }}
                />
              </span>
            </Tooltip>
          );
        })}
      </Box>

      {/* Apply-all button */}
      {aboveThresholdCount > 0 && (
        <Button
          variant="outlined"
          size="small"
          fullWidth
          color="success"
          disabled={applyingAll || checkingTags}
          onClick={applyAll}
          startIcon={
            applyingAll ? (
              <CircularProgress size={12} color="inherit" />
            ) : (
              <CheckCircleOutlineIcon sx={{ fontSize: 14 }} />
            )
          }
          sx={{ textTransform: "none", fontSize: "0.78rem" }}
        >
          {applyingAll
            ? "Applying…"
            : `Apply ${aboveThresholdCount} tag${aboveThresholdCount !== 1 ? "s" : ""} ≥ ${result.autoAcceptThreshold}%`}
        </Button>
      )}

      {aboveThresholdCount === 0 && (
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ fontSize: "0.68rem" }}
        >
          All above-threshold suggestions have been applied.
        </Typography>
      )}
    </Box>
  );
};
