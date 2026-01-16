import React, { useMemo, useState } from "react";
import { Button, ButtonGroup, TextField, InputAdornment, Box, FormHelperText } from "@mui/material";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import TextUtils from "src/utils/text";

interface IProps {
  disabled?: boolean;
  value: number | null | undefined;
  setValue(value: number | null): void;
  onReset?(): void;
  className?: string;
  placeholder?: string;
  error?: string;
  allowNegative?: boolean;
}

const includeMS = true;

export const DurationInput: React.FC<IProps> = ({
  disabled,
  value,
  setValue,
  onReset,
  className,
  placeholder,
  error,
  allowNegative = false,
}) => {
  const [tmpValue, setTmpValue] = useState<string>();

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    setTmpValue(e.currentTarget.value);
  }

  function onBlur() {
    if (tmpValue !== undefined) {
      updateValue(TextUtils.timestampToSeconds(tmpValue));
      setTmpValue(undefined);
    }
  }

  function updateValue(v: number | null) {
    if (v !== null && !allowNegative && v < 0) {
      v = null;
    }
    setValue(v);
  }

  function increment() {
    setTmpValue(undefined);
    updateValue((value ?? 0) + 1);
  }

  function decrement() {
    setTmpValue(undefined);
    if (allowNegative) {
      updateValue((value ?? 0) - 1);
    } else {
      updateValue(value ? value - 1 : 0);
    }
  }

  function renderButtons() {
    if (!disabled) {
      return (
        <ButtonGroup orientation="vertical" size="small">
          <Button
            variant="outlined"
            color="secondary"
            onClick={() => increment()}
            sx={{
              padding: "1px 7px",
              lineHeight: "10px",
              minWidth: "3rem",
              borderBottomLeftRadius: 0,
              borderTopLeftRadius: 0,
            }}
          >
            <KeyboardArrowUpIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            onClick={() => decrement()}
            sx={{
              padding: "1px 7px",
              lineHeight: "10px",
              minWidth: "3rem",
              borderBottomLeftRadius: 0,
              borderTopLeftRadius: 0,
              marginLeft: "0 !important", // Override ButtonGroup margin
            }}
          >
            <KeyboardArrowDownIcon fontSize="small" />
          </Button>
        </ButtonGroup>
      );
    }
  }

  function maybeRenderReset() {
    if (onReset) {
      return (
        <Button variant="outlined" color="secondary" onClick={() => onReset()} size="small">
          <AccessTimeIcon fontSize="small" />
        </Button>
      );
    }
  }

  const inputValue = useMemo(() => {
    if (tmpValue !== undefined) {
      return tmpValue;
    } else if (value !== null && value !== undefined) {
      return TextUtils.secondsToTimestamp(value, includeMS);
    }
    return "";
  }, [value, tmpValue]);

  const format = "hh:mm:ss.ms";

  if (placeholder) {
    placeholder = `${placeholder} (${format})`;
  } else {
    placeholder = format;
  }

  return (
    <Box className={className} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
      <TextField
        className="text-input"
        disabled={disabled}
        value={inputValue}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        error={!!error}
        helperText={error}
        size="small"
        variant="outlined"
        sx={{
          "& .MuiInputBase-root": {
            paddingRight: disabled ? undefined : 0,
          }
        }}
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
