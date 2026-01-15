import cloneDeep from "lodash-es/cloneDeep";
import React from "react";
import { FormControlLabel, Radio, RadioGroup, Checkbox } from "@mui/material";
import {
  CriterionValue,
  ModifierCriterion,
} from "src/models/list-filter/criteria/criterion";

interface IOptionsFilter {
  criterion: ModifierCriterion<CriterionValue>;
  setCriterion: (c: ModifierCriterion<CriterionValue>) => void;
}

export const OptionFilter: React.FC<IOptionsFilter> = ({
  criterion,
  setCriterion,
}) => {
  function onSelect(v: string) {
    const c = cloneDeep(criterion);
    if (c.value === v) {
      c.value = "";
    } else {
      c.value = v;
    }

    setCriterion(c);
  }

  const { options } = criterion.modifierCriterionOption();

  return (
    <RadioGroup className="option-list-filter">
      {options?.map((o) => (
        <FormControlLabel
          key={o.toString()}
          control={
            <Radio
              id={`${criterion.getId()}-${o.toString()}`}
              checked={criterion.value === o.toString()}
              onChange={() => onSelect(o.toString())}
              size="small"
            />
          }
          label={o.toString()}
        />
      ))}
    </RadioGroup>
  );
};

interface IOptionsListFilter {
  criterion: ModifierCriterion<CriterionValue>;
  setCriterion: (c: ModifierCriterion<CriterionValue>) => void;
}

export const OptionListFilter: React.FC<IOptionsListFilter> = ({
  criterion,
  setCriterion,
}) => {
  function onSelect(v: string) {
    const c = cloneDeep(criterion);
    const cv = c.value as string[];
    if (cv.includes(v)) {
      c.value = cv.filter((x) => x !== v);
    } else {
      c.value = [...cv, v];
    }

    setCriterion(c);
  }

  const { options } = criterion.modifierCriterionOption();
  const value = criterion.value as string[];

  return (
    <div className="option-list-filter">
      {options?.map((o) => (
        <FormControlLabel
          key={o.toString()}
          control={
            <Checkbox
              id={`${criterion.getId()}-${o.toString()}`}
              checked={value.includes(o.toString())}
              onChange={() => onSelect(o.toString())}
              size="small"
            />
          }
          label={o.toString()}
        />
      ))}
    </div>
  );
};
