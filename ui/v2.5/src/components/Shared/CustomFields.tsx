import React, { useEffect, useMemo, useRef, useState } from "react";
import { CollapseButton } from "./CollapseButton";
import { DetailItem } from "./DetailItem";
import { Button, TextField, Box, Typography, InputAdornment, IconButton } from "@mui/material";
import Grid from "@mui/material/Grid";
import { FormattedMessage, useIntl } from "react-intl";
import { cloneDeep } from "@apollo/client/utilities";
import { Icon } from "./Icon";
import { faMinus, faPlus } from "@fortawesome/free-solid-svg-icons";
import cx from "classnames";
import { PatchComponent } from "src/patch";
import { TruncatedText } from "./TruncatedText";

const maxFieldNameLength = 64;

export type CustomFieldMap = {
  [key: string]: unknown;
};

interface ICustomFields {
  values: CustomFieldMap;
}

function convertValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  } else if (typeof value === "number") {
    return value.toString();
  } else if (typeof value === "boolean") {
    return value ? "true" : "false";
  } else if (Array.isArray(value)) {
    return value.join(", ");
  } else {
    return JSON.stringify(value);
  }
}

const CustomField: React.FC<{ field: string; value: unknown }> = ({
  field,
  value,
}) => {
  const valueStr = convertValue(value);

  // replace spaces with hyphen characters for css id
  const id = field.toLowerCase().replace(/ /g, "-");

  return (
    <DetailItem
      id={id}
      label={field}
      labelTitle={field}
      value={<TruncatedText lineCount={5} text={<>{valueStr}</>} />}
      fullWidth={true}
      showEmpty
    />
  );
};

export const CustomFields: React.FC<ICustomFields> = PatchComponent(
  "CustomFields",
  ({ values }) => {
    const intl = useIntl();
    if (Object.keys(values).length === 0) {
      return null;
    }

    return (
      // according to linter rule CSS classes shouldn't use underscores
      <div className="custom-fields">
        <CollapseButton
          text={intl.formatMessage({ id: "custom_fields.title" })}
        >
          {Object.entries(values).map(([key, value]) => (
            <CustomField key={key} field={key} value={value} />
          ))}
        </CollapseButton>
      </div>
    );
  }
);

function isNumeric(v: string) {
  return /^-?(?:0|(?:[1-9][0-9]*))(?:\.[0-9]+)?$/.test(v);
}

function convertCustomValue(v: string) {
  // if the value is numeric, convert it to a number
  if (isNumeric(v)) {
    return Number(v);
  } else {
    return v;
  }
}

const CustomFieldInput: React.FC<{
  field: string;
  value: unknown;
  onChange: (field: string, value: unknown) => void;
  isNew?: boolean;
  error?: string;
}> = PatchComponent(
  "CustomFieldInput",
  ({ field, value, onChange, isNew = false, error }) => {
    const intl = useIntl();
    const [currentField, setCurrentField] = useState(field);
    const [currentValue, setCurrentValue] = useState(value as string);

    const fieldRef = useRef<HTMLInputElement>(null);
    const valueRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      setCurrentField(field);
      setCurrentValue(value as string);
    }, [field, value]);

    function onBlur() {
      onChange(currentField, convertCustomValue(currentValue));
    }

    function onDelete() {
      onChange("", "");
    }

    return (
      <Box sx={{ mb: 1 }}>
        <Grid
          container
          spacing={1}
          className={cx("custom-fields-row", { "custom-fields-new": isNew })}
          alignItems="center"
        >
          <Grid size={{ xs: 12, sm: 3, xl: 2 }} className="custom-fields-field">
            {isNew ? (
              <TextField
                inputRef={fieldRef}
                className="input-control"
                size="small"
                fullWidth
                value={currentField ?? ""}
                placeholder={intl.formatMessage({
                  id: "custom_fields.field",
                })}
                onChange={(event) =>
                  setCurrentField(event.target.value)
                }
                onBlur={onBlur}
              />
            ) : (
              <Typography variant="body2" title={currentField} sx={{ fontWeight: 'bold' }}>
                {currentField}
              </Typography>
            )}
          </Grid>
          <Grid size={{ xs: 12, sm: 9, xl: 7 }}>
            <TextField
              inputRef={valueRef}
              className="input-control"
              size="small"
              fullWidth
              value={(currentValue as string) ?? ""}
              placeholder={currentField}
              onChange={(event) => setCurrentValue(event.target.value)}
              onBlur={onBlur}
              error={!!error}
              helperText={error}
              InputProps={{
                endAdornment: !isNew ? (
                  <InputAdornment position="end">
                    <IconButton
                      className="custom-fields-remove"
                      color="error"
                      onClick={() => onDelete()}
                      size="small"
                    >
                      <Icon icon={faMinus} />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              }}
            />
          </Grid>
        </Grid>
      </Box>
    );
  }
);

