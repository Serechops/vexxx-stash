import { faTrashAlt } from "@fortawesome/free-solid-svg-icons";
import { FormikValues, useFormik } from "formik";
import React, { InputHTMLAttributes, useEffect, useRef } from "react";
import { IntlShape } from "react-intl";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";

import { DateInput } from "src/components/Shared/DateInput";
import { DurationInput } from "src/components/Shared/DurationInput";
import { Icon } from "src/components/Shared/Icon";
import { RatingSystem } from "src/components/Shared/Rating/RatingSystem";
import { LinkType, StashIDPill } from "src/components/Shared/StashID";
import { StringListInput } from "src/components/Shared/StringListInput";
import { URLListInput } from "src/components/Shared/URLField";
import * as GQL from "src/core/generated-graphql";

// Mocking some bootstrap interfaces for compatibility if needed, 
// though we aim to replace them.
interface FormLabelProps {
  column?: boolean;
  xs?: number | string;
  sm?: number | string;
  md?: number | string;
  lg?: number | string;
  xl?: number | string;
  [key: string]: any;
}

function getLabelProps(labelProps?: FormLabelProps) {
  let ret = labelProps || {};
  if (!labelProps) {
    ret = {
      xs: 3,
    };
  }
  return ret;
}

export function renderLabel(options: {
  title: string;
  labelProps?: FormLabelProps;
}) {
  const props = getLabelProps(options.labelProps);
  // Filter out 'column' which is a bootstrap specific prop
  const { column, ...colProps } = props;

  // Map bootstrap cols to MUI Grid size
  const size: any = {};
  if (colProps.xs) size.xs = Number(colProps.xs);
  if (colProps.sm) size.sm = Number(colProps.sm);
  if (colProps.md) size.md = Number(colProps.md);
  if (colProps.lg) size.lg = Number(colProps.lg);
  if (colProps.xl) size.xl = Number(colProps.xl);

  // If no size props are found but we have 'xs' default from getLabelProps, use it
  if (Object.keys(size).length === 0 && colProps.xs) {
    size.xs = Number(colProps.xs);
  }

  return (
    <Grid size={size} {...colProps}>
      <Typography variant="subtitle2" component="label" sx={{ pt: 1, display: 'block' }}>
        {options.title}
      </Typography>
    </Grid>
  );
}

// useStopWheelScroll is a hook to provide a workaround for a bug in React/Chrome.
// If a number field is focused and the mouse pointer is over the field, then scrolling
// the mouse wheel will change the field value _and_ scroll the window.
// This hook prevents the propagation that causes the window to scroll.
export function useStopWheelScroll(ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const { current } = ref;

    function stopWheelScroll(e: WheelEvent) {
      if (current) {
        e.stopPropagation();
      }
    }

    if (current) {
      current.addEventListener("wheel", stopWheelScroll);
    }

    return () => {
      if (current) {
        current.removeEventListener("wheel", stopWheelScroll);
      }
    };
  });
}

// NumberField is a wrapper around TextField that prevents wheel events from scrolling the window.
// We override onChange to be specific to HTMLInputElement to maintain compatibility with legacy consumers.
// We also explicitly handle min/max/step since TextFieldProps doesn't include them directly (they go in inputProps).
type BaseTextFieldProps = React.ComponentProps<typeof TextField>;
type NumberFieldProps = Omit<BaseTextFieldProps, 'onChange'> & {
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  min?: number | string;
  max?: number | string;
  step?: number | string;
};

export const NumberField: React.FC<NumberFieldProps> = (props) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useStopWheelScroll(inputRef);

  const { onChange, min, max, step, inputProps, ...other } = props;

  // Merge min/max/step into inputProps
  const combinedInputProps = {
    ...inputProps,
    ...(min !== undefined && { min }),
    ...(max !== undefined && { max }),
    ...(step !== undefined && { step }),
  };

  return (
    <TextField
      {...other}
      type="number"
      inputRef={inputRef}
      variant="outlined"
      size="small"
      fullWidth // Bootstrap form controls are usually block block-level
      inputProps={combinedInputProps}
      onChange={
        onChange
          ? (e) => onChange(e as React.ChangeEvent<HTMLInputElement>)
          : undefined
      }
    />
  );
};

type Formik<V extends FormikValues> = ReturnType<typeof useFormik<V>>;

interface IProps {
  labelProps?: FormLabelProps;
  fieldProps?: any;
}

