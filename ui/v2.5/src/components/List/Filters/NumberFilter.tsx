import React from "react";
import { Box } from "@mui/material";
import { useIntl } from "react-intl";
import { CriterionModifier } from "../../../core/generated-graphql";
import { INumberValue } from "../../../models/list-filter/types";
import { NumberCriterion } from "../../../models/list-filter/criteria/criterion";
import { NumberField } from "src/utils/form";

interface IDurationFilterProps {
  criterion: NumberCriterion;
  onValueChanged: (value: INumberValue) => void;
}

export const NumberFilter: React.FC<IDurationFilterProps> = ({
  criterion,
  onValueChanged,
}) => {
  const intl = useIntl();

  const { value } = criterion;

  function onChanged(
    event: React.ChangeEvent<HTMLInputElement>,
    property: "value" | "value2"
  ) {
    const numericValue = parseInt(event.target.value, 10);
    const valueCopy = { ...value };

    valueCopy[property] = !Number.isNaN(numericValue) ? numericValue : 0;
    onValueChanged(valueCopy);
  }

  let equalsControl: JSX.Element | null = null;
  if (
    criterion.modifier === CriterionModifier.Equals ||
    criterion.modifier === CriterionModifier.NotEquals
  ) {
    equalsControl = (
      <Box mb={1}>
        <NumberField
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChanged(e, "value")
          }
          value={value?.value ?? ""}
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
        <NumberField
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChanged(e, "value")
          }
          value={value?.value ?? ""}
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
        <NumberField
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChanged(
              e,
              criterion.modifier === CriterionModifier.LessThan
                ? "value"
                : "value2"
            )
          }
          value={
            (criterion.modifier === CriterionModifier.LessThan
              ? value?.value
              : value?.value2) ?? ""
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
