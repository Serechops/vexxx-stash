import React, { useState } from "react";
import { ModalComponent } from "./Modal";
import { useToast } from "src/hooks/Toast";
import { useIntl } from "react-intl";
import { faSignOutAlt } from "@fortawesome/free-solid-svg-icons";
import { Box, Typography } from "@mui/material";
import Grid from "@mui/material/Grid";
import { mutateSceneAssignFile } from "src/core/StashService";
import { Scene, SceneSelect } from "src/components/Scenes/SceneSelect";

interface IFile {
  id: string;
  path: string;
}

interface IReassignFilesDialogProps {
  selected: IFile;
  onClose: () => void;
}

export const ReassignFilesDialog: React.FC<IReassignFilesDialogProps> = (
  props: IReassignFilesDialogProps
) => {
  const [scenes, setScenes] = useState<Scene[]>([]);

  const intl = useIntl();
  const singularEntity = intl.formatMessage({ id: "file" });
  const pluralEntity = intl.formatMessage({ id: "files" });

  const header = intl.formatMessage(
    { id: "dialogs.reassign_entity_title" },
    { count: 1, singularEntity, pluralEntity }
  );

  const toastMessage = intl.formatMessage(
    { id: "toast.reassign_past_tense" },
    { count: 1, singularEntity, pluralEntity }
  );

  const Toast = useToast();

  // Network state
  const [reassigning, setReassigning] = useState(false);

  async function onAccept() {
    if (!scenes.length) {
      return;
    }

    setReassigning(true);
    try {
      await mutateSceneAssignFile(scenes[0].id, props.selected.id);
      Toast.success(toastMessage);
      props.onClose();
    } catch (e) {
      Toast.error(e);
      props.onClose();
    }
    setReassigning(false);
  }

  return (
    <ModalComponent
      show
      icon={faSignOutAlt}
      header={header}
      accept={{
        onClick: onAccept,
        text: intl.formatMessage({ id: "actions.reassign" }),
      }}
      cancel={{
        onClick: () => props.onClose(),
        text: intl.formatMessage({ id: "actions.cancel" }),
        variant: "secondary",
      }}
      isRunning={reassigning}
    >
      <Box>
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, sm: 3 }}>
            <Typography variant="body2" fontWeight="bold">
              {intl.formatMessage({
                id: "dialogs.reassign_files.destination",
              })}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 9 }}>
            <SceneSelect
              values={scenes}
              onSelect={(items) => setScenes(items)}
            />
          </Grid>
        </Grid>
      </Box>
    </ModalComponent>
  );
};
