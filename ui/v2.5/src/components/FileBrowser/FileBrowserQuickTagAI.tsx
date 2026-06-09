/**
 * FileBrowserQuickTagAI.tsx
 *
 * StashTag batch-analysis panel for the FileBrowser QuickTag sidebar.
 * Submits scenes to a Go backend job (persists across navigation), monitors
 * progress via the jobs subscription, and fetches results when complete.
 *
 * Renders two distinct views:
 *   "configure" — settings + analyse button
 *   "review"    — live progress or completed report
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Slider,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CheckIcon from "@mui/icons-material/Check";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import StopIcon from "@mui/icons-material/Stop";
import * as GQL from "src/core/generated-graphql";
import { useApolloClient } from "@apollo/client";
import type { QuickTagRow, TagEntry } from "./FileBrowserQuickTag";

// ─── Persistence ──────────────────────────────────────────────────────────────

const JOB_KEY = "fileBrowser.quickTag.stashTagJobID";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chipColor(
  confidence: number,
  autoThreshold: number
): "success" | "warning" | "default" {
  if (confidence >= autoThreshold) return "success";
  if (confidence >= 50) return "warning";
  return "default";
}

function SectionLabel({ label }: { label: string }) {
  return (
    <Typography
      sx={{
        display: "block",
        mt: 1,
        mb: 0.5,
        fontSize: "0.68rem",
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        fontWeight: 700,
        color: "text.disabled",
      }}
    >
      {label}
    </Typography>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface FileBrowserQuickTagAIProps {
  /** All selected rows — only "scene" entries are analysed */
  selectedRows: QuickTagRow[];
  /** Which panel to show: configure settings or review progress/results */
  view: "configure" | "review";
  /** Notifies parent when job active/result state changes so it can show badge */
  onJobStateChange?: (hasJob: boolean) => void;
  /** Called when the user clicks the folder nav button on a scene row */
  onNavigateToScene?: (folderId: string) => void;
  /** Called after tags are applied so the parent can refetch rows */
  onApplied?: () => void;
}

