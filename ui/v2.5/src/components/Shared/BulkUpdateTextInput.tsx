import { faBan } from "@fortawesome/free-solid-svg-icons";
import React from "react";
import { IconButton, TextField, InputAdornment, TextFieldProps } from "@mui/material";
import { useIntl } from "react-intl";
import { Icon } from "./Icon";

interface IBulkUpdateTextInputProps extends Omit<TextFieldProps, 'variant'> {
  valueChanged: (value: string | undefined) => void;
  unsetDisabled?: boolean;
  as?: React.ElementType;
}

export const BulkUpdateTextInput: React.FC<IBulkUpdateTextInputProps> = ({
  valueChanged,
  unsetDisabled,
  ...props
}) => {
  const intl = useIntl();

  const unsetClassName = props.value === undefined ? "unset" : "";

  return (
    <TextField
      {...props}
      className={`bulk-update-text-input ${unsetClassName} ${props.className ?? ""}`}
      variant="outlined"
      fullWidth
      value={props.value ?? ""}
      placeholder={
        props.value === undefined
          ? `<${intl.formatMessage({ id: "existing_value" })}>`
          : undefined
      }
      onChange={(event) => valueChanged(event.target.value)}
      InputProps={{
        endAdornment: !unsetDisabled ? (
          <InputAdornment position="end">
            <IconButton
              onClick={() => valueChanged(undefined)}
              title={intl.formatMessage({ id: "actions.unset" })}
              edge="end"
            >
              <Icon icon={faBan} />
            </IconButton>
          </InputAdornment>
        ) : undefined,
      }}
    />
  );
};
