import React, { useState, useCallback } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Alert,
  Button,
  Card,
  Container,
  TextField,
  InputAdornment,
  IconButton,
  FormControlLabel,
  Checkbox,
  Box,
  Typography,
  CardContent,
  Divider,
  Paper,
  Stepper,
  Step as MuiStep,
  StepLabel,
  List,
  ListItem,
  ListItemText,
} from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import {
  mutateSetup,
  useConfigureUI,
  useSystemStatus,
} from "src/core/StashService";
import { useHistory } from "react-router-dom";
import { useConfigurationContext } from "src/hooks/Config";
import StashConfiguration from "../Settings/StashConfiguration";
import { Icon } from "../Shared/Icon";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { ModalComponent } from "../Shared/Modal";
import { FolderSelectDialog } from "../Shared/FolderSelect/FolderSelectDialog";
import {
  faEllipsisH,
  faExclamationTriangle,
  faQuestionCircle,
} from "@fortawesome/free-solid-svg-icons";
import { releaseNotes } from "src/docs/en/ReleaseNotes";
import { ExternalLink } from "../Shared/ExternalLink";

interface ISetupContextState {
  configuration: GQL.ConfigDataFragment;
  systemStatus: GQL.SystemStatusQuery;

  setupState: Partial<GQL.SetupInput>;
  setupError: string | undefined;

  pathJoin: (...paths: string[]) => string;
  pathDir(path: string): string;

  homeDir: string;
  windows: boolean;
  macApp: boolean;
  homeDirPath: string;
  pwd: string;
  workingDir: string;
}

const SetupStateContext = React.createContext<ISetupContextState | null>(null);

const useSetupContext = () => {
  const context = React.useContext(SetupStateContext);

  if (context === null) {
    throw new Error("useSettings must be used within a SettingsContext");
  }

  return context;
};

const WIZARD_STEPS = ["Welcome", "Configure", "Review", "Done"];

const SetupContext: React.FC<{
  setupState: Partial<GQL.SetupInput>;
  setupError: string | undefined;
  systemStatus: GQL.SystemStatusQuery;
  configuration: GQL.ConfigDataFragment;
  children?: React.ReactNode;
}> = ({ setupState, setupError, systemStatus, configuration, children }) => {
  const status = systemStatus?.systemStatus;

  const windows = status?.os === "windows";
  const pathSep = windows ? "\\" : "/";
  const homeDir = windows ? "%USERPROFILE%" : "$HOME";
  const pwd = windows ? "%CD%" : "$PWD";

  const pathJoin = useCallback(
    (...paths: string[]) => {
      return paths.join(pathSep);
    },
    [pathSep]
  );

  // simply returns everything preceding the last path separator
  function pathDir(path: string) {
    const lastSep = path.lastIndexOf(pathSep);
    if (lastSep === -1) return "";
    return path.slice(0, lastSep);
  }

  const workingDir = status?.workingDir ?? ".";

  // When running Stash.app, the working directory is (usually) set to /.
  // Assume that the user doesn't want to set up in / (it's usually mounted read-only anyway),
  // so in this situation disallow setting up in the working directory.
  const macApp = status?.os === "darwin" && workingDir === "/";

  const homeDirPath = pathJoin(status?.homeDir ?? homeDir, ".stash");

  const state: ISetupContextState = {
    systemStatus,
    configuration,
    windows,
    macApp,
    pathJoin,
    pathDir,
    homeDir,
    homeDirPath,
    pwd,
    workingDir,
    setupState,
    setupError,
  };

  return (
    <SetupStateContext.Provider value={state}>
      {children}
    </SetupStateContext.Provider>
  );
};

interface IWizardStep {
  next: (input?: Partial<GQL.SetupInput>) => void;
  goBack: () => void;
}

