import React from "react";
import { Button, FormControl, Select, MenuItem, Box } from "@mui/material";
import { CriterionModifier } from "src/core/generated-graphql";
import { ModifierCriterion } from "src/models/list-filter/criteria/criterion";
import cx from "classnames";
import { useIntl } from "react-intl";

const defaultOptions = [
  CriterionModifier.IsNull,
  CriterionModifier.NotNull,
  CriterionModifier.Equals,
  CriterionModifier.NotEquals,
  CriterionModifier.Includes,
  CriterionModifier.Excludes,
  CriterionModifier.GreaterThan,
  CriterionModifier.LessThan,
  CriterionModifier.Between,
  CriterionModifier.NotBetween,
];

interface IModifierSelect {
  options?: CriterionModifier[];
  value: CriterionModifier;
  onChanged: (m: CriterionModifier) => void;
}

export const ModifierSelectorButtons: React.FC<IModifierSelect> = ({
  options = defaultOptions,
  value,
  onChanged,
}) => {
  const intl = useIntl();

  return (
    <Box className="modifier-options" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {options.map((m) => (
        <Button
          className={cx("modifier-option", {
            selected: value === m,
          })}
          key={m}
          onClick={() => onChanged(m)}
          variant={value === m ? "contained" : "outlined"}
          size="small"
          sx={{
            fontSize: '0.7rem',
            padding: '2px 6px',
            minWidth: 'auto',
            textTransform: 'none'
          }}
        >
          {ModifierCriterion.getModifierLabel(intl, m)}
        </Button>
      ))}
    </Box>
  );
};

export const ModifierSelect: React.FC<IModifierSelect> = ({
  options = defaultOptions,
  value,
  onChanged,
}) => {
  const intl = useIntl();

  return (
    <FormControl size="small">
      <Select
        value={value}
        onChange={(e) => onChanged(e.target.value as CriterionModifier)}
        className="modifier-selector"
      >
        {options.map((m) => (
          <MenuItem key={m} value={m}>
            {ModifierCriterion.getModifierLabel(intl, m)}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};
