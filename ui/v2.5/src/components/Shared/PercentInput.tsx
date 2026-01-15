import {
  faChevronDown,
  faChevronUp,
  faClock,
} from "@fortawesome/free-solid-svg-icons";
import React, { useState, useEffect } from "react";
import { Button, ButtonGroup, TextField, InputAdornment, Box } from "@mui/material";
import { Icon } from "./Icon";
import PercentUtils from "src/utils/percent";

interface IProps {
  disabled?: boolean;
  numericValue: number | undefined;
  mandatory?: boolean;
  onValueChange(
    valueAsNumber: number | undefined,
    valueAsString?: string
  ): void;
  onReset?(): void;
  className?: string;
  placeholder?: string;
}

export const PercentInput: React.FC<IProps> = (props: IProps) => {
  const [value, setValue] = useState<string | undefined>(
    props.numericValue !== undefined
      ? PercentUtils.numberToString(props.numericValue)
      : undefined
  );

  useEffect(() => {
    if (props.numericValue !== undefined || props.mandatory) {
      setValue(PercentUtils.numberToString(props.numericValue ?? 0));
    } else {
      setValue(undefined);
    }
  }, [props.numericValue, props.mandatory]);

  function increment() {
    if (value === undefined) {
      return;
    }

    let percent = PercentUtils.stringToNumber(value);
    if (percent >= 100) {
      percent = 0;
    } else {
      percent += 1;
    }
    props.onValueChange(percent, PercentUtils.numberToString(percent));
  }

  function decrement() {
    if (value === undefined) {
      return;
    }

    let percent = PercentUtils.stringToNumber(value);
    if (percent <= 0) {
      percent = 100;
    } else {
      percent -= 1;
    }
    props.onValueChange(percent, PercentUtils.numberToString(percent));
  }

  function renderButtons() {
    if (!props.disabled) {
      return (
        <ButtonGroup orientation="vertical" size="small">
          <Button
            variant="outlined"
            color="secondary"
            className="percent-button"
            disabled={props.disabled}
            onClick={() => increment()}
          >
            <Icon icon={faChevronUp} />
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            className="percent-button"
            disabled={props.disabled}
            onClick={() => decrement()}
          >
            <Icon icon={faChevronDown} />
          </Button>
        </ButtonGroup>
      );
    }
  }

  function onReset() {
    if (props.onReset) {
      props.onReset();
    }
  }

  function maybeRenderReset() {
    if (props.onReset) {
      return (
        <Button variant="outlined" color="secondary" onClick={onReset} size="small">
          <Icon icon={faClock} />
        </Button>
      );
    }
  }

  return (
    <Box className={`percent-input ${props.className}`} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
      <TextField
        className="percent-control text-input"
        disabled={props.disabled}
        value={value ?? 0}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          setValue(e.currentTarget.value)
        }
        onBlur={() => {
          if (props.mandatory || (value !== undefined && value !== "")) {
            props.onValueChange(PercentUtils.stringToNumber(value), value);
          } else {
            props.onValueChange(undefined);
          }
        }}
        placeholder={
          !props.disabled
            ? props.placeholder
              ? `${props.placeholder} (%)`
              : "%"
            : undefined
        }
        size="small"
        variant="outlined"
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              {maybeRenderReset()}
            </InputAdornment>
          ),
        }}
      />
      {renderButtons()}
    </Box>
  );
};
