import React from "react";
import { Box, TextField, IconButton, InputAdornment } from "@mui/material";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import { useIntl } from "react-intl";
import { Icon } from "./Icon";
import useFocus from "src/utils/focus";
import cx from "classnames";

interface IClearableInput {
  className?: string;
  value: string;
  setValue: (value: string) => void;
  focus?: ReturnType<typeof useFocus>;
  placeholder?: string;
}

export const ClearableInput: React.FC<IClearableInput> = ({
  className,
  value,
  setValue,
  focus,
  placeholder,
}) => {
  const intl = useIntl();

  const [defaultQueryRef, setQueryFocusDefault] = useFocus();
  const [queryRef, setQueryFocus] = focus || [
    defaultQueryRef,
    setQueryFocusDefault,
  ];
  const queryClearShowing = !!value;

  function onChangeQuery(event: React.ChangeEvent<HTMLInputElement>) {
    setValue(event.currentTarget.value);
  }

  function onClearQuery() {
    setValue("");
    setQueryFocus();
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      queryRef.current?.blur();
    }
  }

  return (
    <Box
      className={className}
      sx={{
        alignItems: "stretch",
        display: "flex",
        flexWrap: "wrap",
        position: "relative",
        "& .clearable-text-field": {
          backgroundColor: "secondary.main",
          border: 0,
          borderColor: "secondary.main",
          color: "#fff",
        },
        "& .clearable-text-field:active, & .clearable-text-field:focus": {
          backgroundColor: "secondary.main",
          borderColor: "secondary.main",
          color: "#fff",
        },
        // The clear button style was .clearable-text-field-clear in shared/styles.scss
        // But here it uses InputAdornment + IconButton which is internal to TextField now ?
        // No, the original SCSS targeted .clearable-text-field-clear which was likely a separate button in older versions?
        // In the current `ClearableInput.tsx`, it uses `InputAdornment` with `IconButton`.
        // The `IconButton` inside `InputAdornment` doesn't have `clearable-text-field-clear` class.
        // Ah, wait. `Shared/styles.scss` has `.clearable-text-field-clear` class style.
        // But providing `InputProps={{ endAdornment: ... }}` usually puts it inside the input.
        // Let's check if the component actually used that class.
        // Component code:
        /*
          <IconButton
            onClick={onClearQuery}
            title={intl.formatMessage({ id: "actions.clear" })}
            size="small"
            edge="end"
          >
        */
        // It does NOT use `clearable-text-field-clear` class name.
        // So that SCSS might be obsolete or targeting another component?
        // Or maybe `ClearableInput` was refactored previously but styles remained?
        // Wait, there is a `ClearableTextField` component potentially?
        // `clearable-text-field` is used as className on TextField.
      }}
    >
      <TextField
        inputRef={queryRef}
        placeholder={placeholder}
        value={value}
        onChange={onChangeQuery}
        onKeyDown={onInputKeyDown}
        className="clearable-text-field"
        variant="outlined"
        size="small"
        fullWidth
        sx={{
          "& .MuiInputBase-root": {
            // If we want to mimic the `secondary` background
            backgroundColor: "secondary.main",
            color: "#fff", // Text color
            "& fieldset": {
              border: 'none', // Remove border if SCSS said border: 0
            },
            "&:hover fieldset": {
              border: 'none',
            },
            "&.Mui-focused fieldset": {
              border: 'none',
            }
          },
          "& .MuiInputBase-input": {
            color: "#fff",
          }
        }}
        InputProps={{
          endAdornment: queryClearShowing ? (
            <InputAdornment position="end">
              <IconButton
                onClick={onClearQuery}
                title={intl.formatMessage({ id: "actions.clear" })}
                size="small"
                edge="end"
                sx={{
                  color: "text.secondary", // Muted gray approx
                  "&:hover": {
                    backgroundColor: "secondary.main", // Match input bg? SCSS had transparent/secondary
                  }
                }}
              >
                <Icon icon={faTimes} />
              </IconButton>
            </InputAdornment>
          ) : null,
        }}
      />
    </Box>
  );
};

export default ClearableInput;
