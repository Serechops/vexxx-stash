import { faChevronDown, faChevronUp } from "@fortawesome/free-solid-svg-icons";
import React, { PropsWithChildren, useState } from "react";
import {
  Button,
  Collapse,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Switch,
  TextField,
  FormControlLabel,
  Select,
  MenuItem,
  FormControl,
  IconButton,
  Box,
  Typography,
} from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import { Icon } from "../Shared/Icon";
import { StringListInput } from "../Shared/StringListInput";
import { PatchComponent } from "src/patch";
import { useSettings, useSettingsOptional } from "./context";
import { NumberField } from "src/utils/form";

interface ISetting {
  id?: string;
  advanced?: boolean;
  className?: string;
  heading?: React.ReactNode;
  headingID?: string;
  subHeadingID?: string;
  subHeading?: React.ReactNode;
  tooltipID?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  disabled?: boolean;
}

export const Setting: React.FC<PropsWithChildren<ISetting>> = PatchComponent(
  "Setting",
  (props: PropsWithChildren<ISetting>) => {
    const {
      id,
      className,
      heading,
      headingID,
      subHeadingID,
      subHeading,
      children,
      tooltipID,
      onClick,
      disabled,
      advanced,
    } = props;

    const { advancedMode } = useSettingsOptional();
    const intl = useIntl();

    function renderHeading() {
      if (headingID) {
        return intl.formatMessage({ id: headingID });
      }
      return heading;
    }

    function renderSubHeading() {
      if (subHeadingID) {
        return (
          <Typography variant="caption" color="textSecondary" className="setting-subheader">
            {intl.formatMessage({ id: subHeadingID })}
          </Typography>
        );
      }
      if (subHeading) {
        return <Typography variant="caption" color="textSecondary" className="setting-subheader">{subHeading}</Typography>;
      }
    }

    const tooltip = tooltipID
      ? intl.formatMessage({ id: tooltipID })
      : undefined;

    if (advanced && !advancedMode) return null;

    return (
      <Box
        id={id}
        onClick={onClick}
        className={`setting-item ${className || ''} ${disabled ? 'disabled' : ''} ${className?.includes('sub-setting') ? 'sub-setting' : ''}`}
      >
        <Box>
          <Typography variant="h6" component="h3" title={tooltip} className="setting-header">{renderHeading()}</Typography>
          {renderSubHeading()}
        </Box>
        <Box className={`setting-action-container ${className?.includes('setting') ? 'setting' : ''}`}>{children}</Box>
      </Box>
    );
  }
) as React.FC<PropsWithChildren<ISetting>>;

interface ISettingGroup {
  settingProps?: ISetting;
  topLevel?: JSX.Element;
  collapsible?: boolean;
  collapsedDefault?: boolean;
}

export const SettingGroup: React.FC<PropsWithChildren<ISettingGroup>> =
  PatchComponent(
    "SettingGroup",
    ({ settingProps, topLevel, collapsible, collapsedDefault, children }) => {
      const [open, setOpen] = useState(!collapsedDefault);

      function renderCollapseButton() {
        if (!collapsible) return;

        return (
          <IconButton
            size="small"
            onClick={() => setOpen(!open)}
            className="setting-group-collapse-btn"
          >
            <Icon className="fa-fw" icon={open ? faChevronUp : faChevronDown} />
          </IconButton>
        );
      }

      function onDivClick(e: React.MouseEvent<HTMLDivElement>) {
        if (!collapsible) return;

        // ensure button was not clicked
        let target: HTMLElement | null = e.target as HTMLElement;
        while (target && target !== e.currentTarget) {
          if (
            target.nodeName.toLowerCase() === "button" ||
            target.nodeName.toLowerCase() === "a" ||
            target.nodeName.toLowerCase() === "input" ||
            target.nodeName.toLowerCase() === "label"
          ) {
            // interactive element clicked, swallow event
            return;
          }
          target = target.parentElement;
        }

        setOpen(!open);
      }

      return (
        <Box
          className={`setting-group-container ${collapsible ? 'collapsible' : ''}`}
          onClick={onDivClick}
        >
          <Setting {...settingProps} onClick={() => { }} className={settingProps?.className ? `${settingProps.className} setting-group-header` : 'setting-group-header'}>
            {topLevel}
            {renderCollapseButton()}
          </Setting>
          <Collapse in={open}>
            <Box
              className="collapsible-section collapsible-section-content"
            >
              {children}
            </Box>
          </Collapse>
        </Box>
      );
    }
  );

interface IBooleanSetting extends ISetting {
  id: string;
  checked?: boolean;
  onChange: (v: boolean) => void;
}

export const BooleanSetting: React.FC<IBooleanSetting> = PatchComponent(
  "BooleanSetting",
  (props) => {
    const { id, disabled, checked, onChange, ...settingProps } = props;

    return (
      <Setting {...settingProps} disabled={disabled}>
        <FormControlLabel
          control={
            <Switch
              id={id}
              disabled={disabled}
              checked={checked ?? false}
              onChange={() => onChange(!checked)}
            />
          }
          label=""
        />
      </Setting>
    );
  }
);

