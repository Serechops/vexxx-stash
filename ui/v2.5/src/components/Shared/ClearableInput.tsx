import React from "react";
import { TextField, IconButton, InputAdornment } from "@mui/material";
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
    <div className={cx("clearable-input-group", className)}>
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
        InputProps={{
          endAdornment: queryClearShowing ? (
            <InputAdornment position="end">
              <IconButton
                onClick={onClearQuery}
                title={intl.formatMessage({ id: "actions.clear" })}
                size="small"
                edge="end"
              >
                <Icon icon={faTimes} />
              </IconButton>
            </InputAdornment>
          ) : null,
        }}
      />
    </div>
  );
};

export default ClearableInput;
