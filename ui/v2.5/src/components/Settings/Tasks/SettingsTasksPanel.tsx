import React, { useState } from "react";
import { useIntl } from "react-intl";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { LibraryTasks } from "./LibraryTasks";
import { DataManagementTasks } from "./DataManagementTasks";
import { PluginTasks } from "./PluginTasks";
import { ScheduledTasks } from "./ScheduledTasks";
import { JobTable } from "./JobTable";

type TaskSectionKey = "queue" | "scheduled" | "library" | "data" | "plugins";

export const SettingsTasksPanel: React.FC = () => {
  const intl = useIntl();
  const [isBackupRunning, setIsBackupRunning] = useState<boolean>(false);
  const [isAnonymiseRunning, setIsAnonymiseRunning] = useState<boolean>(false);
  const [expandedSections, setExpandedSections] = useState<
    Record<TaskSectionKey, boolean>
  >({
    queue: true,
    scheduled: true,
    library: true,
    data: true,
    plugins: true,
  });

  const toggleSection = (section: TaskSectionKey) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

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
    <Box id="tasks-panel" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Accordion
        expanded={expandedSections.queue}
        onChange={() => toggleSection("queue")}
        TransitionProps={{ mountOnEnter: true, unmountOnExit: true }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">
            {intl.formatMessage({ id: "config.tasks.job_queue" })}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          {expandedSections.queue ? <JobTable /> : null}
        </AccordionDetails>
      </Accordion>

      <Accordion
        expanded={expandedSections.scheduled}
        onChange={() => toggleSection("scheduled")}
        TransitionProps={{ mountOnEnter: true, unmountOnExit: true }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">
            {intl.formatMessage({
              id: "config.tasks.scheduled_tasks",
              defaultMessage: "Scheduled Tasks",
            })}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          {expandedSections.scheduled ? <ScheduledTasks /> : null}
        </AccordionDetails>
      </Accordion>

      <Accordion
        expanded={expandedSections.library}
        onChange={() => toggleSection("library")}
        TransitionProps={{ mountOnEnter: true, unmountOnExit: true }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">
            {intl.formatMessage({
              id: "config.tasks.library_tasks",
              defaultMessage: "Library Tasks",
            })}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          {expandedSections.library ? <LibraryTasks /> : null}
        </AccordionDetails>
      </Accordion>

      <Accordion
        expanded={expandedSections.data}
        onChange={() => toggleSection("data")}
        TransitionProps={{ mountOnEnter: true, unmountOnExit: true }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">
            {intl.formatMessage({ id: "config.tasks.data_management" })}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          {expandedSections.data ? (
            <DataManagementTasks
              setIsBackupRunning={setIsBackupRunning}
              setIsAnonymiseRunning={setIsAnonymiseRunning}
            />
          ) : null}
        </AccordionDetails>
      </Accordion>

      <Accordion
        expanded={expandedSections.plugins}
        onChange={() => toggleSection("plugins")}
        TransitionProps={{ mountOnEnter: true, unmountOnExit: true }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">
            {intl.formatMessage({ id: "config.tasks.plugin_tasks" })}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          {expandedSections.plugins ? <PluginTasks /> : null}
        </AccordionDetails>
      </Accordion>

      <Box sx={{ mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {intl.formatMessage({
            id: "config.tasks.lazy_sections_hint",
            defaultMessage:
              "Sections load on demand when expanded to keep the tasks page responsive.",
          })}
        </Typography>
      </Box>
    </Box>
  );
};
