import React, { useEffect, useState } from "react";
import { Box, FormLabel } from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import { useBulkTagUpdate } from "src/core/StashService";
import * as GQL from "src/core/generated-graphql";
import { ModalComponent } from "../Shared/Modal";
import { useToast } from "src/hooks/Toast";
import { MultiSet } from "../Shared/MultiSet";
import {
  getAggregateState,
  getAggregateStateObject,
} from "src/utils/bulkUpdate";
import { IndeterminateCheckbox } from "../Shared/IndeterminateCheckbox";
import { BulkUpdateTextInput } from "../Shared/BulkUpdateTextInput";
import EditIcon from "@mui/icons-material/Edit";

function Tags(props: {
  isUpdating: boolean;
  controlId: string;
  messageId: string;
  existingTagIds: string[] | undefined;
  tagIDs: GQL.BulkUpdateIds;
  setTagIDs: (value: React.SetStateAction<GQL.BulkUpdateIds>) => void;
}) {
  const {
    isUpdating,
    controlId,
    messageId,
    existingTagIds,
    tagIDs,
    setTagIDs,
  } = props;

  return (
    <Box mb={2} id={controlId}>
      <FormLabel>
        <FormattedMessage id={messageId} />
      </FormLabel>
      <MultiSet
        type="tags"
        disabled={isUpdating}
        onUpdate={(itemIDs) =>
          setTagIDs((existing) => ({ ...existing, ids: itemIDs }))
        }
        onSetMode={(newMode) =>
          setTagIDs((existing) => ({ ...existing, mode: newMode }))
        }
        existingIds={existingTagIds ?? []}
        ids={tagIDs.ids ?? []}
        mode={tagIDs.mode}
        menuPortalTarget={document.body}
      />
    </Box>
  );
}

interface IListOperationProps {
  selected: (GQL.TagDataFragment | GQL.TagListDataFragment)[];
  onClose: (applied: boolean) => void;
}

const tagFields = ["favorite", "description", "ignore_auto_tag"];

export const EditTagsDialog: React.FC<IListOperationProps> = (
  props: IListOperationProps
) => {
  const intl = useIntl();
  const Toast = useToast();

  const [parentTagIDs, setParentTagIDs_] = useState<GQL.BulkUpdateIds>({
    mode: GQL.BulkUpdateIdMode.Add,
  });

  function setParentTagIDs(value: React.SetStateAction<GQL.BulkUpdateIds>) {
    setParentTagIDs_(value);
  }

  const [existingParentTagIds, setExistingParentTagIds] = useState<string[]>();

  const [childTagIDs, setChildTagIDs] = useState<GQL.BulkUpdateIds>({
    mode: GQL.BulkUpdateIdMode.Add,
  });
  const [existingChildTagIds, setExistingChildTagIds] = useState<string[]>();

  const [updateInput, setUpdateInput] = useState<GQL.BulkTagUpdateInput>({});

  const [updateTags] = useBulkTagUpdate(getTagInput());

  // Network state
  const [isUpdating, setIsUpdating] = useState(false);

  function setUpdateField(input: Partial<GQL.BulkTagUpdateInput>) {
    setUpdateInput({ ...updateInput, ...input });
  }

  function getTagInput(): GQL.BulkTagUpdateInput {
    const tagInput: GQL.BulkTagUpdateInput = {
      ids: props.selected.map((tag) => {
        return tag.id;
      }),
      ...updateInput,
      parent_ids: parentTagIDs,
      child_ids: childTagIDs,
    };

    return tagInput;
  }

  async function onSave() {
    setIsUpdating(true);
    try {
      await updateTags();
      Toast.success(
        intl.formatMessage(
          { id: "toast.updated_entity" },
          {
            entity: intl.formatMessage({ id: "tags" }).toLocaleLowerCase(),
          }
        )
      );
      props.onClose(true);
    } catch (e) {
      Toast.error(e);
    }
    setIsUpdating(false);
  }

  useEffect(() => {
    const updateState: GQL.BulkTagUpdateInput = {};

    const state = props.selected;
    let updateParentTagIds: string[] = [];
    let updateChildTagIds: string[] = [];
    let first = true;

    state.forEach((tag: GQL.TagDataFragment | GQL.TagListDataFragment) => {
      getAggregateStateObject(updateState, tag, tagFields, first);

      const thisParents = (tag.parents ?? []).map((t) => t.id).sort();
      updateParentTagIds =
        getAggregateState(updateParentTagIds, thisParents, first) ?? [];

      const thisChildren = (tag.children ?? []).map((t) => t.id).sort();
      updateChildTagIds =
        getAggregateState(updateChildTagIds, thisChildren, first) ?? [];

      first = false;
    });

    setExistingParentTagIds(updateParentTagIds);
    setExistingChildTagIds(updateChildTagIds);
    setUpdateInput(updateState);
  }, [props.selected]);

  function renderTextField(
    name: string,
    value: string | undefined | null,
    setter: (newValue: string | undefined) => void
  ) {
    return (
      <Box mb={2}>
        <BulkUpdateTextInput
          label={<FormattedMessage id={name} />}
          value={value === null ? "" : value ?? undefined}
          valueChanged={(newValue) => setter(newValue)}
          unsetDisabled={props.selected.length < 2}
        />
      </Box>
    );
  }

  return (
    <ModalComponent
      dialogClassName="edit-tags-dialog"
      show
      icon={<EditIcon />}
      header={intl.formatMessage(
        { id: "actions.edit_entity" },
        { entityType: intl.formatMessage({ id: "tags" }) }
      )}
      accept={{
        onClick: onSave,
        text: intl.formatMessage({ id: "actions.apply" }),
      }}
      cancel={{
        onClick: () => props.onClose(false),
        text: intl.formatMessage({ id: "actions.cancel" }),
        variant: "secondary",
      }}
      isRunning={isUpdating}
    >
      <Box
        sx={{
          maxHeight: "70vh",
          overflowY: "auto",
          overflowX: "hidden",
          px: 1
        }}
      >
        <Box component="form">
          <Box mb={2} id="favorite">
            <IndeterminateCheckbox
              setChecked={(checked) => setUpdateField({ favorite: checked })}
              checked={updateInput.favorite ?? undefined}
              label={intl.formatMessage({ id: "favourite" })}
            />
          </Box>

          {renderTextField("description", updateInput.description, (v) =>
            setUpdateField({ description: v })
          )}

          <Tags
            isUpdating={isUpdating}
            controlId="parent-tags"
            messageId="parent_tags"
            existingTagIds={existingParentTagIds}
            tagIDs={parentTagIDs}
            setTagIDs={setParentTagIDs}
          />

          <Tags
            isUpdating={isUpdating}
            controlId="sub-tags"
            messageId="sub_tags"
            existingTagIds={existingChildTagIds}
            tagIDs={childTagIDs}
            setTagIDs={setChildTagIDs}
          />

          <Box mb={2} id="ignore-auto-tags">
            <IndeterminateCheckbox
              label={intl.formatMessage({ id: "ignore_auto_tag" })}
              setChecked={(checked) =>
                setUpdateField({ ignore_auto_tag: checked })
              }
              checked={updateInput.ignore_auto_tag ?? undefined}
            />
          </Box>
        </Box>
      </Box>
    </ModalComponent>
  );
};