const WelcomeSpecificConfig: React.FC<IWizardStep> = ({ next }) => {
  const { systemStatus } = useSetupContext();
  const status = systemStatus?.systemStatus;
  const overrideConfig = status?.configPath;

  function onNext() {
    next({ configLocation: overrideConfig! });
  }

  return (
    <>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          <FormattedMessage id="setup.welcome_to_stash" />
        </Typography>
        <Typography variant="subtitle1" align="center" gutterBottom>
          <FormattedMessage id="setup.welcome_specific_config.unable_to_locate_specified_config" />
        </Typography>
        <Typography paragraph>
          <FormattedMessage
            id="setup.welcome_specific_config.config_path"
            values={{
              path: overrideConfig,
              code: (chunks: string) => <code>{chunks}</code>,
            }}
          />
        </Typography>
        <Typography paragraph>
          <FormattedMessage id="setup.welcome_specific_config.next_step" />
        </Typography>
      </Box>

      <Box sx={{ mt: 5, display: "flex", justifyContent: "center" }}>
        <Button variant="contained" size="large" onClick={() => onNext()} sx={{ minWidth: 160 }}>
          <FormattedMessage id="actions.next_action" />
        </Button>
      </Box>
    </>
  );
};

const DefaultWelcomeStep: React.FC<IWizardStep> = ({ next }) => {
  const { pathJoin, homeDir, macApp, homeDirPath, pwd, workingDir } =
    useSetupContext();

  const fallbackStashDir = pathJoin(homeDir, ".stash");
  const fallbackConfigPath = pathJoin(fallbackStashDir, "config.yml");

  function onConfigLocationChosen(inWorkingDir: boolean) {
    const configLocation = inWorkingDir ? "config.yml" : "";
    next({ configLocation });
  }

  return (
    <>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          <FormattedMessage id="setup.welcome_to_stash" />
        </Typography>
        <Typography variant="subtitle1" align="center" gutterBottom>
          <FormattedMessage id="setup.welcome.unable_to_locate_config" />
        </Typography>
        <Typography paragraph>
          <FormattedMessage
            id="setup.welcome.config_path_logic_explained"
            values={{
              code: (chunks: string) => <code>{chunks}</code>,
              fallback_path: fallbackConfigPath,
            }}
          />
        </Typography>
        <Alert severity="info" sx={{ textAlign: "center", mb: 2 }}>
          <FormattedMessage
            id="setup.welcome.unexpected_explained"
            values={{
              code: (chunks: string) => <code>{chunks}</code>,
            }}
          />
        </Alert>
        <Typography paragraph>
          <FormattedMessage id="setup.welcome.next_step" />
        </Typography>
      </Box>

      <Box sx={{ mt: 4 }}>
        <Typography variant="h6" align="center" gutterBottom sx={{ mb: 2 }}>
          <FormattedMessage id="setup.welcome.store_stash_config" />
        </Typography>

        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <Paper
            variant="outlined"
            onClick={() => onConfigLocationChosen(false)}
            sx={{
              p: 3,
              cursor: "pointer",
              textAlign: "center",
              transition: "border-color 0.2s, background-color 0.2s",
              "&:hover": {
                borderColor: "primary.main",
                bgcolor: "action.hover",
              },
            }}
          >
            <Typography variant="body1" gutterBottom>
              <FormattedMessage
                id="setup.welcome.in_current_stash_directory"
                values={{
                  code: (chunks: string) => <code>{chunks}</code>,
                  path: fallbackStashDir,
                }}
              />
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
            >
              {homeDirPath}
            </Typography>
          </Paper>

          <Paper
            variant="outlined"
            onClick={!macApp ? () => onConfigLocationChosen(true) : undefined}
            sx={{
              p: 3,
              textAlign: "center",
              cursor: macApp ? "default" : "pointer",
              opacity: macApp ? 0.55 : 1,
              transition: "border-color 0.2s, background-color 0.2s",
              ...(!macApp && {
                "&:hover": {
                  borderColor: "primary.main",
                  bgcolor: "action.hover",
                },
              }),
            }}
          >
            {macApp ? (
              <>
                <Typography variant="body1" gutterBottom>
                  <FormattedMessage
                    id="setup.welcome.in_the_current_working_directory_disabled"
                    values={{
                      code: (chunks: string) => <code>{chunks}</code>,
                      path: pwd,
                    }}
                  />
                </Typography>
                <Typography variant="body2" color="error.main">
                  <FormattedMessage
                    id="setup.welcome.in_the_current_working_directory_disabled_macos"
                    values={{
                      code: (chunks: string) => <code>{chunks}</code>,
                      br: () => <br />,
                    }}
                  />
                </Typography>
              </>
            ) : (
              <>
                <Typography variant="body1" gutterBottom>
                  <FormattedMessage
                    id="setup.welcome.in_the_current_working_directory"
                    values={{
                      code: (chunks: string) => <code>{chunks}</code>,
                      path: pwd,
                    }}
                  />
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
                >
                  {workingDir}
                </Typography>
              </>
            )}
          </Paper>
        </Box>
      </Box>
    </>
  );
};

