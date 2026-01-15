import React from "react";
import { Box, TextField } from "@mui/material";
import { useIntl } from "react-intl";
import { IStashIDValue } from "../../../models/list-filter/types";
import { ModifierCriterion } from "../../../models/list-filter/criteria/criterion";
import { CriterionModifier } from "src/core/generated-graphql";

interface IStashIDFilterProps {
  criterion: ModifierCriterion<IStashIDValue>;
  onValueChanged: (value: IStashIDValue) => void;
}

export const StashIDFilter: React.FC<IStashIDFilterProps> = ({
  criterion,
  onValueChanged,
}) => {
  const intl = useIntl();
  const { value } = criterion;

  function onEndpointChanged(event: React.ChangeEvent<HTMLInputElement>) {
    onValueChanged({
      endpoint: event.target.value,
      stashID: criterion.value.stashID,
    });
  }

  function onStashIDChanged(event: React.ChangeEvent<HTMLInputElement>) {
    onValueChanged({
      stashID: event.target.value,
      endpoint: criterion.value.endpoint,
    });
  }

  return (
    <div>
      <Box mb={1}>
        <TextField
          fullWidth
          size="small"
          onChange={onEndpointChanged}
          value={value ? value.endpoint : ""}
          placeholder={intl.formatMessage({ id: "stash_id_endpoint" })}
          variant="outlined"
        />
      </Box>
      {criterion.modifier !== CriterionModifier.IsNull &&
        criterion.modifier !== CriterionModifier.NotNull && (
          <Box mb={1}>
            <TextField
              fullWidth
              size="small"
              onChange={onStashIDChanged}
              value={value ? value.stashID : ""}
              placeholder={intl.formatMessage({ id: "stash_id" })}
              variant="outlined"
            />
          </Box>
        )}
    </div>
  );
};
