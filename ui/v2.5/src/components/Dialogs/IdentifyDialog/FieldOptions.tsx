import React, { useState, useEffect, useCallback } from "react";
import { Box, Table, TableBody, TableCell, TableHead, TableRow, IconButton, Radio, RadioGroup, FormControlLabel, FormControl, Typography } from "@mui/material";
import { Icon } from "src/components/Shared/Icon";
import * as GQL from "src/core/generated-graphql";
import { FormattedMessage, useIntl } from "react-intl";
import {
  multiValueSceneFields,
  SceneField,
  sceneFieldMessageID,
  sceneFields,
} from "./constants";
import { ThreeStateBoolean } from "./ThreeStateBoolean";
import {
  faCheck,
  faPencilAlt,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";

interface IFieldOptionsEditor {
  options: GQL.IdentifyFieldOptions | undefined;
  field: SceneField;
  editField: () => void;
  editOptions: (o?: GQL.IdentifyFieldOptions | null) => void;
  editing: boolean;
  allowSetDefault: boolean;
  defaultOptions?: GQL.IdentifyMetadataOptionsInput;
}

interface IFieldOptions {
  field: string;
  strategy: GQL.IdentifyFieldStrategy | undefined;
  createMissing?: GQL.Maybe<boolean> | undefined;
}

const FieldOptionsEditor: React.FC<IFieldOptionsEditor> = ({
  options,
  field,
  editField,
  editOptions,
  editing,
  allowSetDefault,
  defaultOptions,
}) => {
  const intl = useIntl();

  const [localOptions, setLocalOptions] = useState<IFieldOptions>();

  const resetOptions = useCallback(() => {
    let toSet: IFieldOptions;
    if (!options) {
      // unset - use default values
      toSet = {
        field,
        strategy: undefined,
        createMissing: undefined,
      };
    } else {
      toSet = {
        field,
        strategy: options.strategy,
        createMissing: options.createMissing,
      };
    }
    setLocalOptions(toSet);
  }, [options, field]);

  useEffect(() => {
    resetOptions();
  }, [resetOptions]);

  function renderField() {
    return intl.formatMessage({ id: sceneFieldMessageID(field) });
  }

  function renderStrategy() {
    if (!localOptions) {
      return;
    }

    const strategies = Object.entries(GQL.IdentifyFieldStrategy);
    let { strategy } = localOptions;
    if (strategy === undefined) {
      if (!allowSetDefault) {
        strategy = GQL.IdentifyFieldStrategy.Merge;
      }
    }

    if (!editing) {
      if (strategy === undefined) {
        return intl.formatMessage({ id: "actions.use_default" });
      }

      const f = strategies.find((s) => s[1] === strategy);
      return intl.formatMessage({
        id: `actions.${f![0].toLowerCase()}`,
      });
    }

    return (
      <FormControl component="fieldset">
        <RadioGroup
          name={`${field}-strategy`}
          value={strategy === undefined ? "default" : strategy}
          onChange={(e) => {
            const val = e.target.value;
            setLocalOptions({
              ...localOptions,
              strategy: val === "default" ? undefined : (val as GQL.IdentifyFieldStrategy),
            });
          }}
        >
          {allowSetDefault && (
            <FormControlLabel
              value="default"
              control={<Radio size="small" />}
              label={intl.formatMessage({ id: "actions.use_default" })}
              disabled={!editing}
            />
          )}
          {strategies.map((f) => (
            <FormControlLabel
              key={f[0]}
              value={f[1]}
              control={<Radio size="small" />}
              label={intl.formatMessage({ id: `actions.${f[0].toLowerCase()}` })}
              disabled={!editing}
            />
          ))}
        </RadioGroup>
      </FormControl>
    );
  }

  function maybeRenderCreateMissing() {
    if (!localOptions) {
      return;
    }

    if (
      multiValueSceneFields.includes(localOptions.field as SceneField) &&
      localOptions.strategy !== GQL.IdentifyFieldStrategy.Ignore
    ) {
      const value =
        localOptions.createMissing === null
          ? undefined
          : localOptions.createMissing;

      if (!editing) {
        if (value === undefined && allowSetDefault) {
          return intl.formatMessage({ id: "actions.use_default" });
        }
        if (value) {
          return <Icon icon={faCheck} color="success" />;
        }

        return <Icon icon={faTimes} color="error" />;
      }

      const defaultVal = defaultOptions?.fieldOptions?.find(
        (f) => f.field === localOptions.field
      )?.createMissing;

      // if allowSetDefault is false, then strategy is considered merge
      // if its true, then its using the default value and should not be shown here
      if (localOptions.strategy === undefined && allowSetDefault) {
        return;
      }

      return (
        <ThreeStateBoolean
          id="create-missing"
          disabled={!editing}
          allowUndefined={allowSetDefault}
          value={value}
          setValue={(v) =>
            setLocalOptions({ ...localOptions, createMissing: v })
          }
          defaultValue={defaultVal ?? undefined}
        />
      );
    }
  }

  function onEditOptions() {
    if (!localOptions) {
      return;
    }

    const localOptionsCopy = { ...localOptions };
    if (localOptionsCopy.strategy === undefined && !allowSetDefault) {
      localOptionsCopy.strategy = GQL.IdentifyFieldStrategy.Merge;
    }

    // send null if strategy is undefined
    if (localOptionsCopy.strategy === undefined) {
      editOptions(null);
      resetOptions();
    } else {
      let { createMissing } = localOptionsCopy;
      if (createMissing === undefined && !allowSetDefault) {
        createMissing = false;
      }

      editOptions({
        ...localOptionsCopy,
        strategy: localOptionsCopy.strategy,
        createMissing,
      });
    }
  }

  return (
    <TableRow>
      <TableCell>{renderField()}</TableCell>
      <TableCell>{renderStrategy()}</TableCell>
      <TableCell>{maybeRenderCreateMissing()}</TableCell>
      <TableCell align="right">
        {editing ? (
          <>
            <IconButton
              className="minimal"
              color="success"
              onClick={() => onEditOptions()}
              size="small"
            >
              <Icon icon={faCheck} />
            </IconButton>
            <IconButton
              className="minimal"
              color="error"
              onClick={() => {
                editOptions();
                resetOptions();
              }}
              size="small"
            >
              <Icon icon={faTimes} />
            </IconButton>
          </>
        ) : (
          <>
            <IconButton className="minimal" onClick={() => editField()} size="small">
              <Icon icon={faPencilAlt} />
            </IconButton>
          </>
        )}
      </TableCell>
    </TableRow>
  );
};

interface IFieldOptionsList {
  fieldOptions?: GQL.IdentifyFieldOptions[];
  setFieldOptions: (o: GQL.IdentifyFieldOptions[]) => void;
  setEditingField: (v: boolean) => void;
  allowSetDefault?: boolean;
  defaultOptions?: GQL.IdentifyMetadataOptionsInput;
}

export const FieldOptionsList: React.FC<IFieldOptionsList> = ({
  fieldOptions,
  setFieldOptions,
  setEditingField,
  allowSetDefault = true,
  defaultOptions,
}) => {
  const [localFieldOptions, setLocalFieldOptions] =
    useState<GQL.IdentifyFieldOptions[]>();
  const [editField, setEditField] = useState<string | undefined>();

  useEffect(() => {
    if (fieldOptions) {
      setLocalFieldOptions([...fieldOptions]);
    } else {
      setLocalFieldOptions([]);
    }
  }, [fieldOptions]);

  function handleEditOptions(o?: GQL.IdentifyFieldOptions | null) {
    if (!localFieldOptions) {
      return;
    }

    if (o !== undefined) {
      const newOptions = [...localFieldOptions];
      const index = newOptions.findIndex(
        (option) => option.field === editField
      );
      if (index !== -1) {
        // if null, then we're removing
        if (o === null) {
          newOptions.splice(index, 1);
        } else {
          // replace in list
          newOptions.splice(index, 1, o);
        }
      } else if (o !== null) {
        // don't add if null
        newOptions.push(o);
      }

      setFieldOptions(newOptions);
    }

    setEditField(undefined);
    setEditingField(false);
  }

  function onEditField(field: string) {
    setEditField(field);
    setEditingField(true);
  }

  if (!localFieldOptions) {
    return <></>;
  }

  return (
    <Box className="scraper-sources" sx={{ mt: 3 }}>
      <Typography variant="h5" gutterBottom>
        <FormattedMessage id="config.tasks.identify.field_options" />
      </Typography>
      <Table className="field-options-table" size="small">
        <TableHead>
          <TableRow>
            <TableCell width="25%">
              <FormattedMessage id="config.tasks.identify.field" />
            </TableCell>
            <TableCell width="25%">
              <FormattedMessage id="config.tasks.identify.strategy" />
            </TableCell>
            <TableCell width="25%">
              <FormattedMessage id="config.tasks.identify.create_missing" />
            </TableCell>
            {/* eslint-disable-next-line jsx-a11y/control-has-associated-label */}
            <TableCell width="25%" />
          </TableRow>
        </TableHead>
        <TableBody>
          {sceneFields.map((f) => (
            <FieldOptionsEditor
              key={f}
              field={f}
              allowSetDefault={allowSetDefault}
              options={localFieldOptions.find((o) => o.field === f)}
              editField={() => onEditField(f)}
              editOptions={handleEditOptions}
              editing={f === editField}
              defaultOptions={defaultOptions}
            />
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};
