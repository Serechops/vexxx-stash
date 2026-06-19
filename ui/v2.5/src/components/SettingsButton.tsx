import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React, { useEffect, useState } from "react";
import { IconButton } from "@mui/material";
import { useJobQueue, useJobsSubscribe } from "src/core/StashService";
import * as GQL from "src/core/generated-graphql";
import { useIntl } from "react-intl";
import { faCog } from "@fortawesome/free-solid-svg-icons";

type JobFragment = Pick<
  GQL.Job,
  "id" | "status" | "subTasks" | "description" | "progress"
>;

export const SettingsButton: React.FC = () => {
  const intl = useIntl();
  const jobStatus = useJobQueue();
  const jobsSubscribe = useJobsSubscribe();

  const [queue, setQueue] = useState<JobFragment[]>([]);

  // jobStatus (the Apollo result object) is a new reference on every render in
  // Apollo 3.x, so using it as a dependency would reset the queue each render,
  // wiping subscription updates. jobStatus.data is stable between fetches.
  useEffect(() => {
    setQueue(jobStatus.data?.jobQueue ?? []);
  }, [jobStatus.data]);

  useEffect(() => {
    if (!jobsSubscribe.data) {
      return;
    }

    const event = jobsSubscribe.data.jobsSubscribe;

    function updateJob() {
      setQueue((q) =>
        q.map((j) => (j.id === event.job.id ? event.job : j))
      );
    }

    switch (event.type) {
      case GQL.JobStatusUpdateType.Add:
        setQueue((q) => q.concat([event.job]));
        break;
      case GQL.JobStatusUpdateType.Remove:
        setQueue((q) => q.filter((j) => j.id !== event.job.id));
        break;
      case GQL.JobStatusUpdateType.Update:
        updateJob();
        break;
    }
  }, [jobsSubscribe.data]);

  const isSpinning = queue.some(
    (j) =>
      j.status === GQL.JobStatus.Running || j.status === GQL.JobStatus.Ready
  );

  return (
    <IconButton
      className="minimal"
      sx={{ display: "flex", alignItems: "center", height: "100%" }}
      title={intl.formatMessage({ id: "settings" })}
      color="inherit"
    >
      <FontAwesomeIcon icon={faCog} spin={isSpinning} />
    </IconButton>
  );
};
