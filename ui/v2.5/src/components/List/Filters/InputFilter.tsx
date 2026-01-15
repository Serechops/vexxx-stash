import React from "react";
import { TextField } from "@mui/material";
import {
  ModifierCriterion,
  CriterionValue,
} from "../../../models/list-filter/criteria/criterion";

interface IInputFilterProps {
  criterion: ModifierCriterion<CriterionValue>;
  onValueChanged: (value: string) => void;
}

export const InputFilter: React.FC<IInputFilterProps> = ({
  criterion,
  onValueChanged,
}) => {
  function onChanged(event: React.ChangeEvent<HTMLInputElement>) {
    onValueChanged(event.target.value);
  }

  return (
    <TextField
      fullWidth
      size="small"
      type={criterion.modifierCriterionOption().inputType}
      onChange={onChanged}
      value={criterion.value ? criterion.value.toString() : ""}
      variant="outlined"
    />
  );
};
