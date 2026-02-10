import React from "react";
import { Box, TextField } from "@mui/material";
import { useIntl } from "react-intl";
import { IPhashDistanceValue } from "../../../models/list-filter/types";
import { ModifierCriterion } from "../../../models/list-filter/criteria/criterion";
import { CriterionModifier } from "src/core/generated-graphql";
import { NumberField } from "src/utils/form";

interface IPhashFilterProps {
  criterion: ModifierCriterion<IPhashDistanceValue>;
  onValueChanged: (value: IPhashDistanceValue) => void;
}

export const PhashFilter: React.FC<IPhashFilterProps> = ({
  criterion,
  onValueChanged,
}) => {
  const intl = useIntl();
  const { value } = criterion;

  function valueChanged(event: React.ChangeEvent<HTMLInputElement>) {
    onValueChanged({
      value: event.target.value,
      distance: criterion.value.distance,
    });
  }

  function distanceChanged(event: React.ChangeEvent<HTMLInputElement>) {
    let distance = parseInt(event.target.value);
    if (distance < 0 || isNaN(distance)) {
      distance = 0;
    }

    onValueChanged({
      distance,
      value: criterion.value.value,
    });
  }

  return (
    <div>
      <Box mb={1}>
        <TextField
          fullWidth
          size="small"
          onChange={valueChanged}
          value={value ? value.value : ""}
          placeholder={intl.formatMessage({ id: "media_info.phash" })}
          variant="outlined"
        />
      </Box>
      {criterion.modifier !== CriterionModifier.IsNull &&
        criterion.modifier !== CriterionModifier.NotNull && (
          <Box mb={1}>
            <NumberField
              onChange={distanceChanged}
              value={value ? value.distance : ""}
              placeholder={intl.formatMessage({ id: "distance" })}
            />
          </Box>
        )}
    </div>
  );
};
