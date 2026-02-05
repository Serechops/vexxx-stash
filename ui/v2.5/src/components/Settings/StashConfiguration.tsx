import { faEllipsisV, faCopy, faCheck, faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import { faDocker } from "@fortawesome/free-brands-svg-icons";
import React, { useState, useCallback } from "react";
import { Alert, Button, Grid, IconButton, Menu, MenuItem, Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Chip, Tooltip, Divider } from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import { Icon } from "src/components/Shared/Icon";
import * as GQL from "src/core/generated-graphql";
import { FolderSelectDialog } from "../Shared/FolderSelect/FolderSelectDialog";
import { BooleanSetting } from "./Inputs";
import { SettingSection } from "./SettingSection";

// Docker path validation error dialog
interface IDockerPathErrorDialogProps {
  open: boolean;
  onClose: () => void;
  validationResult: GQL.ValidateLibraryPathQuery["validateLibraryPath"] | null;
  originalPath: string;
  onSelectAvailablePath?: (path: string) => void;
}

const DockerPathErrorDialog: React.FC<IDockerPathErrorDialogProps> = ({
  open,
  onClose,
  validationResult,
  originalPath,
  onSelectAvailablePath,
}) => {
  const intl = useIntl();
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);

  if (!validationResult) return null;

  const fullDockerCommand = validationResult.dockerMountCommand
    ? `docker run ${validationResult.dockerMountCommand} ...`
    : "";

  const handleCopyCommand = async () => {
    if (fullDockerCommand) {
      await navigator.clipboard.writeText(fullDockerCommand);
      setCopiedCommand(true);
      setTimeout(() => setCopiedCommand(false), 2000);
    }
  };

  const handleCopyPath = async () => {
    if (validationResult.suggestedContainerPath) {
      await navigator.clipboard.writeText(validationResult.suggestedContainerPath);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    }
  };

  const handleSelectPath = (path: string) => {
    if (onSelectAvailablePath) {
      onSelectAvailablePath(path);
      onClose();
    }
  };

  const availablePaths = validationResult.availableContainerPaths ?? [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icon icon={faDocker} />
        <FormattedMessage id="config.general.docker.path_not_found_title" />
      </DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2">
            {intl.formatMessage(
              { id: "config.general.docker.path_not_found_message" },
              { path: originalPath }
            )}
          </Typography>
          {validationResult.isHostPath && (
            <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
              <FormattedMessage id="config.general.docker.host_path_detected" />
            </Typography>
          )}
        </Alert>

        {/* Available Paths Section */}
        {availablePaths.length > 0 && (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                <FormattedMessage id="config.general.docker.available_paths_title" />
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <FormattedMessage id="config.general.docker.available_paths_hint" />
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                {availablePaths.map((path) => (
                  <Chip
                    key={path}
                    label={path}
                    icon={<Icon icon={faFolderOpen} />}
                    onClick={() => handleSelectPath(path)}
                    clickable
                    color="primary"
                    variant="outlined"
                    sx={{ fontFamily: 'monospace' }}
                  />
                ))}
              </Box>
            </Alert>
            <Divider sx={{ my: 2 }}>
              <Typography variant="caption" color="text.secondary">
                <FormattedMessage id="config.general.docker.or_mount_new" />
              </Typography>
            </Divider>
          </>
        )}

        {validationResult.dockerMountCommand && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
              <FormattedMessage id="config.general.docker.mount_instructions" />
            </Typography>
            <Box
              sx={{
                bgcolor: 'grey.900',
                color: 'grey.100',
                p: 2,
                borderRadius: 1,
                fontFamily: 'monospace',
                fontSize: '0.875rem',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 1,
              }}
            >
              <code>{fullDockerCommand}</code>
              <Tooltip title={copiedCommand ? intl.formatMessage({ id: "actions.copied" }) : intl.formatMessage({ id: "actions.copy_to_clipboard" })}>
                <IconButton
                  size="small"
                  onClick={handleCopyCommand}
                  sx={{ color: 'grey.100', flexShrink: 0 }}
                >
                  <Icon icon={copiedCommand ? faCheck : faCopy} />
                </IconButton>
              </Tooltip>
            </Box>
          </>
        )}

        {validationResult.suggestedContainerPath && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
              <FormattedMessage id="config.general.docker.then_add_path" />
            </Typography>
            <Box
              sx={{
                bgcolor: 'success.dark',
                color: 'success.contrastText',
                p: 2,
                borderRadius: 1,
                fontFamily: 'monospace',
                fontSize: '0.875rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
              }}
            >
              <code>{validationResult.suggestedContainerPath}</code>
              <Tooltip title={copiedPath ? intl.formatMessage({ id: "actions.copied" }) : intl.formatMessage({ id: "actions.copy_to_clipboard" })}>
                <IconButton
                  size="small"
                  onClick={handleCopyPath}
                  sx={{ color: 'success.contrastText', flexShrink: 0 }}
                >
                  <Icon icon={copiedPath ? faCheck : faCopy} />
                </IconButton>
              </Tooltip>
            </Box>
          </>
        )}

        <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
          <FormattedMessage id="config.general.docker.restart_required" />
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          <FormattedMessage id="actions.ok" />
        </Button>
      </DialogActions>
    </Dialog>
  );
};

