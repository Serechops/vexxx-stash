import {
  faBan,
  faCheck,
  faCircle,
  faCircleExclamation,
  faCog,
  faHourglassStart,
  faTimes,
  faMemory,
  faMicrochip,
} from "@fortawesome/free-solid-svg-icons";
import { formatRelativeTime } from "src/utils/date";
import React, { useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Icon } from "src/components/Shared/Icon";
import {
  mutateStopJob,
  useJobQueue,
  useJobsSubscribe,
} from "src/core/StashService";
import * as GQL from "src/core/generated-graphql";
import {
  Box,
  Paper,
  Typography,
  LinearProgress,
  IconButton,
  Chip,
  Tooltip,
  alpha,
  Theme,
} from "@mui/material";

type JobFragment = Pick<
  GQL.Job,
  | "id"
  | "status"
  | "subTasks"
  | "description"
  | "progress"
  | "error"
  | "startTime"
>;

interface IJob {
  job: JobFragment;
}

const Task: React.FC<IJob> = ({ job }) => {
  const [stopping, setStopping] = useState(false);
  const [className, setClassName] = useState("");
  const [subTaskHistory, setSubTaskHistory] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`job-history-${job.id}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const terminalRef = useRef<HTMLDivElement>(null);

  const prevStatus = useRef(job.status);
  const [justFinished, setJustFinished] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setClassName("fade-in"));
  }, []);

  useEffect(() => {
    if (
      job.status === GQL.JobStatus.Cancelled ||
      job.status === GQL.JobStatus.Failed ||
      job.status === GQL.JobStatus.Finished
    ) {
      setTimeout(() => {
        setClassName("fade-out");
      }, 4500);
    }
  }, [job.status]);

  useEffect(() => {
    if (prevStatus.current !== GQL.JobStatus.Finished && job.status === GQL.JobStatus.Finished) {
      setJustFinished(true);
      const timer = setTimeout(() => setJustFinished(false), 2000);
      return () => clearTimeout(timer);
    }
    prevStatus.current = job.status;
  }, [job.status]);

  useEffect(() => {
    if (job.subTasks && job.subTasks.length > 0) {
      setSubTaskHistory((prev) => {
        let updated = [...prev];
        let changed = false;
        job.subTasks!.forEach((t) => {
          if (t && (updated.length === 0 || updated[updated.length - 1] !== t)) {
            updated.push(t);
            changed = true;
          }
        });
        if (!changed) return prev;
        if (updated.length > 500) {
          updated = updated.slice(updated.length - 500);
        }
        return updated;
      });
    }
  }, [job.subTasks]);

  useEffect(() => {
    try {
      if (subTaskHistory.length > 0) {
        localStorage.setItem(`job-history-${job.id}`, JSON.stringify(subTaskHistory));
      } else {
        localStorage.removeItem(`job-history-${job.id}`);
      }
    } catch (e) {
      console.error("Failed to save job history to localStorage", e);
    }
  }, [subTaskHistory, job.id]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [subTaskHistory, job.error]);

  async function stopJob() {
    setStopping(true);
    await mutateStopJob(job.id);
  }

  function canStop() {
    return (
      !stopping &&
      (job.status === GQL.JobStatus.Ready ||
        job.status === GQL.JobStatus.Running)
    );
  }

  function getStatusIcon() {
    let icon = faCircle;
    let spin = false;
    switch (job.status) {
      case GQL.JobStatus.Ready:
        icon = faHourglassStart;
        break;
      case GQL.JobStatus.Running:
      case GQL.JobStatus.Stopping:
        icon = faCog;
        spin = true;
        break;
      case GQL.JobStatus.Finished:
        icon = faCheck;
        break;
      case GQL.JobStatus.Cancelled:
        icon = faBan;
        break;
      case GQL.JobStatus.Failed:
        icon = faCircleExclamation;
        break;
    }

    let color = "text.secondary";
    switch (job.status) {
      case GQL.JobStatus.Running:
        color = "primary.main";
        break;
      case GQL.JobStatus.Finished:
        color = "success.main";
        break;
      case GQL.JobStatus.Failed:
      case GQL.JobStatus.Cancelled:
        color = "error.main";
        break;
      default:
        color = "warning.main";
        break;
    }

    return (
      <Box sx={{ color, display: "inline-flex", alignItems: "center", mr: 1.5 }}>
        <Icon icon={icon} className={spin ? "fa-spin" : ""} />
      </Box>
    );
  }

  const getProgressColor = () => {
    switch (job.status) {
      case GQL.JobStatus.Finished:
        return "success";
      case GQL.JobStatus.Failed:
        return "error";
      default:
        return "primary";
    }
  };

  const getCardStyles = () => {
    const base = {
      p: 2,
      mb: 1.5,
      borderRadius: 1.5,
      bgcolor: "background.default",
      border: "1px solid",
      borderColor: "divider",
      transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
      animation: "fadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards",
      "@keyframes fadeIn": {
        from: { opacity: 0, transform: "translateY(12px)" },
        to: { opacity: 1, transform: "translateY(0)" },
      },
      ...(className === "fade-out" && {
        animation: "fadeOut 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "@keyframes fadeOut": {
          from: { opacity: 1, transform: "translateY(0)" },
          to: { opacity: 0, transform: "translateY(-12px)" },
        },
      }),
    };

    switch (job.status) {
      case GQL.JobStatus.Finished:
        return {
          ...base,
          bgcolor: (theme: Theme) => alpha(theme.palette.success.main, 0.03),
          borderColor: (theme: Theme) => alpha(theme.palette.success.main, 0.3),
          ...(justFinished && {
            boxShadow: (theme: Theme) => `0 0 0 4px ${alpha(theme.palette.success.main, 0.25)}, 0 4px 20px ${alpha(theme.palette.success.main, 0.2)}`,
            transform: "scale(1.005)",
          }),
        };
      case GQL.JobStatus.Failed:
        return {
          ...base,
          bgcolor: (theme: Theme) => alpha(theme.palette.error.main, 0.03),
          borderColor: (theme: Theme) => alpha(theme.palette.error.main, 0.3),
        };
      case GQL.JobStatus.Cancelled:
        return {
          ...base,
          bgcolor: (theme: Theme) => alpha(theme.palette.action.disabledBackground, 0.3),
          borderColor: "divider",
          opacity: 0.7,
        };
      default:
        return base;
    }
  };

  const progress = (job.progress ?? 0) * 100;

  return (
    <Paper variant="outlined" sx={getCardStyles()}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", minWidth: 0, flexGrow: 1, gap: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", minWidth: 0 }}>
            {getStatusIcon()}
            <Typography
              variant="body1"
              noWrap
              sx={{ fontWeight: 600, color: "text.primary" }}
              title={job.description}
            >
              {job.description}
            </Typography>
          </Box>
          {job.status === GQL.JobStatus.Finished && (
            <Chip
              icon={<Icon icon={faCheck} />}
              label="Cleared"
              color="success"
              size="small"
              sx={{
                height: 20,
                fontSize: "0.75rem",
                animation: "popScale 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards",
                "@keyframes popScale": {
                  "0%": { transform: "scale(0.8)", opacity: 0 },
                  "100%": { transform: "scale(1)", opacity: 1 },
                }
              }}
            />
          )}
          {job.status === GQL.JobStatus.Cancelled && (
            <Chip
              icon={<Icon icon={faBan} />}
              label="Cancelled"
              color="default"
              size="small"
              sx={{ height: 20, fontSize: "0.75rem", opacity: 0.8 }}
            />
          )}
          {job.status === GQL.JobStatus.Failed && (
            <Chip
              icon={<Icon icon={faCircleExclamation} />}
              label="Failed"
              color="error"
              size="small"
              sx={{ height: 20, fontSize: "0.75rem" }}
            />
          )}
        </Box>
        <IconButton
          size="small"
          onClick={stopJob}
          disabled={!canStop()}
          title="Stop Job"
          sx={{
            color: "text.secondary",
            "&:hover": { color: "error.main" }
          }}
        >
          <Icon icon={faTimes} />
        </IconButton>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: (subTaskHistory.length || job.error) ? 2 : 0 }}>
        <LinearProgress
          variant={job.status === GQL.JobStatus.Running && job.progress === null ? "indeterminate" : "determinate"}
          value={job.status === GQL.JobStatus.Finished ? 100 : progress}
          color={getProgressColor()}
          sx={{
            height: 6,
            borderRadius: 3,
            flexGrow: 1,
            bgcolor: "action.hover",
            "& .MuiLinearProgress-bar": {
              borderRadius: 3,
              transition: "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
            }
          }}
        />
        {job.status === GQL.JobStatus.Running && job.startTime && (
          <Typography variant="caption" sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>
            {formatRelativeTime(job.startTime)}
          </Typography>
        )}
      </Box>

      {((subTaskHistory && subTaskHistory.length > 0) || job.error) ? (
        <Box
          ref={terminalRef}
          sx={{
            mt: 1.5,
            p: 1.5,
            bgcolor: "rgba(0, 0, 0, 0.3)",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            maxHeight: "150px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 1,
            "&::-webkit-scrollbar": {
              width: "6px",
              height: "6px",
            },
            "&::-webkit-scrollbar-thumb": {
              bgcolor: "divider",
              borderRadius: "3px",
              "&:hover": {
                bgcolor: "text.secondary",
              }
            }
          }}
        >
          {subTaskHistory.map((t, i) => {
            const isLatest = i === subTaskHistory.length - 1;
            const isRunning = job.status === GQL.JobStatus.Running;

            const renderIndicator = () => {
              if (isLatest && isRunning) {
                return (
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      bgcolor: "primary.main",
                      animation: "pulseGlow 1.2s infinite ease-in-out",
                      "@keyframes pulseGlow": {
                        "0%, 100%": { transform: "scale(0.8)", opacity: 0.5 },
                        "50%": { transform: "scale(1.3)", opacity: 1 },
                      }
                    }}
                  />
                );
              }

              // Completed steps or when job is finished: show a green checkmark
              if (job.status === GQL.JobStatus.Finished || !isLatest || !isRunning) {
                if (job.status === GQL.JobStatus.Failed && isLatest) {
                  return (
                    <Box sx={{ color: "error.main", fontSize: "10px", display: "flex", alignItems: "center" }}>
                      <Icon icon={faCircleExclamation} />
                    </Box>
                  );
                }
                if (job.status === GQL.JobStatus.Cancelled && isLatest) {
                  return (
                    <Box sx={{ color: "text.secondary", fontSize: "10px", display: "flex", alignItems: "center" }}>
                      <Icon icon={faBan} />
                    </Box>
                  );
                }
                return (
                  <Box sx={{ color: "success.main", fontSize: "9px", display: "flex", alignItems: "center" }}>
                    <Icon icon={faCheck} />
                  </Box>
                );
              }

              return (
                <Box
                  sx={{
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    bgcolor: "text.secondary",
                  }}
                />
              );
            };

            return (
              <Box
                key={i}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  py: 0.25,
                  opacity: (isLatest && isRunning) || job.status === GQL.JobStatus.Finished || (!isLatest && isRunning) ? 1 : 0.8,
                  transition: "opacity 0.2s ease",
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 14,
                    height: 14,
                  }}
                >
                  {renderIndicator()}
                </Box>
                <Typography
                  variant="body2"
                  sx={{
                    fontSize: "0.825rem",
                    color: isLatest && isRunning ? "text.primary" : "text.secondary",
                    fontWeight: isLatest && isRunning ? 500 : 400,
                    lineHeight: 1.4,
                  }}
                >
                  {t}
                </Typography>
              </Box>
            );
          })}
          {job.error && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                py: 0.25,
                color: "error.main",
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 14,
                  height: 14,
                  color: "error.main",
                }}
              >
                <Icon icon={faCircleExclamation} style={{ fontSize: "10px" }} />
              </Box>
              <Typography
                variant="body2"
                sx={{
                  fontSize: "0.825rem",
                  color: "error.main",
                  fontWeight: 600,
                  lineHeight: 1.4,
                }}
              >
                Error: {job.error}
              </Typography>
            </Box>
          )}
        </Box>
      ) : null}
    </Paper>
  );
};

const ResourceMonitor: React.FC = () => {
  const { data } = GQL.useSystemStatsQuery({
    pollInterval: 2000,
    fetchPolicy: "network-only",
  });

  if (!data?.systemStats) return null;

  return (
    <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, mb: 1 }}>
      <Tooltip title="Memory Usage" arrow>
        <Chip
          icon={<Icon icon={faMemory} />}
          label={`${Math.round(data.systemStats.memory)} MB`}
          size="small"
          variant="outlined"
          sx={{ fontSize: "0.75rem" }}
        />
      </Tooltip>
      <Tooltip title="Active Goroutines" arrow>
        <Chip
          icon={<Icon icon={faMicrochip} />}
          label={`${data.systemStats.goroutines}`}
          size="small"
          variant="outlined"
          sx={{ fontSize: "0.75rem" }}
        />
      </Tooltip>
    </Box>
  );
};

export const JobTable: React.FC = () => {
  const intl = useIntl();
  const jobStatus = useJobQueue();
  const jobsSubscribe = useJobsSubscribe();

  const [queue, setQueue] = useState<JobFragment[]>([]);

  useEffect(() => {
    setQueue(jobStatus.data?.jobQueue ?? []);
  }, [jobStatus]);

  useEffect(() => {
    if (jobStatus.loading || !jobStatus.data) {
      return;
    }

    try {
      const activeIds = new Set(queue.map((j) => j.id));
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("job-history-")) {
          const jobId = key.substring("job-history-".length);
          if (!activeIds.has(jobId)) {
            localStorage.removeItem(key);
            i--;
          }
        }
      }
    } catch (e) {
      console.error("Failed to clean up stale job histories from localStorage", e);
    }
  }, [queue, jobStatus.loading, jobStatus.data]);

  useEffect(() => {
    if (!jobsSubscribe.data) {
      return;
    }

    const event = jobsSubscribe.data.jobsSubscribe;

    function updateJob() {
      setQueue((q) =>
        q.map((j) => {
          if (j.id === event.job.id) {
            return event.job;
          }

          return j;
        })
      );
    }

    switch (event.type) {
      case GQL.JobStatusUpdateType.Add:
        setQueue((q) => q.concat([event.job]));
        break;
      case GQL.JobStatusUpdateType.Remove:
        updateJob();
        setTimeout(() => {
          setQueue((q) => q.filter((j) => j.id !== event.job.id));
        }, 5000);
        break;
      case GQL.JobStatusUpdateType.Update:
        updateJob();
        break;
    }
  }, [jobsSubscribe.data]);

  if (!queue?.length) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <ResourceMonitor />
        <Box
          sx={{
            p: 6,
            textAlign: "center",
            border: "1px dashed",
            borderColor: "divider",
            borderRadius: 1.5,
            bgcolor: "background.default",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            animation: "fadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards",
            "@keyframes fadeIn": {
              from: { opacity: 0, transform: "translateY(8px)" },
              to: { opacity: 1, transform: "translateY(0)" },
            },
          }}
        >
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              bgcolor: (theme) => alpha(theme.palette.success.main, 0.1),
              color: "success.main",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.2rem",
              mb: 0.5,
            }}
          >
            <Icon icon={faCheck} />
          </Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: "text.primary" }}>
            All tasks completed
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 300, mx: "auto" }}>
            {intl.formatMessage({ id: "config.tasks.empty_queue" })}
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <ResourceMonitor />
      {queue.map((j) => (
        <Task job={j} key={j.id} />
      ))}
    </Box>
  );
};