interface ISelectSetting extends ISetting {
  value?: string | number | string[];
  onChange: (v: string) => void;
}

export const SelectSetting: React.FC<PropsWithChildren<ISelectSetting>> =
  PatchComponent(
    "SelectSetting",
    ({ id, headingID, subHeadingID, value, children, onChange, advanced }) => {
      return (
        <Setting
          advanced={advanced}
          headingID={headingID}
          subHeadingID={subHeadingID}
          id={id}
        >
          <FormControl variant="standard" fullWidth className="input-control">
            <Select
              native
              value={value ?? ""}
              onChange={(e) => onChange(e.target.value as string)}
              inputProps={{
                className: "text-input",
              }}
              sx={{ backgroundColor: "transparent" }}
            >
              {children}
            </Select>
          </FormControl>
        </Setting>
      );
    }
  );

interface IDialogSetting<T> extends ISetting {
  buttonText?: string;
  buttonTextID?: string;
  value?: T;
  renderValue?: (v: T | undefined) => JSX.Element;
  onChange: () => void;
}
const _ChangeButtonSetting = <T extends {}>(props: IDialogSetting<T>) => {
  const {
    id,
    className,
    headingID,
    heading,
    tooltipID,
    subHeadingID,
    subHeading,
    value,
    onChange,
    renderValue,
    buttonText,
    buttonTextID,
    disabled,
  } = props;
  const intl = useIntl();

  const tooltip = tooltipID ? intl.formatMessage({ id: tooltipID }) : undefined;

  return (
    <Box
      className={`setting setting-item ${className ?? ""}`}
      id={id}
    >
      <Box>
        <Typography variant="h6" component="h3" title={tooltip} className="setting-header">
          {headingID
            ? intl.formatMessage({ id: headingID })
            : heading
              ? heading
              : undefined}
        </Typography>

        <Box className="value setting-value">
          {renderValue ? renderValue(value) : undefined}
        </Box>

        {subHeadingID ? (
          <Typography variant="caption" color="textSecondary" className="setting-subheader">
            {intl.formatMessage({ id: subHeadingID })}
          </Typography>
        ) : subHeading ? (
          <Typography variant="caption" color="textSecondary" className="setting-subheader">{subHeading}</Typography>
        ) : undefined}
      </Box>
      <Box>
        <Button variant="contained" onClick={() => onChange()} disabled={disabled}>
          {buttonText ? (
            buttonText
          ) : (
            <FormattedMessage id={buttonTextID ?? "actions.edit"} />
          )}
        </Button>
      </Box>
    </Box>
  );
};

export const ChangeButtonSetting = PatchComponent(
  "ChangeButtonSetting",
  _ChangeButtonSetting
) as typeof _ChangeButtonSetting;

export interface ISettingModal<T> {
  heading?: React.ReactNode;
  headingID?: string;
  subHeadingID?: string;
  subHeading?: React.ReactNode;
  value: T | undefined;
  close: (v?: T) => void;
  renderField: (
    value: T | undefined,
    setValue: (v?: T) => void,
    error?: string
  ) => JSX.Element;
  modalProps?: any; // MUI Dialog doesn't match React-Bootstrap ModalProps exactly, use any or omit
  validate?: (v: T) => boolean | undefined;
  error?: string | undefined;
}