interface IStashProps {
  index: number;
  stash: GQL.StashConfig;
  onSave: (instance: GQL.StashConfig) => void;
  onEdit: () => void;
  onDelete: () => void;
}

const Stash: React.FC<IStashProps> = ({
  index,
  stash,
  onSave,
  onEdit,
  onDelete,
}) => {
  // eslint-disable-next-line
  const handleInput = (key: string, value: any) => {
    const newObj = {
      ...stash,
      [key]: value,
    };
    onSave(newObj);
  };

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const bgcolor = index % 2 === 1 ? 'action.hover' : 'inherit';

  return (
    <Grid container alignItems="center" sx={{ p: 1, bgcolor }}>
      <Grid size={{ xs: 12, md: 7 }}>
        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
          {stash.path}
        </Typography>
      </Grid>
      <Grid size={{ xs: 4, md: 2 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ display: { md: 'none' } }}>
            <FormattedMessage id="videos" />
          </Typography>
          <BooleanSetting
            id={`stash-exclude-video-${index}`}
            checked={!stash.excludeVideo}
            onChange={(v) => handleInput("excludeVideo", !v)}
          />
        </Box>
      </Grid>
      <Grid size={{ xs: 4, md: 2 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ display: { md: 'none' } }}>
            <FormattedMessage id="images" />
          </Typography>
          <BooleanSetting
            id={`stash-exclude-image-${index}`}
            checked={!stash.excludeImage}
            onChange={(v) => handleInput("excludeImage", !v)}
          />
        </Box>
      </Grid>
      <Grid size={{ xs: 4, md: 1 }} display="flex" justifyContent="flex-end">
        <IconButton
          id={`stash-menu-${index}`}
          aria-controls={open ? 'stash-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
          onClick={handleClick}
          size="small"
        >
          <Icon icon={faEllipsisV} />
        </IconButton>
        <Menu
          id="stash-menu"
          anchorEl={anchorEl}
          open={open}
          onClose={handleClose}
          hideBackdrop
          MenuListProps={{
            'aria-labelledby': `stash-menu-${index}`,
          }}
        >
          <MenuItem onClick={() => { handleClose(); onEdit(); }}>
            <FormattedMessage id="actions.edit" />
          </MenuItem>
          <MenuItem onClick={() => { handleClose(); onDelete(); }}>
            <FormattedMessage id="actions.delete" />
          </MenuItem>
        </Menu>
      </Grid>
    </Grid>
  );
};

interface IStashConfigurationProps {
  stashes: GQL.StashConfig[];
  setStashes: (v: GQL.StashConfig[]) => void;
  modalProps?: any;
  isDocker?: boolean;
}

const StashConfiguration: React.FC<IStashConfigurationProps> = ({
  stashes,
  setStashes,
  modalProps,
  isDocker = false,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | undefined>();
  const [dockerErrorDialogOpen, setDockerErrorDialogOpen] = useState(false);
  const [validationResult, setValidationResult] = useState<GQL.ValidateLibraryPathQuery["validateLibraryPath"] | null>(null);
  const [pendingPath, setPendingPath] = useState<string>("");

  // Lazy query for path validation
  const [validatePath] = GQL.useValidateLibraryPathLazyQuery();

  function onEdit(index: number) {
    setEditingIndex(index);
  }

  function onDelete(index: number) {
    setStashes(stashes.filter((v, i) => i !== index));
  }

  function onNew() {
    setIsCreating(true);
  }

  const handleSave = (index: number, stash: GQL.StashConfig) =>
    setStashes(stashes.map((s, i) => (i === index ? stash : s)));

  // Validate path and handle Docker-specific errors
  const handlePathSelected = useCallback(async (
    path: string,
    onSuccess: (path: string) => void
  ) => {
    if (!path) return;

    // If running in Docker, validate the path first
    if (isDocker) {
      try {
        const result = await validatePath({ variables: { path } });
        const validation = result.data?.validateLibraryPath;

        if (validation && !validation.valid) {
          // Show Docker-specific error dialog
          setValidationResult(validation);
          setPendingPath(path);
          setDockerErrorDialogOpen(true);
          return;
        }
      } catch (err) {
        // If validation fails, still try to add the path
        console.warn("Path validation failed:", err);
      }
    }

    // Path is valid or not in Docker mode
    onSuccess(path);
  }, [isDocker, validatePath]);

  const handleCreatePath = useCallback((path: string) => {
    setStashes([
      ...stashes,
      {
        path,
        excludeVideo: false,
        excludeImage: false,
      },
    ]);
    setIsCreating(false);
  }, [stashes, setStashes]);

  const handleEditPath = useCallback((path: string) => {
    if (editingIndex === undefined) return;
    setStashes(
      stashes.map((vv, index) => {
        if (index === editingIndex) {
          return { ...vv, path };
        }
        return vv;
      })
    );
    setEditingIndex(undefined);
  }, [editingIndex, stashes, setStashes]);

  // Handle selecting an available container path from the dialog
  const handleSelectAvailablePath = useCallback((path: string) => {
    // Add the path directly since it's already available in the container
    setStashes([
      ...stashes,
      {
        path,
        excludeVideo: false,
        excludeImage: false,
      },
    ]);
    setIsCreating(false);
    setDockerErrorDialogOpen(false);
  }, [stashes, setStashes]);

  return (
    <>
      {/* Docker path error dialog */}
      <DockerPathErrorDialog
        open={dockerErrorDialogOpen}
        onClose={() => {
          setDockerErrorDialogOpen(false);
          setIsCreating(false);
          setEditingIndex(undefined);
        }}
        validationResult={validationResult}
        originalPath={pendingPath}
        onSelectAvailablePath={handleSelectAvailablePath}
      />

      {isCreating ? (
        <FolderSelectDialog
          onClose={(v) => {
            if (v) {
              handlePathSelected(v, handleCreatePath);
            } else {
              setIsCreating(false);
            }
          }}
          modalProps={modalProps}
        />
      ) : undefined}

      {editingIndex !== undefined ? (
        <FolderSelectDialog
          defaultValue={stashes[editingIndex].path}
          onClose={(v) => {
            if (v) {
              handlePathSelected(v, handleEditPath);
            } else {
              setEditingIndex(undefined);
            }
          }}
          modalProps={modalProps}
        />
      ) : undefined}

      {isDocker && (
        <Alert 
          severity="info" 
          sx={{ mb: 2 }}
          icon={<Icon icon={faDocker} />}
        >
          <Typography variant="body2" fontWeight="bold">
            <FormattedMessage id="config.general.docker.detected" />
          </Typography>
          <Typography variant="body2">
            <FormattedMessage id="config.general.docker.path_hint" />
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 1, fontFamily: 'monospace' }}>
            <FormattedMessage id="config.general.docker.path_example" />
          </Typography>
        </Alert>
      )}

      <div className="content" id="stash-table">
        {stashes.length > 0 && (
          <Grid container sx={{ display: { xs: 'none', md: 'flex' }, borderBottom: 1, borderColor: 'divider', pb: 1, mb: 1 }}>
            <Grid size={{ md: 7 }}>
              <Typography variant="subtitle2"><FormattedMessage id="path" /></Typography>
            </Grid>
            <Grid size={{ md: 2 }}>
              <Typography variant="subtitle2"><FormattedMessage id="videos" /></Typography>
            </Grid>
            <Grid size={{ md: 2 }}>
              <Typography variant="subtitle2"><FormattedMessage id="images" /></Typography>
            </Grid>
          </Grid>
        )}
        {stashes.map((stash, index) => (
          <Stash
            key={stash.path}
            index={index}
            stash={stash}
            onSave={(s) => handleSave(index, s)}
            onEdit={() => onEdit(index)}
            onDelete={() => onDelete(index)}
          />
        ))}
        <Button className="mt-2" variant="contained" color="secondary" onClick={() => onNew()}>
          <FormattedMessage id="actions.add_directory" />
        </Button>
      </div>
    </>
  );
};

interface IStashSetting {
  value: GQL.StashConfigInput[];
  onChange: (v: GQL.StashConfigInput[]) => void;
  modalProps?: any;
  isDocker?: boolean;
}

export const StashSetting: React.FC<IStashSetting> = ({
  value,
  onChange,
  modalProps,
  isDocker,
}) => {
  return (
    <SettingSection
      id="stashes"
      headingID="library"
      subHeadingID="config.general.directory_locations_to_your_content"
    >
      <StashConfiguration
        stashes={value}
        setStashes={(v) => onChange(v)}
        modalProps={modalProps}
        isDocker={isDocker}
      />
    </SettingSection>
  );
};

export default StashConfiguration;
