import React from "react";
import { Checkbox, FormControl, FormControlLabel, Radio, RadioGroup, Typography, Tooltip, Box } from "@mui/material";
import { useIntl } from "react-intl";

interface IThreeStateBoolean {
  id: string;
  value: boolean | undefined;
  setValue: (v: boolean | undefined) => void;
  allowUndefined?: boolean;
  label?: React.ReactNode;
  disabled?: boolean;
  defaultValue?: boolean;
  tooltip?: string | undefined;
}

export const ThreeStateBoolean: React.FC<IThreeStateBoolean> = ({
  id,
  value,
  setValue,
  allowUndefined = true,
  label,
  disabled,
  defaultValue,
  tooltip,
}) => {
  const intl = useIntl();

  if (!allowUndefined) {
    return (
      <Tooltip title={tooltip ?? ""}>
        <FormControlLabel
          control={
            <Checkbox
              id={id}
              disabled={disabled}
              checked={value ?? false}
              onChange={() => setValue(!value)}
            />
          }
          label={label}
        />
      </Tooltip>
    );
  }

  function getBooleanText(v: boolean) {
    if (v) {
      return intl.formatMessage({ id: "true" });
    }
    return intl.formatMessage({ id: "false" });
  }

  function getButtonText(v: boolean | undefined) {
    if (v === undefined) {
      const defaultVal =
        defaultValue !== undefined ? (
          <span className="default-value">
            {" "}
            ({getBooleanText(defaultValue)})
          </span>
        ) : (
          ""
        );
      return (
        <span>
          {intl.formatMessage({ id: "actions.use_default" })}
          {defaultVal}
        </span>
      );
    }

    return getBooleanText(v);
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const val = event.target.value;
    if (val === "undefined") {
      setValue(undefined);
    } else {
      setValue(val === "true");
    }
  }

  return (
    <Box>
      <Tooltip title={tooltip ?? ""}>
        <Typography variant="subtitle2" gutterBottom title={tooltip}>{label}</Typography>
      </Tooltip>
      <FormControl component="fieldset" disabled={disabled}>
        <RadioGroup
          name={id}
          value={value === undefined ? "undefined" : value.toString()}
          onChange={handleChange}
        >
          <FormControlLabel value="undefined" control={<Radio size="small" />} label={getButtonText(undefined)} />
          <FormControlLabel value="false" control={<Radio size="small" />} label={getButtonText(false)} />
          <FormControlLabel value="true" control={<Radio size="small" />} label={getButtonText(true)} />
        </RadioGroup>
      </FormControl>
    </Box>
  );
};