const _SettingModal = <T extends {}>(props: ISettingModal<T>) => {
  const {
    heading,
    headingID,
    subHeading,
    subHeadingID,
    value,
    close,
    renderField,
    modalProps,
    validate,
    error,
  } = props;

  const intl = useIntl();
  const [currentValue, setCurrentValue] = useState<T | undefined>(value);

  return (
    <Dialog open onClose={() => close()} id="setting-dialog" {...modalProps}>
      <form
        onSubmit={(e) => {
          close(currentValue);
          e.preventDefault();
        }}
      >
        <DialogTitle>
          {headingID ? <FormattedMessage id={headingID} /> : heading}
        </DialogTitle>
        <DialogContent dividers>
          {renderField(currentValue, setCurrentValue, error)}
          {subHeadingID ? (
            <div className="sub-heading">
              {intl.formatMessage({ id: subHeadingID })}
            </div>
          ) : subHeading ? (
            <div className="sub-heading">{subHeading}</div>
          ) : undefined}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => close()}>
            <FormattedMessage id="actions.cancel" />
          </Button>
          <Button
            type="submit"
            variant="contained"
            onClick={() => close(currentValue)}
            disabled={
              currentValue === undefined ||
              (validate && !validate(currentValue))
            }
          >
            <FormattedMessage id="actions.confirm" />
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export const SettingModal = PatchComponent(
  "SettingModal",
  _SettingModal
) as typeof _SettingModal;

interface IModalSetting<T> extends ISetting {
  value: T | undefined;
  buttonText?: string;
  buttonTextID?: string;
  onChange: (v: T) => void;
  renderField: (
    value: T | undefined,
    setValue: (v?: T) => void,
    error?: string
  ) => JSX.Element;
  renderValue?: (v: T | undefined) => JSX.Element;
  modalProps?: any;
  validateChange?: (v: T) => void | undefined;
}

export const _ModalSetting = <T extends {}>(props: IModalSetting<T>) => {
  const {
    id,
    className,
    value,
    headingID,
    heading,
    subHeadingID,
    subHeading,
    onChange,
    renderField,
    renderValue,
    tooltipID,
    buttonText,
    buttonTextID,
    modalProps,
    disabled,
    advanced,
    validateChange,
  } = props;
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string>();
  const { advancedMode } = useSettings();

  function onClose(v: T | undefined) {
    setError(undefined);
    if (v !== undefined) {
      if (validateChange) {
        try {
          validateChange(v);
        } catch (e) {
          setError((e as Error).message);
          return;
        }
      }

      onChange(v);
    }
    setShowModal(false);
  }

  if (advanced && !advancedMode) return null;

  return (
    <>
      {showModal ? (
        <SettingModal<T>
          headingID={headingID}
          subHeadingID={subHeadingID}
          heading={heading}
          subHeading={subHeading}
          value={value}
          renderField={renderField}
          close={onClose}
          error={error}
          modalProps={modalProps}
        />
      ) : undefined}

      <ChangeButtonSetting<T>
        id={id}
        className={className}
        disabled={disabled}
        buttonText={buttonText}
        buttonTextID={buttonTextID}
        headingID={headingID}
        heading={heading}
        tooltipID={tooltipID}
        subHeadingID={subHeadingID}
        subHeading={subHeading}
        value={value}
        onChange={() => setShowModal(true)}
        renderValue={renderValue}
      />
    </>
  );
};

export const ModalSetting = PatchComponent(
  "ModalSetting",
  _ModalSetting
) as typeof _ModalSetting;

interface IStringSetting extends ISetting {
  value: string | undefined;
  onChange: (v: string) => void;
  modalProps?: any;
}

export const StringSetting: React.FC<IStringSetting> = PatchComponent(
  "StringSetting",
  (props) => {
    return (
      <ModalSetting<string>
        {...props}
        modalProps={props.modalProps}
        renderField={(value, setValue) => (
          <TextField
            className="text-input"
            fullWidth
            value={value ?? ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setValue(e.currentTarget.value)
            }
          />
        )}
        renderValue={(value) => <span>{value}</span>}
      />
    );
  }
);

interface INumberSetting extends ISetting {
  value: number | undefined;
  onChange: (v: number) => void;
  modalProps?: any;
}

export const NumberSetting: React.FC<INumberSetting> = PatchComponent(
  "NumberSetting",
  (props) => {
    return (
      <ModalSetting<number>
        {...props}
        modalProps={props.modalProps}
        renderField={(value, setValue) => (
          <NumberField
            className="text-input"
            // NumberField expects value, likely OK. Might check if it accepts MUI specific props if refactored.
            // Using existing NumberField which might be legacy or migrated.
            value={value ?? 0}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setValue(Number.parseInt(e.currentTarget.value || "0", 10))
            }
          />
        )}
        renderValue={(value) => <span>{value}</span>}
      />
    );
  }
);

interface IStringListSetting extends ISetting {
  value: string[] | undefined;
  defaultNewValue?: string;
  onChange: (v: string[]) => void;
  modalProps?: any;
}

export const StringListSetting: React.FC<IStringListSetting> = PatchComponent(
  "StringListSetting",
  (props) => {
    return (
      <ModalSetting<string[]>
        {...props}
        modalProps={props.modalProps}
        renderField={(value, setValue) => (
          <StringListInput
            value={value ?? []}
            setValue={setValue}
            placeholder={props.defaultNewValue}
          />
        )}
        renderValue={(value) => (
          <div>
            {value?.map((v, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={i}>{v}</div>
            ))}
          </div>
        )}
      />
    );
  }
);

interface IConstantSetting<T> extends ISetting {
  value?: T;
  renderValue?: (v: T | undefined) => JSX.Element;
}

export const _ConstantSetting = <T extends {}>(props: IConstantSetting<T>) => {
  const { id, headingID, subHeading, subHeadingID, renderValue, value } = props;
  const intl = useIntl();

  return (
    <Box
      id={id}
      className="setting setting-item"
    >
      <Box>
        <Typography variant="h6" component="h3" className="setting-header">{headingID ? intl.formatMessage({ id: headingID }) : undefined}</Typography>

        <Box className="value setting-value">{renderValue ? renderValue(value) : value}</Box>

        {subHeadingID ? (
          <Typography variant="caption" color="textSecondary" className="setting-subheader">
            {intl.formatMessage({ id: subHeadingID })}
          </Typography>
        ) : subHeading ? (
          <Typography variant="caption" color="textSecondary" className="setting-subheader">{subHeading}</Typography>
        ) : undefined}
      </Box>
      <Box />
    </Box>
  );
};

export const ConstantSetting = PatchComponent(
  "ConstantSetting",
  _ConstantSetting
) as typeof _ConstantSetting;