const WelcomeStep: React.FC<IWizardStep> = (props) => {
  const { systemStatus } = useSetupContext();
  const status = systemStatus?.systemStatus;
  const overrideConfig = status?.configPath;

  return overrideConfig ? (
    <WelcomeSpecificConfig {...props} />
  ) : (
    <DefaultWelcomeStep {...props} />
  );
};

const StashAlert: React.FC<{ close: (confirm: boolean) => void }> = ({
  close,
}) => {
  const intl = useIntl();

  return (
    <ModalComponent
      show
      icon={faExclamationTriangle}
      accept={{
        text: intl.formatMessage({ id: "actions.confirm" }),
        variant: "danger",
        onClick: () => close(true),
      }}
      cancel={{ onClick: () => close(false) }}
    >
      <p>
        <FormattedMessage id="setup.paths.stash_alert" />
      </p>
    </ModalComponent>
  );
};

const DatabaseSection: React.FC<{
  databaseFile: string;
  setDatabaseFile: React.Dispatch<React.SetStateAction<string>>;
}> = ({ databaseFile, setDatabaseFile }) => {
  const intl = useIntl();

  return (
    <Paper id="database" variant="outlined" sx={{ p: 2.5, mb: 3 }}>
      <Typography variant="h6" gutterBottom fontWeight={600}>
        <FormattedMessage id="setup.paths.where_can_stash_store_its_database" />
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        <FormattedMessage
          id="setup.paths.where_can_stash_store_its_database_description"
          values={{
            code: (chunks: string) => <code>{chunks}</code>,
          }}
        />
        <br />
        <FormattedMessage
          id="setup.paths.where_can_stash_store_its_database_warning"
          values={{
            strong: (chunks: string) => <strong>{chunks}</strong>,
          }}
        />
      </Typography>
      <TextField
        fullWidth
        defaultValue={databaseFile}
        placeholder={intl.formatMessage({
          id: "setup.paths.database_filename_empty_for_default",
        })}
        onChange={(e) => setDatabaseFile(e.currentTarget.value)}
      />
    </Paper>
  );
};

const DirectorySelector: React.FC<{
  value: string;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  placeholder: string;
  disabled?: boolean;
}> = ({ value, setValue, placeholder, disabled = false }) => {
  const [showSelectDialog, setShowSelectDialog] = useState(false);

  function onSelectClosed(dir?: string) {
    if (dir) {
      setValue(dir);
    }
    setShowSelectDialog(false);
  }

  return (
    <>
      {showSelectDialog ? (
        <FolderSelectDialog onClose={onSelectClosed} />
      ) : null}
      <TextField
        fullWidth
        value={disabled ? "" : value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.currentTarget.value)}
        disabled={disabled}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                onClick={() => setShowSelectDialog(true)}
                disabled={disabled}
                edge="end"
              >
                <Icon icon={faEllipsisH} />
              </IconButton>
            </InputAdornment>
          )
        }}
      />
    </>
  );
};

const GeneratedSection: React.FC<{
  generatedLocation: string;
  setGeneratedLocation: React.Dispatch<React.SetStateAction<string>>;
}> = ({ generatedLocation, setGeneratedLocation }) => {
  const intl = useIntl();

  return (
    <Paper id="generated" variant="outlined" sx={{ p: 2.5, mb: 3 }}>
      <Typography variant="h6" gutterBottom fontWeight={600}>
        <FormattedMessage id="setup.paths.where_can_stash_store_its_generated_content" />
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        <FormattedMessage
          id="setup.paths.where_can_stash_store_its_generated_content_description"
          values={{
            code: (chunks: string) => <code>{chunks}</code>,
          }}
        />
      </Typography>
      <DirectorySelector
        value={generatedLocation}
        setValue={setGeneratedLocation}
        placeholder={intl.formatMessage({
          id: "setup.paths.path_to_generated_directory_empty_for_default",
        })}
      />
    </Paper>
  );
};

