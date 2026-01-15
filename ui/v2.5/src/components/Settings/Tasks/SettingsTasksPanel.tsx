import React, { useState } from "react";
import { useIntl } from "react-intl";
import { Box, Divider, Typography } from "@mui/material";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { LibraryTasks } from "./LibraryTasks";
import { DataManagementTasks } from "./DataManagementTasks";
import { PluginTasks } from "./PluginTasks";
import { ScheduledTasks } from "./ScheduledTasks";
import { JobTable } from "./JobTable";

export const SettingsTasksPanel: React.FC = () => {
  const intl = useIntl();
  const [isBackupRunning, setIsBackupRunning] = useState<boolean>(false);
  const [isAnonymiseRunning, setIsAnonymiseRunning] = useState<boolean>(false);

  if (isBackupRunning) {
    return (
      <LoadingIndicator
        message={intl.formatMessage({ id: "config.tasks.backing_up_database" })}
      />
    );
  }

  if (isAnonymiseRunning) {
    return (
      <LoadingIndicator
        message={intl.formatMessage({
          id: "config.tasks.anonymising_database",
        })}
      />
    );
  }

  return (
    <Box id="tasks-panel">
      <Box className="tasks-panel-queue">
        <Typography variant="h4" gutterBottom>{intl.formatMessage({ id: "config.tasks.job_queue" })}</Typography>
        <JobTable />
      </Box>

      <Box className="tasks-panel-tasks" sx={{ mt: 3 }}>
        <ScheduledTasks />
        <Divider sx={{ my: 3 }} />
        <LibraryTasks />
        <Divider sx={{ my: 3 }} />
        <DataManagementTasks
          setIsBackupRunning={setIsBackupRunning}
          setIsAnonymiseRunning={setIsAnonymiseRunning}
        />
        <Divider sx={{ my: 3 }} />
        <PluginTasks />
      </Box>
    </Box>
  );
};
