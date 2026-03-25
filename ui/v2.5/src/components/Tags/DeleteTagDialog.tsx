import React, { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Alert, Box, Typography } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";

import * as GQL from "src/core/generated-graphql";
import { useTagsDestroy } from "src/core/StashService";
import { ModalComponent } from "../Shared/Modal";
import { useToast } from "src/hooks/Toast";
import { tagRelationHook } from "src/core/tags";
import { TagSelect, SelectObject } from "../Shared/Select";

interface IDeleteTagDialogProps {
  selected: GQL.TagListDataFragment[];
  onClose: (confirmed: boolean) => void;
}

export const DeleteTagDialog: React.FC<IDeleteTagDialogProps> = ({
  selected,
  onClose,
}) => {
  const intl = useIntl();
  const Toast = useToast();

  const [reassignTag, setReassignTag] = useState<SelectObject | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [doDestroy] = useTagsDestroy({ ids: selected.map((t) => t.id) });

  const tagsWithMarkers = selected.filter(
    (t) => t.scene_marker_primary_count > 0
  );
  const hasMarkerConflict = tagsWithMarkers.length > 0;
  const count = selected.length;

  const excludeIds = selected.map((t) => t.id);

  function onSelectReassignTag(tags: SelectObject[]) {
    setReassignTag(tags[0] ?? null);
  }

  async function onDelete() {
    setIsDeleting(true);
    try {
      const variables: GQL.TagsDestroyMutationVariables = {
        ids: selected.map((t) => t.id),
        ...(reassignTag ? { reassignPrimaryTagId: reassignTag.id } : {}),
      };

      await doDestroy({ variables });

      selected.forEach((t) => {
        tagRelationHook(
          t,
          { parents: t.parents ?? [], children: t.children ?? [] },
          { parents: [], children: [] }
        );
      });

      Toast.success(
        intl.formatMessage(
          { id: "toast.delete_past_tense" },
          {
            count: selected.length,
            singularEntity: intl.formatMessage({ id: "tag" }),
            pluralEntity: intl.formatMessage({ id: "tags" }),
          }
        )
      );
      onClose(true);
    } catch (e) {
      Toast.error(e);
      setIsDeleting(false);
    }
  }

  return (
    <ModalComponent
      show
      icon={<DeleteIcon />}
      header={intl.formatMessage(
        { id: "dialogs.delete_object_title" },
        {
          count,
          singularEntity: intl.formatMessage({ id: "tag" }),
          pluralEntity: intl.formatMessage({ id: "tags" }),
        }
      )}
      accept={{
        variant: "danger",
        onClick: onDelete,
        text: intl.formatMessage({ id: "actions.delete" }),
      }}
      cancel={{
        onClick: () => onClose(false),
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
            singularEntity: intl.formatMessage({ id: "tag" }),
            pluralEntity: intl.formatMessage({ id: "tags" }),
          }}
        />
      </p>

      <ul>
        {selected.slice(0, 10).map((t) => (
          <li key={t.id}>{t.name}</li>
        ))}
        {count > 10 && (
          <li>
            <FormattedMessage
              id="dialogs.delete_object_overflow"
              values={{
                count: count - 10,
                singularEntity: intl.formatMessage({ id: "tag" }),
                pluralEntity: intl.formatMessage({ id: "tags" }),
              }}
            />
          </li>
        )}
      </ul>

      {hasMarkerConflict && (
        <>
          <Alert severity="info" sx={{ mt: 1, mb: 0.5 }}>
            <FormattedMessage id="dialogs.delete_tags_marker_info" />
          </Alert>
          <Box
            component="ul"
            sx={{ mt: 0.5, mb: 1.5, pl: 3, "& li": { fontSize: "0.875rem" } }}
          >
            {tagsWithMarkers.map((t) => (
              <li key={t.id}>
                {t.name}{" "}
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                >
                  ({t.scene_marker_primary_count}{" "}
                  <FormattedMessage
                    id="markers"
                    values={{ count: t.scene_marker_primary_count }}
                  />)
                </Typography>
              </li>
            ))}
          </Box>

          <Typography variant="body2" sx={{ mb: 0.5 }}>
            <FormattedMessage id="dialogs.delete_tags_reassign_markers_to" />
          </Typography>
          <TagSelect
            onSelect={onSelectReassignTag}
            ids={reassignTag ? [reassignTag.id] : []}
            excludeIds={excludeIds}
          />
        </>
      )}
    </ModalComponent>
  );
};

