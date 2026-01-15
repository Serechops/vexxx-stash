import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Container,
  TextField,
  LinearProgress,
  Box,
  Typography,
  CardContent,
  Alert,
  Stack,
  Divider,
} from "@mui/material";
import { useIntl, FormattedMessage } from "react-intl";
import { useHistory } from "react-router-dom";
import * as GQL from "src/core/generated-graphql";
import {
  useSystemStatus,
  mutateMigrate,
  postMigrate,
  refetchSystemStatus,
} from "src/core/StashService";
import { migrationNotes } from "src/docs/en/MigrationNotes";
import { ExternalLink } from "../Shared/ExternalLink";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { MarkdownPage } from "../Shared/MarkdownPage";
import { JobFragment, useMonitorJob } from "src/utils/job";

export const Migrate: React.FC = () => {
  const intl = useIntl();
  const history = useHistory();

  const { data: systemStatus, loading } = useSystemStatus();

  const [backupPath, setBackupPath] = useState<string | undefined>();
  const [migrateLoading, setMigrateLoading] = useState(false);
  const [migrateError, setMigrateError] = useState("");

  const [jobID, setJobID] = useState<string | undefined>();

  function onJobFinished(finishedJob?: JobFragment) {
    setJobID(undefined);
    setMigrateLoading(false);

    if (finishedJob?.error) {
      setMigrateError(finishedJob.error);
    } else {
      postMigrate();
      // refetch the system status so that the we get redirected
      refetchSystemStatus();
    }
  }

  const { job } = useMonitorJob(jobID, onJobFinished);

  // if database path includes path separators, then this is passed through
  // to the migration path. Extract the base name of the database file.
  const databasePath = systemStatus
    ? systemStatus?.systemStatus.databasePath?.split(/[\\/]/).pop()
    : "";

  // make suffix based on current time
  const now = new Date()
    .toISOString()
    .replace(/T/g, "_")
    .replace(/-/g, "")
    .replace(/:/g, "")
    .replace(/\..*/, "");
  const defaultBackupPath = systemStatus
    ? `${databasePath}.${systemStatus.systemStatus.databaseSchema}.${now}`
    : "";

  const discordLink = (
    <ExternalLink href="https://discord.gg/2TsNFKt">Discord</ExternalLink>
  );
  const githubLink = (
    <ExternalLink href="https://github.com/stashapp/stash/issues">
      <FormattedMessage id="setup.github_repository" />
    </ExternalLink>
  );

  useEffect(() => {
    if (backupPath === undefined && defaultBackupPath) {
      setBackupPath(defaultBackupPath);
    }
  }, [defaultBackupPath, backupPath]);

  const status = systemStatus?.systemStatus;

  const maybeMigrationNotes = useMemo(() => {
    if (
      !status ||
      status.databaseSchema === undefined ||
      status.databaseSchema === null ||
      status.appSchema === undefined ||
      status.appSchema === null
    )
      return;

    const notes = [];
    for (let i = status.databaseSchema + 1; i <= status.appSchema; ++i) {
      const note = migrationNotes[i];
      if (note) {
        notes.push(note);
      }
    }

    if (notes.length === 0) return;

    return (
      <Box className="migration-notes" mt={4} mb={4}>
        <Typography variant="h5" gutterBottom>
          <FormattedMessage id="setup.migrate.migration_notes" />
        </Typography>
        <Box>
          {notes.map((n, i) => (
            <Box key={i} mb={2}>
              <MarkdownPage page={n} />
            </Box>
          ))}
        </Box>
      </Box>
    );
  }, [status]);

  // only display setup wizard if system is not setup
  if (loading || !systemStatus || !status) {
    return <LoadingIndicator />;
  }

  if (migrateLoading) {
    const progress =
      job && job.progress !== undefined && job.progress !== null
        ? job.progress * 100
        : undefined;

    return (
      <Container maxWidth="md" sx={{ mt: 4 }}>
        <Box textAlign="center" mb={4}>
          <Box display="flex" alignItems="center" justifyContent="center" mb={2}>
            <LoadingIndicator inline small message="" />
            <Typography variant="h4" component="span" ml={2}>
              <FormattedMessage id="setup.migrate.migrating_database" />
            </Typography>
          </Box>
        </Box>
        {progress !== undefined && (
          <Box mb={2}>
            <LinearProgress variant="determinate" value={progress} sx={{ height: 10, borderRadius: 5 }} />
            <Typography variant="body2" align="center" mt={1}>
              {progress.toFixed(0)}%
            </Typography>
          </Box>
        )}
        {job?.subTasks?.map((subTask, i) => (
          <Typography key={i} variant="body1" align="center">{subTask}</Typography>
        ))}
      </Container>
    );
  }

  if (
    systemStatus.systemStatus.status !== GQL.SystemStatusEnum.NeedsMigration
  ) {
    // redirect to main page
    history.replace("/");
    return <LoadingIndicator />;
  }

  async function onMigrate() {
    try {
      setMigrateLoading(true);
      setMigrateError("");

      // migrate now uses the job manager
      const ret = await mutateMigrate({
        backupPath: backupPath ?? "",
      });

      setJobID(ret.data?.migrate);
    } catch (e) {
      if (e instanceof Error) setMigrateError(e.message ?? e.toString());
      setMigrateLoading(false);
    }
  }

  function maybeRenderError() {
    if (!migrateError) {
      return;
    }

    return (
      <Box mt={4}>
        <Typography variant="h4" color="error" gutterBottom>
          <FormattedMessage id="setup.migrate.migration_failed" />
        </Typography>

        <Typography paragraph>
          <FormattedMessage id="setup.migrate.migration_failed_error" />
        </Typography>

        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {migrateError}
            </Typography>
          </CardContent>
        </Card>

        <Typography paragraph>
          <FormattedMessage
            id="setup.migrate.migration_failed_help"
            values={{ discordLink, githubLink }}
          />
        </Typography>
      </Box>
    );
  }

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h3" align="center" gutterBottom>
        <FormattedMessage id="setup.migrate.migration_required" />
      </Typography>
      <Card variant="outlined">
        <CardContent>
          <Box component="section">
            <Typography paragraph>
              <FormattedMessage
                id="setup.migrate.schema_too_old"
                values={{
                  databaseSchema: <strong>{status.databaseSchema}</strong>,
                  appSchema: <strong>{status.appSchema}</strong>,
                  strong: (chunks: string) => <strong>{chunks}</strong>,
                  code: (chunks: string) => <code>{chunks}</code>,
                }}
              />
            </Typography>

            <Typography variant="h6" align="center" color="text.secondary" sx={{ my: 4 }}>
              <FormattedMessage id="setup.migrate.migration_irreversible_warning" />
            </Typography>

            <Typography paragraph>
              <FormattedMessage
                id="setup.migrate.backup_recommended"
                values={{
                  defaultBackupPath,
                  code: (chunks: string) => <code>{chunks}</code>,
                }}
              />
            </Typography>
          </Box>

          <Divider sx={{ my: 3 }} />

          {maybeMigrationNotes}

          <Box mt={4}>
            <TextField
              fullWidth
              label={<FormattedMessage id="setup.migrate.backup_database_path_leave_empty_to_disable_backup" />}
              name="backupPath"
              defaultValue={backupPath}
              placeholder={intl.formatMessage({
                id: "setup.paths.database_filename_empty_for_default",
              })}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setBackupPath(e.currentTarget.value)
              }
              helperText={<FormattedMessage id="setup.migrate.backup_database_path_leave_empty_to_disable_backup" />}
            />
          </Box>

          <Box sx={{ mt: 5, display: "flex", justifyContent: "center" }}>
            <Button variant="contained" size="large" onClick={() => onMigrate()} sx={{ p: 2, minWidth: 200 }}>
              <FormattedMessage id="setup.migrate.perform_schema_migration" />
            </Button>
          </Box>

          {maybeRenderError()}
        </CardContent>
      </Card>
    </Container>
  );
};

export default Migrate;