export const FileBrowserQuickTagAI: React.FC<FileBrowserQuickTagAIProps> = ({
  selectedRows,
  view,
  onJobStateChange,
  onNavigateToScene,
  onApplied,
}) => {
  const client = useApolloClient();

  // ── Settings ──────────────────────────────────────────────────────────────
  const [threshold, setThreshold] = useState(0.5);
  const [autoAcceptThreshold, setAutoAcceptThreshold] = useState(75);
  const [autoGenerateSprites, setAutoGenerateSprites] = useState(false);

  // ── Local apply state for immediate chip feedback ─────────────────────────
  const [locallyApplied, setLocallyApplied] = useState<Map<string, Set<string>>>(new Map());
  const [applyingChip, setApplyingChip] = useState<string | null>(null);

  // ── Job state ─────────────────────────────────────────────────────────────
  const [jobID, setJobID] = useState<string | null>(
    () => localStorage.getItem(JOB_KEY) ?? null
  );
  const [submittedCount, setSubmittedCount] = useState(0);
  const [jobStatus, setJobStatus] = useState<GQL.JobStatus | null>(null);
  const [jobProgress, setJobProgress] = useState<number | null>(null);
  const [resolving, setResolving] = useState(false);
  const [navigatingSceneId, setNavigatingSceneId] = useState<string | null>(null);

  // ── Job verified: true only after server confirms the job exists ──────────
  // Prevents a stale localStorage jobID from showing "running" on startup.
  const [jobVerified, setJobVerified] = useState(false);

  // ── GQL hooks ─────────────────────────────────────────────────────────────
  const [submitJob] = GQL.useStashTagBatchAnalyzeMutation();
  const [clearJobResult] = GQL.useStashTagClearJobResultMutation();
  const [stopJob] = GQL.useStopJobMutation();
  const [bulkUpdateScenes] = GQL.useBulkSceneUpdateMutation();
  const [fetchResult, { data: resultData }] =
    GQL.useStashTagJobResultLazyQuery();
  const [resultVisible, setResultVisible] = useState(true);
  const [verifyJob] = GQL.useFindJobLazyQuery();
  const { data: subData } = GQL.useJobsSubscribeSubscription();

  const sceneRows = useMemo(
    () => selectedRows.filter((r) => r.type === "scene"),
    [selectedRows]
  );

  // ── Resolve tag names → IDs via GraphQL ──────────────────────────────────
  const resolveTagNames = useCallback(
    async (names: string[]): Promise<TagEntry[]> => {
      const unique = [...new Set(names.map((n) => n.toLowerCase()))];
      const resolved: TagEntry[] = [];
      for (const name of unique) {
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
          if (exact) resolved.push({ id: exact.id, name: exact.name });
        } catch {
          /* skip unresolvable tags */
        }
      }
      return resolved;
    },
    [client]
  );

  // ── On mount: verify stored jobID against the server ────────────────────
  useEffect(() => {
    if (!jobID) return;
    // Check if the job still exists on the server
    verifyJob({ variables: { input: { id: jobID } }, fetchPolicy: "network-only" })
      .then(({ data }) => {
        const job = data?.findJob;
        if (!job) {
          // Job is gone (server restarted or ID is stale) — also check for result
          setResultVisible(true);
          fetchResult({ variables: { jobID }, fetchPolicy: "network-only" });
          // Don't verify — leave jobVerified=false so isRunning stays false;
          // result fetch will populate the report if it still exists.
          return;
        }
        // Job exists: update status and mark as verified
        setJobStatus(job.status);
        setJobVerified(true);
        // If it was already finished, fetch the StashTag result too
        if (
          job.status === GQL.JobStatus.Finished ||
          job.status === GQL.JobStatus.Failed ||
          job.status === GQL.JobStatus.Cancelled
        ) {
          setResultVisible(true);
          fetchResult({ variables: { jobID }, fetchPolicy: "network-only" });
        }
      })
      .catch(() => {
        // On error, fall back to just fetching the result
        setResultVisible(true);
        fetchResult({ variables: { jobID }, fetchPolicy: "network-only" });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Subscribe to job progress ─────────────────────────────────────────────
  useEffect(() => {
    if (!jobID || !subData) return;
    const update = subData.jobsSubscribe;
    if (update.job.id !== jobID) return;
    setJobStatus(update.job.status);
    setJobProgress(update.job.progress ?? null);
    setJobVerified(true); // subscription confirms job exists
    if (
      update.job.status === GQL.JobStatus.Finished ||
      update.job.status === GQL.JobStatus.Failed ||
      update.job.status === GQL.JobStatus.Cancelled
    ) {
      setResultVisible(true);
      fetchResult({ variables: { jobID }, fetchPolicy: "network-only" });
    }
  }, [subData, jobID, fetchResult]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const result = resultVisible ? (resultData?.stashTagJobResult ?? null) : null;

  // ── Fetch current scene tags when a result is available ──────────────────
  // Used to detect tags already applied to each scene.
  const { data: currentScenesData } = GQL.useFindScenesQuery({
    skip: !result,
    variables: {
      scene_ids: result?.scenes.map((s) => parseInt(s.sceneID, 10)) ?? [],
    },
    fetchPolicy: "cache-and-network",
  });

  const existingTagsByScene = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const scene of currentScenesData?.findScenes.scenes ?? []) {
      map.set(
        scene.id,
        new Set(scene.tags.map((t) => t.name.toLowerCase()))
      );
    }
    return map;
  }, [currentScenesData]);

  // Merge server tags with locally-applied tags for immediate chip feedback
  const allAppliedByScene = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const [sceneId, tags] of existingTagsByScene) {
      map.set(sceneId, new Set(tags));
    }
    for (const [sceneId, tags] of locallyApplied) {
      if (!map.has(sceneId)) map.set(sceneId, new Set());
      for (const tag of tags) map.get(sceneId)!.add(tag);
    }
    return map;
  }, [existingTagsByScene, locallyApplied]);

  const isTerminal =
    result !== null ||
    jobStatus === GQL.JobStatus.Finished ||
    jobStatus === GQL.JobStatus.Failed ||
    jobStatus === GQL.JobStatus.Cancelled;

  // Only treat as running once the server has confirmed the job exists.
  const isRunning = jobID !== null && jobVerified && !isTerminal;
  const isFailed = !result && jobStatus === GQL.JobStatus.Failed;
  const isResultExpired =
    !result &&
    (jobStatus === GQL.JobStatus.Finished ||
      jobStatus === GQL.JobStatus.Cancelled);

  const doneCount =
    submittedCount > 0 && jobProgress !== null
      ? Math.round(jobProgress * submittedCount)
      : 0;

  // ── Notify parent of job state changes ───────────────────────────────────
  useEffect(() => {
    onJobStateChange?.(jobID !== null);
  }, [jobID, onJobStateChange]);

  // ── Submit job ────────────────────────────────────────────────────────────
  const runAnalysis = useCallback(async () => {
    if (sceneRows.length === 0) return;
    try {
      const { data } = await submitJob({
        variables: {
          input: {
            sceneIDs: sceneRows.map((r) => r.id),
            threshold,
            autoAcceptThreshold,
            autoGenerateSprites,
          },
        },
      });
      const id = data?.stashTagBatchAnalyze;
      if (!id) return;
      localStorage.setItem(JOB_KEY, id);
      setJobID(id);
      setJobStatus(GQL.JobStatus.Ready); // server just accepted it
      setJobVerified(true);              // we just created it — no need to verify
      setJobProgress(null);
      setSubmittedCount(sceneRows.length);
    } catch (err) {
      console.error("StashTag submit failed:", err);
    }
  }, [sceneRows, threshold, autoAcceptThreshold, autoGenerateSprites, submitJob]);

  // ── Stop running job ──────────────────────────────────────────────────────
  const stopAnalysis = useCallback(async () => {
    if (!jobID) return;
    try {
      await stopJob({ variables: { job_id: jobID } });
    } catch {
      /* ignore */
    }
  }, [jobID, stopJob]);

  // ── Clear report ──────────────────────────────────────────────────────────
  const clearReport = useCallback(async () => {
    if (jobID) {
      try {
        await clearJobResult({ variables: { jobID } });
      } catch {
        /* ignore */
      }
    }
    localStorage.removeItem(JOB_KEY);
    setJobID(null);
    setJobStatus(null);
    setJobProgress(null);
    setJobVerified(false);
    setSubmittedCount(0);
    setLocallyApplied(new Map());
    setResultVisible(false);
  }, [jobID, clearJobResult]);

  // ── Queue all above-threshold tags ────────────────────────────────────────
  const aboveThresholdCount = useMemo(() => {
    if (!result) return 0;
    let count = 0;
    for (const scene of result.scenes) {
      for (const tag of scene.tags) {
        if (
          tag.confidence >= result.autoAcceptThreshold &&
          !(allAppliedByScene.get(scene.sceneID)?.has(tag.name.toLowerCase()))
        ) {
          count++;
        }
      }
    }
    return count;
  }, [result, allAppliedByScene]);

  const applyTagToScene = useCallback(
    async (sceneId: string, tagName: string) => {
      const chipKey = `${sceneId}:${tagName.toLowerCase()}`;
      setApplyingChip(chipKey);
      try {
        const resolved = await resolveTagNames([tagName]);
        if (resolved.length === 0) return;
        await bulkUpdateScenes({
          variables: {
            input: {
              ids: [sceneId],
              tag_ids: { ids: resolved.map((t) => t.id), mode: GQL.BulkUpdateIdMode.Add },
            },
          },
        });
        setLocallyApplied((prev) => {
          const next = new Map(prev);
          if (!next.has(sceneId)) next.set(sceneId, new Set());
          next.get(sceneId)!.add(tagName.toLowerCase());
          return next;
        });
        onApplied?.();
      } catch {
        /* ignore */
      } finally {
        setApplyingChip(null);
      }
    },
    [resolveTagNames, bulkUpdateScenes, onApplied]
  );

  // ── Navigate browser to a scene's parent folder ─────────────────────────────
  const navigateToScene = useCallback(
    async (sceneId: string) => {
      if (!onNavigateToScene || !currentScenesData) return;
      const scene = currentScenesData.findScenes.scenes.find(
        (s) => s.id === sceneId
      );
      const filePath = scene?.files[0]?.path;
      if (!filePath) return;

      // Extract parent directory (handles both / and \ separators)
      const lastSep = Math.max(
        filePath.lastIndexOf("/"),
        filePath.lastIndexOf("\\")
      );
      if (lastSep < 0) return;
      const parentPath = filePath.slice(0, lastSep);

      setNavigatingSceneId(sceneId);
      try {
        const { data } = await client.query<
          GQL.FindFoldersForQueryQuery,
          GQL.FindFoldersForQueryQueryVariables
        >({
          query: GQL.FindFoldersForQueryDocument,
          variables: {
            folder_filter: {
              path: {
                value: parentPath,
                modifier: GQL.CriterionModifier.Equals,
              },
            },
          },
          fetchPolicy: "network-only",
        });
        const folder = data?.findFolders.folders[0];
        if (folder) onNavigateToScene(folder.id);
      } catch {
        /* ignore nav errors */
      } finally {
        setNavigatingSceneId(null);
      }
    },
    [client, currentScenesData, onNavigateToScene]
  );

  const applyAllAboveThreshold = useCallback(async () => {
    if (!result) return;
    setResolving(true);
    try {
      // Build per-scene list of tags that still need applying
      const sceneTagNames = new Map<string, string[]>();
      for (const scene of result.scenes) {
        const names = scene.tags
          .filter(
            (t) =>
              t.confidence >= result.autoAcceptThreshold &&
              !(allAppliedByScene.get(scene.sceneID)?.has(t.name.toLowerCase()))
          )
          .map((t) => t.name);
        if (names.length > 0) sceneTagNames.set(scene.sceneID, names);
      }
      if (sceneTagNames.size === 0) return;

      // Resolve all unique tag names to IDs in one pass
      const allNames = [...new Set([...sceneTagNames.values()].flat())];
      const resolved = await resolveTagNames(allNames);
      const nameToId = new Map(resolved.map((t) => [t.name.toLowerCase(), t.id]));

      // Apply per scene in parallel
      await Promise.all(
        [...sceneTagNames.entries()].map(([sceneId, names]) => {
          const ids = names
            .map((n) => nameToId.get(n.toLowerCase()))
            .filter((id): id is string => !!id);
          if (ids.length === 0) return Promise.resolve();
          return bulkUpdateScenes({
            variables: {
              input: {
                ids: [sceneId],
                tag_ids: { ids, mode: GQL.BulkUpdateIdMode.Add },
              },
            },
          }).then(() => {
            setLocallyApplied((prev) => {
              const next = new Map(prev);
              if (!next.has(sceneId)) next.set(sceneId, new Set());
              const set = next.get(sceneId)!;
              names.forEach((n) => set.add(n.toLowerCase()));
              return next;
            });
          });
        })
      );
      onApplied?.();
    } finally {
      setResolving(false);
    }
  }, [result, allAppliedByScene, resolveTagNames, bulkUpdateScenes, onApplied]);

  // ── Render ────────────────────────────────────────────────────────────────
  // ── Configure view ───────────────────────────────────────────────────────
  if (view === "configure") {
    return (
      <Box sx={{ flex: 1, overflow: "auto", px: 1.5, pb: 1.5 }}>
        <SectionLabel label="Confidence Threshold" />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Slider
            value={threshold}
            onChange={(_, v) => setThreshold(v as number)}
            min={0.2}
            max={0.9}
            step={0.05}
            size="small"
            disabled={isRunning}
            sx={{ flex: 1 }}
          />
          <Typography
            variant="caption"
            sx={{ minWidth: 32, textAlign: "right", fontWeight: 600 }}
          >
            {Math.round(threshold * 100)}%
          </Typography>
        </Box>

        <SectionLabel label="Auto-Generate Sprites" />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={autoGenerateSprites}
              onChange={(e) => setAutoGenerateSprites(e.target.checked)}
              disabled={isRunning}
            />
          }
          label={
            <Typography variant="caption" sx={{ fontSize: "0.8rem" }}>
              Generate sprites/VTT for scenes that are missing them
            </Typography>
          }
          sx={{ mb: 0.5 }}
        />

        <SectionLabel label="Accept Threshold" />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Slider
            value={autoAcceptThreshold}
            onChange={(_, v) => setAutoAcceptThreshold(v as number)}
            min={50}
            max={95}
            step={5}
            size="small"
            color="success"
            disabled={isRunning}
            sx={{ flex: 1 }}
          />
          <Typography
            variant="caption"
            color="success.main"
            sx={{ minWidth: 32, textAlign: "right", fontWeight: 600 }}
          >
            {autoAcceptThreshold}%
          </Typography>
        </Box>
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ fontSize: "0.72rem", display: "block", mb: 0.5 }}
        >
          Chips above this threshold are highlighted — use "Apply all" in the Review tab.
        </Typography>

        <Divider sx={{ mt: 1, mb: 1 }} />

        {isRunning ? (
          <Alert
            severity="info"
            icon={<CircularProgress size={14} />}
            sx={{ fontSize: "0.78rem", py: 0.5 }}
          >
            Analysis running in background — check the{" "}
            <strong>Review</strong> tab for progress.
          </Alert>
        ) : result ? (
          <Alert
            severity="success"
            icon={<CheckCircleIcon sx={{ fontSize: 16 }} />}
            sx={{ fontSize: "0.78rem", py: 0.5 }}
          >
            Analysis complete — see the <strong>Review</strong> tab for
            results.
          </Alert>
        ) : sceneRows.length === 0 ? (
          <Typography variant="body2" color="text.disabled" sx={{ fontSize: "0.8rem" }}>
            Select scenes to analyse. Images and galleries are not supported
            by StashTag.
          </Typography>
        ) : (
          <Button
            variant="contained"
            size="small"
            fullWidth
            onClick={runAnalysis}
            startIcon={<AutoFixHighIcon sx={{ fontSize: 16 }} />}
            sx={{ textTransform: "none", fontSize: "0.82rem", mb: 0.5 }}
          >
            Analyse {sceneRows.length} scene{sceneRows.length !== 1 ? "s" : ""}
          </Button>
        )}
      </Box>
    );
  }

  // ── Review view ──────────────────────────────────────────────────────────
  return (
    <Box sx={{ flex: 1, overflow: "auto", px: 1.5, pb: 1.5 }}>
      {/* No job yet */}
      {!jobID && (
        <Typography
          variant="body2"
          color="text.disabled"
          sx={{ mt: 1, fontSize: "0.8rem" }}
        >
          No analysis job yet. Configure and run one from the{" "}
          <strong>AI</strong> tab.
        </Typography>
      )}

      {/* Running progress */}
      {isRunning && (
        <Box sx={{ mt: 1, mb: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
            <CircularProgress size={14} />
            <Typography variant="caption" sx={{ flex: 1 }}>
              {jobProgress !== null
                ? `${doneCount} / ${submittedCount} scenes…`
                : "Queued…"}
            </Typography>
            <Tooltip title="Stop job">
              <IconButton size="small" onClick={stopAnalysis} sx={{ p: 0.25 }}>
                <StopIcon sx={{ fontSize: 16, color: "error.main" }} />
              </IconButton>
            </Tooltip>
          </Box>
          <LinearProgress
            variant={jobProgress !== null ? "determinate" : "indeterminate"}
            value={jobProgress !== null ? jobProgress * 100 : undefined}
            sx={{ borderRadius: 1, mb: 0.5 }}
          />
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ fontSize: "0.65rem" }}
          >
            Job #{jobID} — safe to navigate away.
          </Typography>
        </Box>
      )}

      {/* Job failed */}
      {isFailed && (
        <Box sx={{ mt: 1, mb: 1 }}>
          <Alert severity="error" sx={{ fontSize: "0.78rem", py: 0.5, mb: 0.75 }}>
            Job failed. Check the Task log for details.
          </Alert>
          <Button
            size="small"
            fullWidth
            onClick={clearReport}
            sx={{ textTransform: "none", fontSize: "0.72rem", color: "text.disabled" }}
          >
            Clear
          </Button>
        </Box>
      )}

      {/* Result expired */}
      {isResultExpired && (
        <Box sx={{ mt: 1, mb: 1 }}>
          <Alert severity="warning" sx={{ fontSize: "0.78rem", py: 0.5, mb: 0.75 }}>
            Result no longer available (server may have restarted).
          </Alert>
          <Button
            size="small"
            fullWidth
            onClick={clearReport}
            sx={{ textTransform: "none", fontSize: "0.72rem", color: "text.disabled" }}
          >
            Clear
          </Button>
        </Box>
      )}

      {/* Report */}
      {result && (
        <>
          {/* Summary row */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              mt: 1,
              mb: 1,
              px: 1,
              py: 0.75,
              borderRadius: 1,
              bgcolor: "action.hover",
            }}
          >
            {(() => {
              const done = result.scenes.filter((s) => s.status === "done").length;
              const skipped = result.scenes.filter((s) => s.status === "skipped").length;
              const errored = result.scenes.filter((s) => s.status === "error").length;
              return (
                <>
                  <CheckCircleIcon sx={{ fontSize: 14, color: "success.main" }} />
                  <Typography variant="caption" sx={{ flex: 1, fontSize: "0.72rem" }}>
                    {done} done
                    {skipped > 0 && ` · ${skipped} skipped`}
                    {errored > 0 && ` · ${errored} failed`}
                    {" · "}threshold {result.threshold * 100}%
                  </Typography>
                </>
              );
            })()}
          </Box>

          <SectionLabel label={`Scenes (${result.scenes.length})`} />

          {result.scenes.map((scene) => (
            <Box
              key={scene.sceneID}
              sx={{
                mb: 1,
                pb: 1,
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              {/* Scene header row */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.4 }}>
                {scene.status === "done" && (
                  <CheckIcon sx={{ fontSize: 12, color: "success.main", flexShrink: 0 }} />
                )}
                {scene.status === "error" && (
                  <ErrorOutlineIcon sx={{ fontSize: 12, color: "error.main", flexShrink: 0 }} />
                )}
                {scene.status === "skipped" && (
                  <SkipNextIcon sx={{ fontSize: 12, color: "warning.main", flexShrink: 0 }} />
                )}
                {scene.status === "pending" && (
                  <HourglassTopIcon sx={{ fontSize: 12, color: "text.disabled", flexShrink: 0 }} />
                )}
                <Tooltip title={scene.sceneLabel} enterDelay={600} placement="top">
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{ flex: 1, minWidth: 0, fontSize: "0.75rem", fontWeight: 600 }}
                  >
                    {scene.sceneLabel}
                  </Typography>
                </Tooltip>
                {scene.status === "done" && (
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    sx={{ flexShrink: 0, fontSize: "0.65rem" }}
                  >
                    {scene.tags.length}
                  </Typography>
                )}
                {onNavigateToScene && (
                  <Tooltip title="Navigate to folder" placement="top">
                    <span>
                      <IconButton
                        size="small"
                        sx={{ p: 0.25, flexShrink: 0 }}
                        disabled={navigatingSceneId === scene.sceneID}
                        onClick={() => navigateToScene(scene.sceneID)}
                      >
                        {navigatingSceneId === scene.sceneID ? (
                          <CircularProgress size={12} />
                        ) : (
                          <FolderOpenIcon sx={{ fontSize: 12 }} />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
              </Box>

              {/* Error / skip message */}
              {(scene.status === "error" || scene.status === "skipped") && scene.error && (
                <Typography
                  variant="caption"
                  color={scene.status === "error" ? "error" : "warning.main"}
                  sx={{ display: "block", fontSize: "0.68rem", pl: 1.75, mb: 0.25 }}
                >
                  {scene.error}
                </Typography>
              )}

              {/* Tag chips — click to apply directly to this scene */}
              {scene.status === "done" && scene.tags.length > 0 && (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.4, pl: 1.75 }}>
                  {scene.tags.map((tag) => {
                    const alreadyApplied =
                      allAppliedByScene
                        .get(scene.sceneID)
                        ?.has(tag.name.toLowerCase()) ?? false;
                    const chipKey = `${scene.sceneID}:${tag.name.toLowerCase()}`;
                    const isApplying = applyingChip === chipKey;
                    return (
                      <Tooltip
                        key={tag.name}
                        title={
                          alreadyApplied
                            ? "Already applied to this scene"
                            : isApplying
                            ? "Applying…"
                            : `${tag.confidence.toFixed(1)}% confidence — click to apply to this scene`
                        }
                        placement="top"
                      >
                        <span>
                          <Chip
                            label={`${tag.name} ${Math.round(tag.confidence)}%`}
                            size="small"
                            icon={
                              isApplying ? (
                                <CircularProgress size={10} sx={{ color: "inherit !important" }} />
                              ) : alreadyApplied ? (
                                <DoneAllIcon sx={{ fontSize: "12px !important" }} />
                              ) : undefined
                            }
                            color={
                              alreadyApplied
                                ? "default"
                                : chipColor(tag.confidence, result.autoAcceptThreshold)
                            }
                            variant={
                              !alreadyApplied &&
                              tag.confidence >= result.autoAcceptThreshold
                                ? "filled"
                                : "outlined"
                            }
                            clickable={!alreadyApplied && !isApplying}
                            disabled={alreadyApplied || isApplying}
                            onClick={
                              alreadyApplied || isApplying
                                ? undefined
                                : () => applyTagToScene(scene.sceneID, tag.name)
                            }
                            sx={{
                              fontSize: "0.62rem",
                              height: 20,
                              ...(alreadyApplied ? { opacity: 0.5 } : {}),
                            }}
                          />
                        </span>
                      </Tooltip>
                    );
                  })}
                </Box>
              )}

              {scene.status === "done" && scene.tags.length === 0 && (
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{ pl: 1.75, fontSize: "0.68rem" }}
                >
                  No tags above threshold.
                </Typography>
              )}
            </Box>
          ))}

          {/* Queue button */}
          {aboveThresholdCount > 0 && (
            <Button
              variant="outlined"
              size="small"
              fullWidth
              disabled={resolving}
              onClick={applyAllAboveThreshold}
              startIcon={
                resolving ? (
                  <CircularProgress size={12} color="inherit" />
                ) : (
                  <AutoFixHighIcon sx={{ fontSize: 14 }} />
                )
              }
              color="success"
              sx={{ textTransform: "none", fontSize: "0.78rem", mt: 0.5 }}
            >
              {resolving
                ? "Applying…"
                : `Apply ${aboveThresholdCount} suggestion${aboveThresholdCount !== 1 ? "s" : ""} ≥ ${result.autoAcceptThreshold}%`}
            </Button>
          )}

          {aboveThresholdCount === 0 && result.scenes.some((s) => s.status === "done") && (
            <Typography
              variant="caption"
              color="text.disabled"
              sx={{ mt: 0.5, fontSize: "0.72rem" }}
            >
              No unapplied tags meet the accept threshold — click any tag chip above to apply it directly to that scene.
            </Typography>
          )}

          {/* Re-analyse / Clear */}
          {sceneRows.length > 0 && (
            <Button
              variant="outlined"
              size="small"
              fullWidth
              onClick={runAnalysis}
              startIcon={<AutoFixHighIcon sx={{ fontSize: 14 }} />}
              sx={{ textTransform: "none", fontSize: "0.78rem", mt: 0.75, mb: 0.25 }}
            >
              Re-analyse {sceneRows.length} scene{sceneRows.length !== 1 ? "s" : ""}
            </Button>
          )}
          <Button
            size="small"
            fullWidth
            onClick={clearReport}
            sx={{ textTransform: "none", fontSize: "0.72rem", mt: 0.25, color: "text.disabled" }}
          >
            Clear report
          </Button>
        </>
      )}
    </Box>
  );
};
