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
import React, { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Icon } from "src/components/Shared/Icon";
import {
  mutateStopJob,
  useJobQueue,
  useJobsSubscribe,
} from "src/core/StashService";
import * as GQL from "src/core/generated-graphql";

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

  function getStatusColorClass() {
    switch (job.status) {
      case GQL.JobStatus.Running:
        return "status-running";
      case GQL.JobStatus.Finished:
        return "status-done";
      case GQL.JobStatus.Failed:
      case GQL.JobStatus.Cancelled:
        return "status-failed";
      default:
        return "status-queued";
    }
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

    return (
      <span className={`job-icon ${getStatusColorClass()}`}>
        <Icon icon={icon} className={spin ? "fa-spin" : ""} />
      </span>
    );
  }

  const progress = (job.progress ?? 0) * 100;

  return (
    <div className={`job-card ${className}`}>
      <div className="job-header">
        <div className="job-title-row">
          {getStatusIcon()}
          <span title={job.description}>
            {job.description}
          </span>
        </div>
        <button
          className="btn-stop"
          onClick={stopJob}
          disabled={!canStop()}
          title="Stop Job"
        >
          <Icon icon={faTimes} />
        </button>
      </div>

      <div className="job-progress-row">
        <div className="progress">
          <div
            className="progress-bar"
            style={{ width: `${progress}%` }}
          />
        </div>
        {job.status === GQL.JobStatus.Running && job.startTime && (
          <span className="eta">{formatRelativeTime(job.startTime)}</span>
        )}
      </div>

      {(job.subTasks && job.subTasks.length > 0) || job.error ? (
        <div className="job-terminal">
          {job.subTasks?.map((t, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div className="job-subtask" key={i}>
              {t}
            </div>
          ))}
          {job.error && <div className="job-error">Error: {job.error}</div>}
        </div>
      ) : null}
    </div>
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
        // keep it visible for a moment before removing
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
      <div className="job-table-container">
        <ResourceMonitor />
        <div className="empty-queue-message">
          {intl.formatMessage({ id: "config.tasks.empty_queue" })}
        </div>
      </div>
    );
  }

  return (
    <div className="job-table-container">
      <ResourceMonitor />
      {(queue ?? []).map((j) => (
        <Task job={j} key={j.id} />
      ))}
    </div>
  );
};

const ResourceMonitor: React.FC = () => {
  const { data } = GQL.useSystemStatsQuery({
    pollInterval: 2000,
    fetchPolicy: "network-only",
  });

  if (!data?.systemStats) return null;

  /**
   * Displays real-time system metrics (Memory usage and Goroutine count).
   * Polls every 2 seconds via GraphQL.
   */
  return (
    <div className="resource-monitor flex justify-end mb-2 small" style={{ color: '#a1a1aa' }}>
      <span className="mr-3" title="Memory Usage">
        <Icon icon={faMemory} className="mr-1" />
        <strong>{Math.round(data.systemStats.memory)} MB</strong>
      </span>
      <span title="Active Goroutines (Concurrency)">
        <Icon icon={faMicrochip} className="mr-1" />
        <strong>{data.systemStats.goroutines}</strong>
      </span>
    </div>
  );
};
