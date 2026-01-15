import React, { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import * as GQL from "src/core/generated-graphql";
import { ModalComponent } from "src/components/Shared/Modal";
import { faLink } from "@fortawesome/free-solid-svg-icons";
import { Tag, TagSelect } from "../../Tags/TagSelect";
import {
  Box,
  Radio,
  RadioGroup,
  FormControlLabel,
  Checkbox,
  TextField,
  Typography
} from "@mui/material";

export const CreateLinkTagDialog: React.FC<{
  tag: GQL.ScrapedTag;
  onClose: (result: {
    create?: GQL.TagCreateInput;
    update?: GQL.TagUpdateInput;
  }) => void;
  endpoint?: string;
}> = ({ tag, onClose, endpoint }) => {
  const intl = useIntl();

  const [createNew, setCreateNew] = useState(false);
  const [name, setName] = useState(tag.name);
  const [existingTag, setExistingTag] = useState<Tag | null>(null);
  const [addAsAlias, setAddAsAlias] = useState(false);

  const canAddAlias = (createNew && name !== tag.name) || !createNew;

  useEffect(() => {
    setAddAsAlias(canAddAlias);
  }, [canAddAlias]);

  function handleTagSave() {
    if (createNew) {
      const createInput: GQL.TagCreateInput = {
        name: name,
        aliases: addAsAlias ? [tag.name] : [],
        stash_ids:
          endpoint && tag.remote_site_id
            ? [{ endpoint: endpoint!, stash_id: tag.remote_site_id }]
            : undefined,
      };
      onClose({ create: createInput });
    } else if (existingTag) {
      const updateInput: GQL.TagUpdateInput = {
        id: existingTag.id,
        aliases: addAsAlias
          ? [...(existingTag.aliases || []), tag.name]
          : undefined,
        // add stash id if applicable
        stash_ids:
          endpoint && tag.remote_site_id
            ? [
              ...(existingTag.stash_ids || []),
              { endpoint: endpoint!, stash_id: tag.remote_site_id },
            ]
            : undefined,
      };
      onClose({ update: updateInput });
    }
  }

  return (
    <ModalComponent
      show={true}
      accept={{
        text: intl.formatMessage({ id: "actions.save" }),
        onClick: () => handleTagSave(),
      }}
      disabled={createNew ? name.trim() === "" : existingTag === null}
      cancel={{
        text: intl.formatMessage({ id: "actions.cancel" }),
        onClick: () => {
          onClose({});
        },
      }}
      dialogClassName="create-link-tag-modal"
      icon={faLink}
      header={intl.formatMessage({ id: "component_tagger.verb_match_tag" })}
    >
      <Box p={2}>
        <FormControlLabel
          value="create"
          control={
            <Radio
              checked={createNew}
              onChange={() => setCreateNew(true)}
            />
          }
          label={intl.formatMessage({ id: "actions.create_new" })}
        />

        <Box ml={4} mt={1} mb={2}>
          <TextField
            label={<FormattedMessage id="name" />}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!createNew}
            variant="outlined"
            size="small"
            fullWidth
          />
        </Box>

        <FormControlLabel
          value="link"
          control={
            <Radio
              checked={!createNew}
              onChange={() => setCreateNew(false)}
            />
          }
          label={intl.formatMessage({
            id: "component_tagger.verb_link_existing",
          })}
        />

        <Box ml={4} mt={1}>
          <TagSelect
            isMulti={false}
            values={existingTag ? [existingTag] : []}
            onSelect={(t) => setExistingTag(t.length > 0 ? t[0] : null)}
            isDisabled={createNew}
            menuPortalTarget={document.body}
          />
        </Box>

        <Box mt={3}>
          <FormControlLabel
            control={
              <Checkbox
                checked={addAsAlias}
                onChange={() => setAddAsAlias(!addAsAlias)}
                disabled={!canAddAlias}
              />
            }
            label={intl.formatMessage({
              id: "component_tagger.verb_add_as_alias",
            })}
          />
        </Box>
      </Box>
    </ModalComponent>
  );
};