interface ICustomField {
  field: string;
  value: unknown;
}

interface ICustomFieldsInput {
  values: CustomFieldMap;
  error?: string;
  onChange: (values: CustomFieldMap) => void;
  setError: (error?: string) => void;
}

export const CustomFieldsInput: React.FC<ICustomFieldsInput> = PatchComponent(
  "CustomFieldsInput",
  ({ values, error, onChange, setError }) => {
    const intl = useIntl();

    const [newCustomField, setNewCustomField] = useState<ICustomField>({
      field: "",
      value: "",
    });

    const fields = useMemo(() => {
      const valueCopy = cloneDeep(values);
      if (newCustomField.field !== "" && error === undefined) {
        delete valueCopy[newCustomField.field];
      }

      const ret = Object.keys(valueCopy);
      ret.sort();
      return ret;
    }, [values, newCustomField, error]);

    function onSetNewField(v: ICustomField) {
      // validate the field name
      let newError = undefined;
      if (v.field.length > maxFieldNameLength) {
        newError = intl.formatMessage({
          id: "errors.custom_fields.field_name_length",
        });
      }
      if (v.field.trim() === "" && v.value !== "") {
        newError = intl.formatMessage({
          id: "errors.custom_fields.field_name_required",
        });
      }
      if (v.field.trim() !== v.field) {
        newError = intl.formatMessage({
          id: "errors.custom_fields.field_name_whitespace",
        });
      }
      if (fields.includes(v.field)) {
        newError = intl.formatMessage({
          id: "errors.custom_fields.duplicate_field",
        });
      }

      const oldField = newCustomField;

      setNewCustomField(v);

      const valuesCopy = cloneDeep(values);
      if (oldField.field !== "" && error === undefined) {
        delete valuesCopy[oldField.field];
      }

      // if valid, pass up
      if (!newError && v.field !== "") {
        valuesCopy[v.field] = v.value;
      }

      onChange(valuesCopy);
      setError(newError);
    }

    function onAdd() {
      const newValues = {
        ...values,
        [newCustomField.field]: newCustomField.value,
      };
      setNewCustomField({ field: "", value: "" });
      onChange(newValues);
    }

    function fieldChanged(
      currentField: string,
      newField: string,
      value: unknown
    ) {
      let newValues = cloneDeep(values);
      delete newValues[currentField];
      if (newField !== "") {
        newValues[newField] = value;
      }
      onChange(newValues);
    }

    return (
      <CollapseButton
        className="custom-fields-input"
        text={intl.formatMessage({ id: "custom_fields.title" })}
      >
        <Box>
          <Grid container spacing={1}>
            <Grid size={12}>
              <Grid container spacing={1} className="custom-fields-input-header" sx={{ mb: 1 }}>
                <Grid size={{ xs: 12, sm: 3, xl: 2 }}>
                  <Typography variant="body2" fontWeight="bold">
                    <FormattedMessage id="custom_fields.field" />
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 9, xl: 7 }}>
                  <Typography variant="body2" fontWeight="bold">
                    <FormattedMessage id="custom_fields.value" />
                  </Typography>
                </Grid>
              </Grid>
              {fields.map((field) => (
                <CustomFieldInput
                  key={field}
                  field={field}
                  value={values[field]}
                  onChange={(newField, newValue) =>
                    fieldChanged(field, newField, newValue)
                  }
                />
              ))}
              <CustomFieldInput
                field={newCustomField.field}
                value={newCustomField.value}
                error={error}
                onChange={(field, value) => onSetNewField({ field, value })}
                isNew
              />
            </Grid>
          </Grid>
        </Box>
        <Button
          className="custom-fields-add"
          variant="contained"
          color="success"
          onClick={() => onAdd()}
          disabled={newCustomField.field === "" || error !== undefined}
          size="small"
        >
          <Icon icon={faPlus} />
        </Button>
      </CollapseButton>
    );
  }
);
