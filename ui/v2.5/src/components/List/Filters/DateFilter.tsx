import React from "react";
import { Box } from "@mui/material";
import { useIntl } from "react-intl";
import { CriterionModifier } from "../../../core/generated-graphql";
import { IDateValue } from "../../../models/list-filter/types";
import { ModifierCriterion } from "../../../models/list-filter/criteria/criterion";
import { DateInput } from "src/components/Shared/DateInput";

interface IDateFilterProps {
  criterion: ModifierCriterion<IDateValue>;
  onValueChanged: (value: IDateValue) => void;
}

export const DateFilter: React.FC<IDateFilterProps> = ({
  criterion,
  onValueChanged,
}) => {
  const intl = useIntl();

  const { value } = criterion;

  function onChanged(newValue: string, property: "value" | "value2") {
    const valueCopy = { ...value };

    valueCopy[property] = newValue;
    onValueChanged(valueCopy);
  }

  let equalsControl: JSX.Element | null = null;
  if (
    criterion.modifier === CriterionModifier.Equals ||
    criterion.modifier === CriterionModifier.NotEquals
  ) {
    equalsControl = (
      <Box mb={1}>
        <DateInput
          value={value?.value ?? ""}
          onValueChange={(v) => onChanged(v, "value")}
          placeholder={intl.formatMessage({ id: "criterion.value" })}
        />
      </Box>
    );
  }

  let lowerControl: JSX.Element | null = null;
  if (
    criterion.modifier === CriterionModifier.GreaterThan ||
    criterion.modifier === CriterionModifier.Between ||
    criterion.modifier === CriterionModifier.NotBetween
  ) {
    lowerControl = (
      <Box mb={1}>
        <DateInput
          value={value?.value ?? ""}
          onValueChange={(v) => onChanged(v, "value")}
          placeholder={intl.formatMessage({ id: "criterion.greater_than" })}
        />
      </Box>
    );
  }

  let upperControl: JSX.Element | null = null;
  if (
    criterion.modifier === CriterionModifier.LessThan ||
    criterion.modifier === CriterionModifier.Between ||
    criterion.modifier === CriterionModifier.NotBetween
  ) {
    upperControl = (
      <Box mb={1}>
        <DateInput
          value={
            (criterion.modifier === CriterionModifier.LessThan
              ? value?.value
              : value?.value2) ?? ""
          }
          onValueChange={(v) =>
            onChanged(
              v,
              criterion.modifier === CriterionModifier.LessThan
                ? "value"
                : "value2"
            )
          }
          placeholder={intl.formatMessage({ id: "criterion.less_than" })}
        />
      </Box>
    );
  }

  return (
    <>
      {equalsControl}
      {lowerControl}
      {upperControl}
    </>
  );
};
