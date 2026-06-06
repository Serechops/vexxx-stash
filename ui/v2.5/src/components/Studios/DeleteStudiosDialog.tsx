import React, { useMemo, useState } from "react";
import { Box, FormControlLabel, Checkbox } from "@mui/material";
import { useScenesDestroy, useStudiosDestroy } from "src/core/StashService";
import * as GQL from "src/core/generated-graphql";
import { ModalComponent } from "src/components/Shared/Modal";
import { useToast } from "src/hooks/Toast";
import { useConfigurationContext } from "src/hooks/Config";
import { FormattedMessage, useIntl } from "react-intl";
import DeleteIcon from "@mui/icons-material/Delete";
import { objectPath } from "src/core/files";

interface IDeleteStudiosDialogProps {
  selected: GQL.StudioDataFragment[];
  onClose: (confirmed: boolean) => void;
}

export const DeleteStudiosDialog: React.FC<IDeleteStudiosDialogProps> = (
  props: IDeleteStudiosDialogProps
) => {
  const intl = useIntl();
  const Toast = useToast();
  const { configuration } = useConfigurationContext();
  const count = props.selected.length;

  const [cascadeDelete, setCascadeDelete] = useState<boolean>(false);
  const [deleteFile, setDeleteFile] = useState<boolean>(
    configuration?.defaults.deleteFile ?? false
  );
  const [deleteGenerated, setDeleteGenerated] = useState<boolean>(
    configuration?.defaults.deleteGenerated ?? true
  );

  // Network state
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: scenesData } = GQL.useFindScenesQuery({
    variables: {
      filter: {
        per_page: -1,
      },
      scene_filter: {
        studios: {
          value: props.selected.map((s) => s.id),
          modifier: GQL.CriterionModifier.Includes,
        },
      },
    },
  });

  const sceneIds = useMemo(() => {
    return scenesData?.findScenes?.scenes.map((s) => s.id) ?? [];
  }, [scenesData]);

  const [destroyScenes] = useScenesDestroy({
    ids: sceneIds,
    delete_file: deleteFile,
    delete_generated: deleteGenerated,
  });

  const [destroyStudios] = useStudiosDestroy({
    ids: props.selected.map((s) => s.id),
  });

  async function onDelete() {
    setIsDeleting(true);
    try {
      if (cascadeDelete && sceneIds.length > 0) {
        await destroyScenes();
        Toast.success(
          intl.formatMessage(
            { id: "toast.delete_past_tense" },
            {
              count: sceneIds.length,
              singularEntity: intl.formatMessage({ id: "scene" }),
              pluralEntity: intl.formatMessage({ id: "scenes" }),
            }
          )
        );
      }
      await destroyStudios();
      Toast.success(
        intl.formatMessage(
          { id: "toast.delete_past_tense" },
          {
            count,
            singularEntity: intl.formatMessage({ id: "studio" }),
            pluralEntity: intl.formatMessage({ id: "studios" }),
          }
        )
      );
      props.onClose(true);
    } catch (e) {
      Toast.error(e);
      props.onClose(false);
    }
    setIsDeleting(false);
  }

  function funscriptPath(sp: string) {
    const extIndex = sp.lastIndexOf(".");
    if (extIndex !== -1) {
      return sp.substring(0, extIndex + 1) + "funscript";
    }

    return sp;
  }

  function maybeRenderDeleteFileAlert() {
    if (!deleteFile || !scenesData?.findScenes) {
      return;
    }

    const deletedFiles: string[] = [];

    scenesData.findScenes.scenes.forEach((s) => {
      const paths = s.files.map((f) => f.path);
      deletedFiles.push(...paths);
      if (s.interactive && s.files.length) {
        deletedFiles.push(funscriptPath(objectPath(s)));
      }
    });

    const deleteTrashPath = configuration?.general.deleteTrashPath;
    const deleteAlertId = deleteTrashPath
      ? "dialogs.delete_alert_to_trash"
      : "dialogs.delete_alert";

    return (
      <div className="delete-dialog alert alert-danger text-break mb-3">
        <p className="font-bold">
          <FormattedMessage
            values={{
              count: deletedFiles.length,
              singularEntity: intl.formatMessage({ id: "file" }),
              pluralEntity: intl.formatMessage({ id: "files" }),
            }}
            id={deleteAlertId}
          />
        </p>
        <ul className="pl-3 mb-0">
          {deletedFiles.slice(0, 5).map((s) => (
            <li key={s}>{s}</li>
          ))}
          {deletedFiles.length > 5 && (
            <FormattedMessage
              values={{
                count: deletedFiles.length - 5,
                singularEntity: intl.formatMessage({ id: "file" }),
                pluralEntity: intl.formatMessage({ id: "files" }),
              }}
              id="dialogs.delete_object_overflow"
            />
          )}
        </ul>
      </div>
    );
  }

  return (
    <ModalComponent
      show
      icon={<DeleteIcon />}
      header={intl.formatMessage(
        { id: "dialogs.delete_object_title" },
        {
          count,
          singularEntity: intl.formatMessage({ id: "studio" }),
          pluralEntity: intl.formatMessage({ id: "studios" }),
        }
      )}
      accept={{
        variant: "danger",
        onClick: onDelete,
        text: intl.formatMessage({ id: "actions.delete" }),
      }}
      cancel={{
        onClick: () => props.onClose(false),
        text: intl.formatMessage({ id: "actions.cancel" }),
        variant: "secondary",
      }}
      isRunning={isDeleting}
    >
      <p>
        <FormattedMessage
          id="dialogs.delete_object_desc"
          values={{
            count,
            singularEntity: intl.formatMessage({ id: "studio" }).toLocaleLowerCase(),
            pluralEntity: intl.formatMessage({ id: "studios" }).toLocaleLowerCase(),
          }}
        />
      </p>
      <ul className="mb-3">
        {props.selected.slice(0, 10).map((s) => (
          <li key={s.id}>{s.name}</li>
        ))}
        {props.selected.length > 10 && (
          <FormattedMessage
            values={{
              count: props.selected.length - 10,
              singularEntity: intl.formatMessage({ id: "studio" }).toLocaleLowerCase(),
              pluralEntity: intl.formatMessage({ id: "studios" }).toLocaleLowerCase(),
            }}
            id="dialogs.delete_object_overflow"
          />
        )}
      </ul>

      {scenesData?.findScenes && scenesData.findScenes.count > 0 && (
        <Box component="div" sx={{ mt: 2, display: "flex", flexDirection: "column" }}>
          <FormControlLabel
            control={
              <Checkbox
                id="cascade-delete"
                checked={cascadeDelete}
                onChange={() => setCascadeDelete(!cascadeDelete)}
              />
            }
            label={intl.formatMessage({
              id: "dialogs.delete_studio_scenes",
              defaultMessage: "Delete scenes contained within this studio",
            })}
          />

          {cascadeDelete && (
            <Box sx={{ pl: 4, display: "flex", flexDirection: "column" }}>
              {maybeRenderDeleteFileAlert()}
              <FormControlLabel
                control={
                  <Checkbox
                    id="delete-file"
                    checked={deleteFile}
                    onChange={() => setDeleteFile(!deleteFile)}
                  />
                }
                label={intl.formatMessage({
                  id: "actions.delete_file_and_funscript",
                })}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    id="delete-generated"
                    checked={deleteGenerated}
                    onChange={() => setDeleteGenerated(!deleteGenerated)}
                  />
                }
                label={intl.formatMessage({
                  id: "actions.delete_generated_supporting_files",
                })}
              />
            </Box>
          )}
        </Box>
      )}
    </ModalComponent>
  );
};