const CacheSection: React.FC<{
  cacheLocation: string;
  setCacheLocation: React.Dispatch<React.SetStateAction<string>>;
}> = ({ cacheLocation, setCacheLocation }) => {
  const intl = useIntl();

  return (
    <Paper id="cache" variant="outlined" sx={{ p: 2.5, mb: 3 }}>
      <Typography variant="h6" gutterBottom fontWeight={600}>
        <FormattedMessage id="setup.paths.where_can_stash_store_cache_files" />
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        <FormattedMessage
          id="setup.paths.where_can_stash_store_cache_files_description"
          values={{
            code: (chunks: string) => <code>{chunks}</code>,
          }}
        />
      </Typography>
      <DirectorySelector
        value={cacheLocation}
        setValue={setCacheLocation}
        placeholder={intl.formatMessage({
          id: "setup.paths.path_to_cache_directory_empty_for_default",
        })}
      />
    </Paper>
  );
};

const BlobsSection: React.FC<{
  blobsLocation: string;
  setBlobsLocation: React.Dispatch<React.SetStateAction<string>>;
  storeBlobsInDatabase: boolean;
  setStoreBlobsInDatabase: React.Dispatch<React.SetStateAction<boolean>>;
}> = ({
  blobsLocation,
  setBlobsLocation,
  storeBlobsInDatabase,
  setStoreBlobsInDatabase,
}) => {
    const intl = useIntl();

    return (
      <Paper id="blobs" variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="h6" gutterBottom fontWeight={600}>
          <FormattedMessage id="setup.paths.where_can_stash_store_blobs" />
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          <FormattedMessage
            id="setup.paths.where_can_stash_store_blobs_description"
            values={{
              code: (chunks: string) => <code>{chunks}</code>,
            }}
          />
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          <FormattedMessage
            id="setup.paths.where_can_stash_store_blobs_description_addendum"
            values={{
              code: (chunks: string) => <code>{chunks}</code>,
              strong: (chunks: string) => <strong>{chunks}</strong>,
            }}
          />
        </Typography>

        <Box mb={2}>
          <FormControlLabel
            control={
              <Checkbox
                checked={storeBlobsInDatabase}
                onChange={() => setStoreBlobsInDatabase(!storeBlobsInDatabase)}
              />
            }
            label={intl.formatMessage({
              id: "setup.paths.store_blobs_in_database",
            })}
          />
        </Box>

        <Box>
          <DirectorySelector
            value={blobsLocation}
            setValue={setBlobsLocation}
            placeholder={intl.formatMessage({
              id: "setup.paths.path_to_blobs_directory_empty_for_default",
            })}
            disabled={storeBlobsInDatabase}
          />
        </Box>
      </Paper>
    );
  };