export function formikUtils<V extends FormikValues>(
  intl: IntlShape,
  formik: Formik<V>,
  {
    labelProps = {
      sm: 3,
      xl: 2,
    },
    fieldProps = {
      sm: 9,
      xl: 7,
    },
  }: IProps = {}
) {
  type Field = keyof V & string;
  type ErrorMessage = string | undefined;

  function renderFormControl(field: Field, type: string, placeholder: string) {
    const formikProps = formik.getFieldProps({ name: field, type: type });
    const error = formik.errors[field] as ErrorMessage;
    const touched = formik.touched[field];
    const hasError = !!(touched && error);

    let { value } = formikProps;
    if (value === null) {
      value = "";
    }

    if (type === "checkbox") {
      return (
        <Box>
          <FormControlLabel
            control={
              <Checkbox
                {...formikProps}
                checked={!!value} // Ensure boolean
                color="primary"
              />
            }
            label={placeholder || ""}
          />
          {hasError && <FormHelperText error>{error}</FormHelperText>}
        </Box>
      );
    }

    // textarea handling
    const isMultiline = type === "textarea";
    const inputType = isMultiline ? "text" : type;

    if (type === "number") {
      return (
        <NumberField
          className="text-input"
          placeholder={placeholder}
          {...formikProps}
          value={value}
          error={hasError}
          helperText={hasError ? error : undefined}
        />
      )
    }

    return (
      <TextField
        fullWidth
        className="text-input" // Keep classname for potential compat
        placeholder={placeholder}
        multiline={isMultiline}
        rows={isMultiline ? 3 : undefined}
        id={field}
        {...formikProps}
        type={inputType}
        value={value}
        error={hasError}
        helperText={hasError ? error : undefined}
        variant="outlined"
        size="small"
      />
    );
  }

  function renderField(
    field: Field,
    title: string,
    control: React.ReactNode,
    props?: IProps
  ) {
    const lProps = props?.labelProps ?? labelProps;
    const fProps = props?.fieldProps ?? fieldProps;

    // Map bootstrap cols to MUI Grid size for field props
    const size: any = {};
    if (fProps.xs) size.xs = Number(fProps.xs);
    if (fProps.sm) size.sm = Number(fProps.sm);
    if (fProps.md) size.md = Number(fProps.md);
    if (fProps.lg) size.lg = Number(fProps.lg);
    if (fProps.xl) size.xl = Number(fProps.xl);

    if (Object.keys(size).length === 0 && fProps.sm) {
      size.sm = Number(fProps.sm);
    }

    return (
      <Grid container spacing={2} className="mb-3" alignItems="center" data-field={field}>
        {renderLabel({ title, labelProps: lProps })}
        <Grid size={size} {...fProps}>{control}</Grid>
      </Grid>
    );
  }

  function renderInputField(
    field: Field,
    type: string = "text",
    messageID: string = field,
    props?: IProps
  ) {
    const title = intl.formatMessage({ id: messageID });
    const control = renderFormControl(field, type, title);

    return renderField(field, title, control, props);
  }

  function renderSelectField(
    field: Field,
    entries: Map<string, string>,
    messageID: string = field,
    props?: IProps
  ) {
    const formikProps = formik.getFieldProps(field);

    let { value } = formikProps;
    if (value === null) {
      value = "";
    }

    const title = intl.formatMessage({ id: messageID });
    const control = (
      <TextField
        select
        fullWidth
        className="input-control"
        {...formikProps}
        value={value}
        SelectProps={{
          native: true,
        }}
        variant="outlined"
        size="small"
      >
        <option value="" key=""></option>
        {Array.from(entries).map(([k, v]) => (
          <option value={v} key={v}>
            {k}
          </option>
        ))}
      </TextField>
    );

    return renderField(field, title, control, props);
  }

  function renderDateField(
    field: Field,
    messageID: string = field,
    props?: IProps
  ) {
    const value = formik.values[field] as string;
    const error = formik.errors[field] as ErrorMessage;

    const title = intl.formatMessage({ id: messageID });
    const control = (
      <DateInput
        value={value}
        onValueChange={(v) => formik.setFieldValue(field, v)}
        error={error}
      />
    );

    return renderField(field, title, control, props);
  }

  function renderDurationField(
    field: Field,
    messageID: string = field,
    props?: IProps
  ) {
    const value = formik.values[field] as number | null;
    const error = formik.errors[field] as ErrorMessage;

    const title = intl.formatMessage({ id: messageID });
    const control = (
      <DurationInput
        value={value}
        setValue={(v) => formik.setFieldValue(field, v)}
        error={error}
      />
    );

    return renderField(field, title, control, props);
  }

  function renderRatingField(
    field: Field,
    messageID: string = field,
    props?: IProps
  ) {
    const value = formik.values[field] as number | null;

    const title = intl.formatMessage({ id: messageID });
    const control = (
      <RatingSystem
        value={value}
        onSetRating={(v) => formik.setFieldValue(field, v)}
      />
    );

    return renderField(field, title, control, props);
  }

  // flattens a potential list of errors into a [errorMsg, errorIdx] tuple
  // error messages are joined with newlines, and duplicate messages are skipped
  function flattenError(
    error: ErrorMessage[] | ErrorMessage
  ): [string | undefined, number[] | undefined] {
    if (Array.isArray(error)) {
      let errors: string[] = [];
      const errorIdx = [];
      for (let i = 0; i < error.length; i++) {
        const err = error[i];
        if (err) {
          if (!errors.includes(err)) {
            errors.push(err);
          }
          errorIdx.push(i);
        }
      }
      return [errors.join("\n"), errorIdx];
    } else {
      return [error, undefined];
    }
  }

  interface IStringListProps extends IProps {
    // defaults to true if not provided
    orderable?: boolean;
  }

  function renderStringListField(
    field: Field,
    messageID: string = field,
    props?: IStringListProps
  ) {
    const value = formik.values[field] as string[];
    const error = formik.errors[field] as ErrorMessage[] | ErrorMessage;

    const [errorMsg, errorIdx] = flattenError(error);

    const title = intl.formatMessage({ id: messageID });
    const control = (
      <StringListInput
        value={value}
        setValue={(v) => formik.setFieldValue(field, v)}
        errors={errorMsg}
        errorIdx={errorIdx}
        orderable={props?.orderable}
      />
    );

    return renderField(field, title, control, props);
  }

  function renderURLListField(
    field: Field,
    onScrapeClick?: (url: string) => void,
    urlScrapable?: (url: string) => boolean,
    messageID: string = field,
    props?: IProps
  ) {
    const value = formik.values[field] as string[];
    const error = formik.errors[field] as ErrorMessage[] | ErrorMessage;

    const [errorMsg, errorIdx] = flattenError(error);

    const title = intl.formatMessage({ id: messageID });
    const control = (
      <URLListInput
        value={value}
        setValue={(v) => formik.setFieldValue(field, v)}
        errors={errorMsg}
        errorIdx={errorIdx}
        onScrapeClick={onScrapeClick}
        urlScrapable={urlScrapable}
      />
    );

    return renderField(field, title, control, props);
  }

  function renderStashIDsField(
    field: Field,
    linkType: LinkType,
    messageID: string = field,
    props?: IProps,
    addButton?: React.ReactNode
  ) {
    const values = formik.values[field] as GQL.StashIdInput[];

    const title = intl.formatMessage({ id: messageID });

    const removeStashID = (stashID: GQL.StashIdInput) => {
      const v = values.filter((s) => s !== stashID);
      formik.setFieldValue(field, v);
    };

    const control = (
      <>
        {values.length > 0 && (
          <ul className="pl-0 mb-2" style={{ listStyle: "none" }}>
            {values.map((stashID) => {
              return (
                <Box component="li" key={stashID.stash_id} display="flex" alignItems="center" mb={1}>
                  <Button
                    variant="contained"
                    color="error" // MUI equivalent for danger
                    className="mr-2"
                    title={intl.formatMessage(
                      { id: "actions.delete_entity" },
                      { entityType: intl.formatMessage({ id: "stash_id" }) }
                    )}
                    onClick={() => removeStashID(stashID)}
                    style={{ minWidth: 32, padding: "4px 8px" }}
                  >
                    <Icon icon={faTrashAlt} />
                  </Button>
                  <StashIDPill stashID={stashID} linkType={linkType} />
                </Box>
              );
            })}
          </ul>
        )}
        {addButton}
      </>
    );

    return renderField(field, title, control, props);
  }

  return {
    renderFormControl,
    renderField,
    renderInputField,
    renderSelectField,
    renderDateField,
    renderDurationField,
    renderRatingField,
    renderStringListField,
    renderURLListField,
    renderStashIDsField,
  };
}
