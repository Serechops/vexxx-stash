/**
 * useStashTagStore — global job lifecycle + result persistence for StashTag batch analysis.
 *
 * Results are persisted to localStorage so they survive page refreshes and
 * folder navigation.  The store is instantiated inside FileBrowserContent so
 * each content pane gets the same shared data via localStorage on mount.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import * as GQL from "src/core/generated-graphql";

const STORE_KEY = "fileBrowser.stashTag.v2";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PersistedSceneResult {
  sceneID: string;
  sceneLabel: string;
  tags: Array<{ name: string; confidence: number }>;
  autoAcceptThreshold: number;
  threshold: number;
}

export interface AnalysisSettings {
  threshold: number;
  autoAcceptThreshold: number;
  autoGenerateSprites: boolean;
}

// ─── Internal storage shape ───────────────────────────────────────────────────

interface StoredData {
  jobID: string | null;
  jobStatus: string | null;
  jobProgress: number | null;
  results: Record<string, PersistedSceneResult>;
  dismissed: string[];
}

const EMPTY: StoredData = {
  jobID: null,
  jobStatus: null,
  jobProgress: null,
  results: {},
  dismissed: [],
};

function loadData(): StoredData {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

function saveData(d: StoredData): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(d));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useStashTagStore() {
  const [data, setData] = useState<StoredData>(loadData);
  const [jobVerified, setJobVerified] = useState(false);

  const [submitJob] = GQL.useStashTagBatchAnalyzeMutation();
  const [clearJobResult] = GQL.useStashTagClearJobResultMutation();
  const [stopJobMutation] = GQL.useStopJobMutation();
  const [verifyJob] = GQL.useFindJobLazyQuery();
  const [fetchResult, { data: resultData }] = GQL.useStashTagJobResultLazyQuery();
  const { data: subData } = GQL.useJobsSubscribeSubscription();

  // ── Persist result data whenever the lazy query resolves ─────────────────
  useEffect(() => {
    const result = resultData?.stashTagJobResult;
    if (!result) return;
    const incoming: Record<string, PersistedSceneResult> = {};
    for (const scene of result.scenes) {
      if (scene.status === "done" && scene.tags.length > 0) {
        incoming[scene.sceneID] = {
          sceneID: scene.sceneID,
          sceneLabel: scene.sceneLabel,
          tags: scene.tags,
          autoAcceptThreshold: result.autoAcceptThreshold,
          threshold: result.threshold,
        };
      }
    }
    if (Object.keys(incoming).length > 0) {
      setData((prev) => {
        const next = { ...prev, results: { ...prev.results, ...incoming } };
        saveData(next);
        return next;
      });
    }
  }, [resultData]);

  // ── On mount: verify any stored job against the server ───────────────────
  useEffect(() => {
    const { jobID } = loadData(); // read directly to avoid stale closure
    if (!jobID) return;
    verifyJob({ variables: { id: jobID }, fetchPolicy: "network-only" })
      .then(({ data: vd }) => {
        const job = vd?.findJob;
        if (!job) {
          // Job no longer exists on server — clear the job tracking fields
          setData((prev) => {
            const next = { ...prev, jobID: null, jobStatus: null, jobProgress: null };
            saveData(next);
            return next;
          });
          return;
        }
        setJobVerified(true);
        setData((prev) => {
          const next = { ...prev, jobStatus: job.status };
          saveData(next);
          return next;
        });
        if (
          job.status === GQL.JobStatus.Finished ||
          job.status === GQL.JobStatus.Failed ||
          job.status === GQL.JobStatus.Cancelled
        ) {
          fetchResult({ variables: { jobID }, fetchPolicy: "network-only" });
        }
      })
      .catch(() => setJobVerified(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Subscribe to live job progress ────────────────────────────────────────
  useEffect(() => {
    if (!data.jobID || !subData) return;
    const update = subData.jobsSubscribe;
    if (update.job.id !== data.jobID) return;
    setJobVerified(true);
    const status = update.job.status;
    const progress = update.job.progress ?? null;
    setData((prev) => {
      const next = { ...prev, jobStatus: status, jobProgress: progress };
      saveData(next);
      return next;
    });
    if (
      status === GQL.JobStatus.Finished ||
      status === GQL.JobStatus.Failed ||
      status === GQL.JobStatus.Cancelled
    ) {
      fetchResult({ variables: { jobID: data.jobID }, fetchPolicy: "network-only" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subData]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const isTerminal =
    data.jobStatus === GQL.JobStatus.Finished ||
    data.jobStatus === GQL.JobStatus.Failed ||
    data.jobStatus === GQL.JobStatus.Cancelled;
  const isRunning = !!data.jobID && jobVerified && !isTerminal;

  const dismissedSet = useMemo(() => new Set(data.dismissed), [data.dismissed]);

  const pendingReviewCount = useMemo(
    () => Object.keys(data.results).filter((id) => !dismissedSet.has(id)).length,
    [data.results, dismissedSet]
  );

  // ── Stable callbacks ──────────────────────────────────────────────────────

  const hasResult = useCallback(
    (sceneId: string) => !!data.results[sceneId] && !dismissedSet.has(sceneId),
    [data.results, dismissedSet]
  );

  const getResult = useCallback(
    (sceneId: string): PersistedSceneResult | null =>
      data.results[sceneId] && !dismissedSet.has(sceneId)
        ? data.results[sceneId]
        : null,
    [data.results, dismissedSet]
  );

  const runAnalysis = useCallback(
    async (sceneIds: string[], settings: AnalysisSettings) => {
      try {
        const { data: md } = await submitJob({
          variables: {
            input: {
              sceneIDs: sceneIds,
              threshold: settings.threshold,
              autoAcceptThreshold: settings.autoAcceptThreshold,
              autoGenerateSprites: settings.autoGenerateSprites,
            },
          },
        });
        const id = md?.stashTagBatchAnalyze;
        if (!id) return;
        setJobVerified(true);
        setData((prev) => {
          const next = {
            ...prev,
            jobID: id,
            jobStatus: GQL.JobStatus.Ready as string,
            jobProgress: null,
          };
          saveData(next);
          return next;
        });
      } catch (err) {
        console.error("StashTag submit failed:", err);
      }
    },
    [submitJob]
  );

  const stopJob = useCallback(async () => {
    if (!data.jobID) return;
    try {
      await stopJobMutation({ variables: { job_id: parseInt(data.jobID, 10) } });
    } catch {
      /* ignore */
    }
  }, [data.jobID, stopJobMutation]);

  const dismissScene = useCallback((sceneId: string) => {
    setData((prev) => {
      const dismissed = [...new Set([...prev.dismissed, sceneId])];
      const next = { ...prev, dismissed };
      saveData(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(async () => {
    if (data.jobID) {
      try {
        await clearJobResult({ variables: { jobID: data.jobID } });
      } catch {
        /* ignore */
      }
    }
    const next = { ...EMPTY };
    saveData(next);
    setData(next);
    setJobVerified(false);
  }, [data.jobID, clearJobResult]);

  return {
    jobID: data.jobID,
    jobStatus: data.jobStatus as GQL.JobStatus | null,
    jobProgress: data.jobProgress,
    isRunning,
    pendingReviewCount,
    hasResult,
    getResult,
    runAnalysis,
    stopJob,
    dismissScene,
    clearAll,
  };
}