const SetPathsStep: React.FC<IWizardStep> = ({ goBack, next }) => {
  const { configuration, setupState } = useSetupContext();

  const [showStashAlert, setShowStashAlert] = useState(false);

  const [stashes, setStashes] = useState<GQL.StashConfig[]>(
    setupState.stashes ?? []
  );
  const [sfwContentMode, setSfwContentMode] = useState(
    setupState.sfwContentMode ?? false
  );

  const [databaseFile, setDatabaseFile] = useState(
    setupState.databaseFile ?? ""
  );
  const [generatedLocation, setGeneratedLocation] = useState(
    setupState.generatedLocation ?? ""
  );
  const [cacheLocation, setCacheLocation] = useState(
    setupState.cacheLocation ?? ""
  );
  const [storeBlobsInDatabase, setStoreBlobsInDatabase] = useState(
    setupState.storeBlobsInDatabase ?? false
  );
  const [blobsLocation, setBlobsLocation] = useState(
    setupState.blobsLocation ?? ""
  );

  const overrideDatabase = configuration?.general.databasePath;
  const overrideGenerated = configuration?.general.generatedPath;
  const overrideCache = configuration?.general.cachePath;
  const overrideBlobs = configuration?.general.blobsPath;

  function preNext() {
    if (stashes.length === 0) {
      setShowStashAlert(true);
    } else {
      onNext();
    }
  }

  function onNext() {
    const input: Partial<GQL.SetupInput> = {
      stashes,
      databaseFile,
      generatedLocation,
      cacheLocation,
      blobsLocation: storeBlobsInDatabase ? "" : blobsLocation,
      storeBlobsInDatabase,
      sfwContentMode,
    };
    next(input);
  }

  return (
    <>
      {showStashAlert ? (
        <StashAlert
          close={(confirm) => {
            setShowStashAlert(false);
            if (confirm) {
              onNext();
            }
          }}
        />
      ) : null}
      <Box mb={4}>
        <Typography variant="h4" gutterBottom>
          <FormattedMessage id="setup.paths.set_up_your_paths" />
        </Typography>
        <Typography>
          <FormattedMessage id="setup.paths.description" />
        </Typography>
      </Box>
      <Box>
        <Box id="stashes" mb={3}>
          <Typography variant="h5" gutterBottom>
            <FormattedMessage id="setup.paths.where_is_your_porn_located" />
          </Typography>
          <Typography paragraph>
            <FormattedMessage id="setup.paths.where_is_your_porn_located_description" />
          </Typography>
          <Card variant="outlined">
            <StashConfiguration
              stashes={stashes}
              setStashes={(s) => setStashes(s)}
            />
          </Card>
        </Box>
        <Box id="sfw_content" mb={3}>
          <Typography variant="h5" gutterBottom>
            <FormattedMessage id="setup.paths.sfw_content_settings" />
          </Typography>
          <Typography paragraph>
            <FormattedMessage id="setup.paths.sfw_content_settings_description" />
          </Typography>
          <Card variant="outlined">
            <Box p={2}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={sfwContentMode}
                    onChange={() => setSfwContentMode(!sfwContentMode)}
                  />
                }
                label={<FormattedMessage id="setup.paths.use_sfw_content_mode" />}
              />
            </Box>
          </Card>
        </Box>
        {overrideDatabase ? null : (
          <DatabaseSection
            databaseFile={databaseFile}
            setDatabaseFile={setDatabaseFile}
          />
        )}
        {overrideGenerated ? null : (
          <GeneratedSection
            generatedLocation={generatedLocation}
            setGeneratedLocation={setGeneratedLocation}
          />
        )}
        {overrideCache ? null : (
          <CacheSection
            cacheLocation={cacheLocation}
            setCacheLocation={setCacheLocation}
          />
        )}
        {overrideBlobs ? null : (
          <BlobsSection
            blobsLocation={blobsLocation}
            setBlobsLocation={setBlobsLocation}
            storeBlobsInDatabase={storeBlobsInDatabase}
            setStoreBlobsInDatabase={setStoreBlobsInDatabase}
          />
        )}
      </Box>
      <Box sx={{ mt: 5, display: "flex", justifyContent: "center", gap: 2 }}>
        <Button variant="contained" color="secondary" size="large" onClick={() => goBack()} sx={{ minWidth: 160 }}>
          <FormattedMessage id="actions.previous_action" />
        </Button>
        <Button variant="contained" color="primary" size="large" onClick={() => preNext()} sx={{ minWidth: 160 }}>
          <FormattedMessage id="actions.next_action" />
        </Button>
      </Box>
    </>
  );
};

const StashExclusions: React.FC<{ stash: GQL.StashConfig }> = ({ stash }) => {
  if (!stash.excludeImage && !stash.excludeVideo) {
    return null;
  }

  const excludes = [];
  if (stash.excludeVideo) {
    excludes.push("videos");
  }
  if (stash.excludeImage) {
    excludes.push("images");
  }

  return <span>{`(excludes ${excludes.join(" and ")})`}</span>;
};

