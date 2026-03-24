import React, { useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Box, Chip, Paper, Typography } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { useLoggingSubscribe, queryLogs } from "src/core/StashService";
import { SelectSetting } from "./Inputs";
import { SettingSection } from "./SettingSection";
import { JobTable } from "./Tasks/JobTable";
import { useConfigurationContext } from "src/hooks/Config";
import { useSettings } from "./context";

function convertTime(logEntry: GQL.LogEntryDataFragment) {
  function pad(val: number) {
    let ret = val.toString();
    if (val <= 9) {
      ret = `0${ret}`;
    }

    return ret;
  }

  const date = new Date(logEntry.time);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  let dateStr = `${date.getFullYear()}-${pad(month)}-${pad(day)}`;
  dateStr += ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;

  return dateStr;
}

type LogLevelColor = "default" | "info" | "warning" | "error" | "primary";

// Ordered list of ALL levels including Progress — used for filter comparisons
const LOG_LEVEL_ORDER = ["Trace", "Debug", "Info", "Progress", "Warning", "Error"];

const LEVEL_CHIP_COLOR: Record<string, LogLevelColor> = {
  trace:    "default",   // grey
  debug:    "info",      // blue outline (low severity)
  info:     "info",      // blue filled (standard info colour)
  progress: "primary",   // primary filled
  warning:  "warning",   // amber filled
  error:    "error",     // red filled
};

const LEVEL_ROW_BG: Record<string, string> = {
  warning: "warning.dark",
  error:   "error.dark",
};

interface ILogElementProps {
  logEntry: LogEntry;
}

const LogElement: React.FC<ILogElementProps> = ({ logEntry }) => {
  const levelKey = logEntry.level.toLowerCase().trim();
  const chipColor = LEVEL_CHIP_COLOR[levelKey] ?? "default";
  const rowBg = LEVEL_ROW_BG[levelKey];

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 1,
        px: 1,
        py: 0.5,
        borderBottom: "1px solid",
        borderColor: "divider",
        ...(rowBg
          ? { bgcolor: rowBg, "& .MuiTypography-root": { color: "#fff" } }
          : {}),
        "&:last-child": { borderBottom: 0 },
      }}
    >
      <Typography
        variant="body2"
        sx={{
          fontFamily: "monospace",
          whiteSpace: "nowrap",
          color: "text.secondary",
          minWidth: "155px",
          flexShrink: 0,
          lineHeight: "24px",
        }}
      >
        {logEntry.time}
      </Typography>
      <Box sx={{ flexShrink: 0, minWidth: "80px" }}>
        <Chip
          label={logEntry.level.trim()}
          size="small"
          color={chipColor}
          variant={["trace", "debug"].includes(levelKey) ? "outlined" : "filled"}
          sx={{ fontFamily: "monospace", fontSize: "0.7rem", height: "20px" }}
        />
      </Box>
      <Typography
        variant="body2"
        sx={{
          fontFamily: "monospace",
          wordBreak: "break-word",
          flexGrow: 1,
        }}
      >
        {logEntry.message}
      </Typography>
    </Box>
  );
};

class LogEntry {
  public time: string;
  public level: string;
  public message: string;
  public id: string;

  private static nextId: number = 0;

  public constructor(logEntry: GQL.LogEntryDataFragment) {
    this.time = convertTime(logEntry);
    this.level = logEntry.level;
    this.message = logEntry.message;

    const id = LogEntry.nextId++;
    this.id = id.toString();
  }
}

// maximum number of log entries to keep - entries are discarded oldest-first
const MAX_LOG_ENTRIES = 50000;
// maximum number of log entries to display
const MAX_DISPLAY_LOG_ENTRIES = 1000;
const logLevels = ["Trace", "Debug", "Info", "Warning", "Error"];

// Map backend config values to frontend names
const configToLogLevel = (configLevel: string): string => {
  const level = configLevel.charAt(0).toUpperCase() + configLevel.slice(1).toLowerCase();
  return logLevels.includes(level) ? level : "Info";
};

export const SettingsLogsPanel: React.FC = () => {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const { data, error } = useLoggingSubscribe();
  const intl = useIntl();
  const logEndRef = useRef<HTMLDivElement>(null);

  // Get current config and update function
  const { configuration } = useConfigurationContext();
  const { saveGeneral, general } = useSettings();

  // Get current backend log level from config (prefer local state, fall back to configuration)
  const logLevel = general?.logLevel
    ? configToLogLevel(general.logLevel)
    : configuration?.general?.logLevel
      ? configToLogLevel(configuration.general.logLevel)
      : "Info";

  useEffect(() => {
    async function getInitialLogs() {
      const logQuery = await queryLogs();
      if (logQuery.error) return;

      const initEntries = logQuery.data.logs.map((e) => new LogEntry(e));
      if (initEntries.length !== 0) {
        setEntries((prev) => {
          return [...prev, ...initEntries].slice(0, MAX_LOG_ENTRIES);
        });
      }
    }

    getInitialLogs();
  }, []);

  useEffect(() => {
    if (!data) return;

    const newEntries = data.loggingSubscribe.map((e) => new LogEntry(e));
    newEntries.reverse();
    setEntries((prev) => {
      return [...newEntries, ...prev].slice(0, MAX_LOG_ENTRIES);
    });
  }, [data]);

  // Filter entries based on current log level.
  // Uses LOG_LEVEL_ORDER (which includes Progress) so Progress entries are
  // correctly shown when the filter is set to Info or lower.
  function filterByLogLevel(logEntry: LogEntry) {
    const selectedIndex = LOG_LEVEL_ORDER.indexOf(logLevel);
    const entryIndex = LOG_LEVEL_ORDER.indexOf(logEntry.level);
    // Unknown levels (entryIndex === -1) are always shown
    return entryIndex === -1 || entryIndex >= selectedIndex;
  }

  const displayEntries = entries
    .filter(filterByLogLevel)
    .slice(0, MAX_DISPLAY_LOG_ENTRIES);

  // Handle log level change
  function handleLogLevelChange(level: string) {
    saveGeneral({ logLevel: level });
  }

  return (
    <>
      <h2>{intl.formatMessage({ id: "config.tasks.job_queue" })}</h2>
      <JobTable />
      <SettingSection headingID="config.categories.logs">
        <SelectSetting
          id="log-level"
          headingID="config.logs.log_level"
          subHeadingID="config.logs.log_level_desc"
          value={logLevel}
          onChange={(v) => handleLogLevelChange(v)}
        >
          {logLevels.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </SelectSetting>
      </SettingSection>

      <Paper
        variant="outlined"
        sx={{
          mt: 2,
          maxHeight: "60vh",
          overflowY: "auto",
          bgcolor: "background.paper",
          fontFamily: "monospace",
        }}
      >
        {error && (
          <Box sx={{ p: 1.5 }}>
            <Typography color="error" variant="body2">
              Error connecting to log server: {error.message}
            </Typography>
          </Box>
        )}
        {displayEntries.map((logEntry) => (
          <LogElement logEntry={logEntry} key={logEntry.id} />
        ))}
        <div ref={logEndRef} />
      </Paper>
    </>
  );
};
