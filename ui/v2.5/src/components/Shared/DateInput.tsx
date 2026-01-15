import { faCalendar } from "@fortawesome/free-regular-svg-icons";
import React, { forwardRef, useMemo } from "react";
import { Button, TextField, InputAdornment, Box, FormHelperText } from "@mui/material";
import ReactDatePicker from "react-datepicker";
import TextUtils from "src/utils/text";
import { Icon } from "./Icon";

import "react-datepicker/dist/react-datepicker.css";
import { useIntl } from "react-intl";
import { PatchComponent } from "src/patch";

interface IProps {
  disabled?: boolean;
  value: string;
  isTime?: boolean;
  onValueChange(value: string): void;
  placeholder?: string;
  error?: string;
}

const ShowPickerButton = forwardRef<
  HTMLButtonElement,
  {
    onClick: (event: React.MouseEvent) => void;
  }
>(({ onClick }, ref) => (
  <Button variant="outlined" color="secondary" onClick={onClick} ref={ref} size="small">
    <Icon icon={faCalendar} />
  </Button>
));

const _DateInput: React.FC<IProps> = (props: IProps) => {
  const intl = useIntl();

  const date = useMemo(() => {
    const toDate = props.isTime
      ? TextUtils.stringToFuzzyDateTime
      : TextUtils.stringToFuzzyDate;
    if (props.value) {
      const ret = toDate(props.value);
      if (ret && !Number.isNaN(ret.getTime())) {
        return ret;
      }
    }
  }, [props.value, props.isTime]);

  function maybeRenderButton() {
    if (!props.disabled) {
      const dateToString = props.isTime
        ? TextUtils.dateTimeToString
        : TextUtils.dateToString;

      return (
        <ReactDatePicker
          selected={date}
          onChange={(v) => {
            props.onValueChange(v ? dateToString(v) : "");
          }}
          customInput={<ShowPickerButton onClick={() => { }} />}
          showMonthDropdown
          showYearDropdown
          scrollableMonthYearDropdown
          scrollableYearDropdown
          maxDate={new Date()}
          yearDropdownItemNumber={100}
          portalId="date-picker-portal"
          showTimeSelect={props.isTime}
        />
      );
    }
  }

  const placeholderText = intl.formatMessage({
    id: props.isTime ? "datetime_format" : "date_format",
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
        <TextField
          className="date-input text-input"
          disabled={props.disabled}
          value={props.value}
          onChange={(e) => props.onValueChange(e.target.value)}
          placeholder={
            !props.disabled
              ? props.placeholder
                ? `${props.placeholder} (${placeholderText})`
                : placeholderText
              : undefined
          }
          error={!!props.error}
          helperText={props.error}
          size="small"
          variant="outlined"
        />
        {maybeRenderButton()}
      </Box>
    </Box>
  );
};

export const DateInput = PatchComponent("DateInput", _DateInput);