const ConfirmStep: React.FC<IWizardStep> = ({ goBack, next }) => {
  const {
    configuration,
    pathDir,
    pathJoin,
    setupState,
    homeDirPath,
    workingDir,
  } = useSetupContext();

  // if unset, means use homeDirPath
  const cfgFile = setupState.configLocation
    ? pathJoin(workingDir, setupState.configLocation)
    : pathJoin(homeDirPath, "config.yml");
  const cfgDir = pathDir(cfgFile);
  const stashes = setupState.stashes ?? [];
  const {
    databaseFile,
    generatedLocation,
    cacheLocation,
    blobsLocation,
    storeBlobsInDatabase,
  } = setupState;

  const overrideDatabase = configuration?.general.databasePath;
  const overrideGenerated = configuration?.general.generatedPath;
  const overrideCache = configuration?.general.cachePath;
  const overrideBlobs = configuration?.general.blobsPath;

  function joinCfgDir(path: string) {
    if (cfgDir) {
      return pathJoin(cfgDir, path);
    } else {
      return path;
    }
  }

  return (
    <>
      <Box mb={4}>
        <Typography variant="h4" gutterBottom>
          <FormattedMessage id="setup.confirm.nearly_there" />
        </Typography>
        <Typography>
          <FormattedMessage id="setup.confirm.almost_ready" />
        </Typography>
      </Box>

      <Box>
        <Box mb={2}>
          <Typography variant="h6"><FormattedMessage id="setup.confirm.configuration_file_location" /></Typography>
          <Box ml={2}><code>{cfgFile}</code></Box>
        </Box>

        <Box mb={2}>
          <Typography variant="h6" gutterBottom><FormattedMessage id="setup.confirm.stash_library_directories" /></Typography>
          <List dense disablePadding sx={{ pl: 1 }}>
            {stashes.map((s) => (
              <ListItem key={s.path} sx={{ px: 0 }}>
                <ListItemText
                  primary={
                    <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                      {s.path}
                    </Typography>
                  }
                  secondary={<StashExclusions stash={s} />}
                />
              </ListItem>
            ))}
          </List>
        </Box>

        {!overrideDatabase && (
          <Box mb={2}>
            <Typography variant="h6" gutterBottom><FormattedMessage id="setup.confirm.database_file_path" /></Typography>
            <Typography variant="body2" sx={{ pl: 1, fontFamily: "monospace", wordBreak: "break-all" }}>{databaseFile || joinCfgDir("stash-go.sqlite")}</Typography>
          </Box>
        )}
        {!overrideGenerated && (
          <Box mb={2}>
            <Typography variant="h6" gutterBottom><FormattedMessage id="setup.confirm.generated_directory" /></Typography>
            <Typography variant="body2" sx={{ pl: 1, fontFamily: "monospace", wordBreak: "break-all" }}>{generatedLocation || joinCfgDir("generated")}</Typography>
          </Box>
        )}
        {!overrideCache && (
          <Box mb={2}>
            <Typography variant="h6" gutterBottom><FormattedMessage id="setup.confirm.cache_directory" /></Typography>
            <Typography variant="body2" sx={{ pl: 1, fontFamily: "monospace", wordBreak: "break-all" }}>{cacheLocation || joinCfgDir("cache")}</Typography>
          </Box>
        )}
        {!overrideBlobs && (
          <Box mb={2}>
            <Typography variant="h6" gutterBottom><FormattedMessage id="setup.confirm.blobs_directory" /></Typography>
            <Typography variant="body2" sx={{ pl: 1, fontFamily: "monospace", wordBreak: "break-all" }}>
              {storeBlobsInDatabase ? (
                <FormattedMessage id="setup.confirm.blobs_use_database" />
              ) : (
                blobsLocation || joinCfgDir("blobs")
              )}
            </Typography>
          </Box>
        )}
      </Box>

      <Box sx={{ mt: 5, display: "flex", justifyContent: "center", gap: 2 }}>
        <Button variant="contained" color="secondary" size="large" onClick={() => goBack()} sx={{ minWidth: 160 }}>
          <FormattedMessage id="actions.previous_action" />
        </Button>
        <Button variant="contained" color="success" size="large" onClick={() => next()} sx={{ minWidth: 160 }}>
          <FormattedMessage id="actions.confirm" />
        </Button>
      </Box>
    </>
  );
};

const DiscordLink = (
  <ExternalLink href="https://discord.gg/2TsNFKt">Discord</ExternalLink>
);
const GithubLink = (
  <ExternalLink href="https://github.com/stashapp/stash/issues">
    <FormattedMessage id="setup.github_repository" />
  </ExternalLink>
);

const ErrorStep: React.FC<{ error: string; goBack: () => void }> = ({
  error,
  goBack,
}) => {
  return (
    <>
      <Box mb={4}>
        <Typography variant="h4" gutterBottom>
          <FormattedMessage id="setup.errors.something_went_wrong" />
        </Typography>
        <Alert severity="error" sx={{ mb: 2 }}>
          <FormattedMessage
            id="setup.errors.something_went_wrong_while_setting_up_your_system"
            values={{ error: <Box component="pre" sx={{ mt: 1, mb: 0, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{error}</Box> }}
          />
        </Alert>
        <Typography paragraph>
          <FormattedMessage
            id="setup.errors.something_went_wrong_description"
            values={{ githubLink: GithubLink, discordLink: DiscordLink }}
          />
        </Typography>
      </Box>
      <Box sx={{ mt: 5, display: "flex", justifyContent: "center" }}>
        <Button variant="contained" color="secondary" size="large" onClick={goBack} sx={{ minWidth: 160 }}>
          <FormattedMessage id="actions.previous_action" />
        </Button>
      </Box>
    </>
  );
};

const SuccessStep: React.FC<{}> = () => {
  const intl = useIntl();
  const history = useHistory();

  const [mutateDownloadFFMpeg] = GQL.useDownloadFfMpegMutation();

  const [downloadFFmpeg, setDownloadFFmpeg] = useState(true);

  const { systemStatus } = useSetupContext();
  const status = systemStatus?.systemStatus;

  function onFinishClick() {
    if ((!status?.ffmpegPath || !status?.ffprobePath) && downloadFFmpeg) {
      mutateDownloadFFMpeg();
    }

    history.push("/settings?tab=library");
  }

  return (
    <>
      <Box mb={4}>
        <Typography variant="h4" color="success.main" gutterBottom>
          <FormattedMessage id="setup.success.your_system_has_been_created" />
        </Typography>
        <Typography paragraph>
          <FormattedMessage id="setup.success.next_config_step_one" />
        </Typography>
        <Typography paragraph>
          <FormattedMessage
            id="setup.success.next_config_step_two"
            values={{
              code: (chunks: string) => <code>{chunks}</code>,
              localized_task: intl.formatMessage({
                id: "config.categories.tasks",
              }),
              localized_scan: intl.formatMessage({ id: "actions.scan" }),
            }}
          />
        </Typography>
        {!status?.ffmpegPath || !status?.ffprobePath ? (
          <>
            <Alert severity="warning" sx={{ textAlign: "center", mb: 2 }}>
              <FormattedMessage
                id="setup.success.missing_ffmpeg"
                values={{
                  code: (chunks: string) => <code>{chunks}</code>,
                }}
              />
            </Alert>
            <Box mb={2}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={downloadFFmpeg}
                    onChange={() => setDownloadFFmpeg(!downloadFFmpeg)}
                  />
                }
                label={intl.formatMessage({
                  id: "setup.success.download_ffmpeg",
                })}
              />
            </Box>
          </>
        ) : null}
      </Box>
      <Box mb={4}>
        <Typography variant="h5" gutterBottom>
          <FormattedMessage id="setup.success.getting_help" />
        </Typography>
        <Typography paragraph>
          <FormattedMessage
            id="setup.success.in_app_manual_explained"
            values={{ icon: <Icon icon={faQuestionCircle} /> }}
          />
        </Typography>
        <Typography paragraph>
          <FormattedMessage
            id="setup.success.help_links"
            values={{ discordLink: DiscordLink, githubLink: GithubLink }}
          />
        </Typography>
      </Box>
      <Box mb={4}>
        <Typography variant="h5" gutterBottom>
          <FormattedMessage id="setup.success.support_us" />
        </Typography>
        <Typography paragraph>
          <FormattedMessage
            id="setup.success.open_collective"
            values={{
              open_collective_link: (
                <ExternalLink href="https://www.patreon.com/c/Creat1veB1te">
                  Patreon
                </ExternalLink>
              ),
            }}
          />
        </Typography>
        <Typography paragraph>
          <FormattedMessage id="setup.success.welcome_contrib" />
        </Typography>
      </Box>
      <Box mb={4}>
        <Typography variant="h6" align="center" gutterBottom>
          <FormattedMessage id="setup.success.thanks_for_trying_stash" />
        </Typography>
      </Box>
      <Box sx={{ mt: 5, display: "flex", justifyContent: "center" }}>
        <Button variant="contained" color="success" size="large" onClick={() => onFinishClick()} sx={{ minWidth: 160 }}>
          <FormattedMessage id="actions.finish" />
        </Button>
      </Box>
    </>
  );
};

const FinishStep: React.FC<IWizardStep> = ({ goBack }) => {
  const { setupError } = useSetupContext();

  if (setupError !== undefined) {
    return <ErrorStep error={setupError} goBack={goBack} />;
  }

  return <SuccessStep />;
};

export const Setup: React.FC = () => {
  const intl = useIntl();
  const { configuration } = useConfigurationContext();

  const [saveUI] = useConfigureUI();

  const {
    data: systemStatus,
    loading: statusLoading,
    error: statusError,
  } = useSystemStatus();

  const [step, setStep] = useState(0);
  const [setupInput, setSetupInput] = useState<Partial<GQL.SetupInput>>({});
  const [creating, setCreating] = useState(false);
  const [setupError, setSetupError] = useState<string | undefined>(undefined);

  const history = useHistory();

  const steps: React.FC<IWizardStep>[] = [
    WelcomeStep,
    SetPathsStep,
    ConfirmStep,
    FinishStep,
  ];
  const CurrentStep = steps[step];

  async function createSystem() {
    try {
      setCreating(true);
      setSetupError(undefined);
      await mutateSetup(setupInput as GQL.SetupInput);
      // Set lastNoteSeen to hide release notes dialog
      await saveUI({
        variables: {
          input: {
            ...configuration?.ui,
            lastNoteSeen: releaseNotes[0].date,
          },
        },
      });
    } catch (e) {
      if (e instanceof Error && e.message) {
        setSetupError(e.message);
      } else {
        setSetupError(String(e));
      }
    } finally {
      setCreating(false);
      setStep(step + 1);
    }
  }

  function next(input?: Partial<GQL.SetupInput>) {
    setSetupInput({ ...setupInput, ...input });

    if (CurrentStep === ConfirmStep) {
      // create the system
      createSystem();
    } else {
      setStep(step + 1);
    }
  }

  function goBack() {
    if (CurrentStep === FinishStep) {
      // go back to the step before ConfirmStep
      setStep(step - 2);
    } else {
      setStep(step - 1);
    }
  }

  if (statusLoading) {
    return <LoadingIndicator />;
  }

  if (
    step === 0 &&
    systemStatus &&
    systemStatus.systemStatus.status !== GQL.SystemStatusEnum.Setup
  ) {
    // redirect to main page
    history.push("/");
    return <LoadingIndicator />;
  }

  if (statusError) {
    return (
      <Container maxWidth="md" sx={{ mt: 4 }}>
        <Alert severity="error">
          <FormattedMessage
            id="setup.errors.unable_to_retrieve_system_status"
            values={{ error: statusError.message }}
          />
        </Alert>
      </Container>
    );
  }

  if (!configuration || !systemStatus) {
    return (
      <Container maxWidth="md" sx={{ mt: 4 }}>
        <Alert severity="error">
          <FormattedMessage
            id="setup.errors.unable_to_retrieve_configuration"
            values={{ error: "configuration or systemStatus === undefined" }}
          />
        </Alert>
      </Container>
    );
  }

  return (
    <SetupContext
      setupState={setupInput}
      setupError={setupError}
      configuration={configuration}
      systemStatus={systemStatus}
    >
      <Container maxWidth="md" sx={{ mt: 4, mb: 4, '& #blobs > div': { mb: '1rem', mt: 0 } }}>
        <Typography variant="h3" align="center" gutterBottom>
          <FormattedMessage id="setup.stash_setup_wizard" />
        </Typography>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {WIZARD_STEPS.map((label) => (
            <MuiStep key={label}>
              <StepLabel>{label}</StepLabel>
            </MuiStep>
          ))}
        </Stepper>
        <Card variant="outlined">
          <CardContent>
            {creating ? (
              <LoadingIndicator
                message={intl.formatMessage({
                  id: "setup.creating.creating_your_system",
                })}
              />
            ) : (
              <CurrentStep next={next} goBack={goBack} />
            )}
          </CardContent>
        </Card>
      </Container>
    </SetupContext>
  );
};

export default Setup;
