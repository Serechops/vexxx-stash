import React, { useEffect } from "react";
import { Checkbox, CheckboxProps, FormControlLabel } from "@mui/material";

const useIndeterminate = (
  ref: React.RefObject<HTMLInputElement>,
  value: boolean | undefined
) => {
  useEffect(() => {
    if (ref.current) {
      // eslint-disable-next-line no-param-reassign
      ref.current.indeterminate = value === undefined;
    }
  }, [ref, value]);
};

interface IIndeterminateCheckbox extends CheckboxProps {
  setChecked: (v: boolean | undefined) => void;
  allowIndeterminate?: boolean;
  indeterminateClassname?: string;
  label?: React.ReactNode;
}

export const IndeterminateCheckbox: React.FC<IIndeterminateCheckbox> = ({
  checked,
  setChecked,
  allowIndeterminate,
  indeterminateClassname,
  label,
  ...props
}) => {
  const ref = React.createRef<HTMLInputElement>();

  useIndeterminate(ref, checked);

  function cycleState() {
    const undefAllowed = allowIndeterminate ?? true;
    if (undefAllowed && checked) {
      return undefined;
    }
    if ((!undefAllowed && checked) || checked === undefined) {
      return false;
    }
    return true;
  }

  return (
    <FormControlLabel
      control={
        <Checkbox
          {...props}
          className={`${props.className ?? ""} ${checked === undefined ? indeterminateClassname : ""
            }`}
          inputRef={ref}
          checked={checked ?? false}
          indeterminate={checked === undefined}
          onChange={() => setChecked(cycleState())}
        />
      }
      label={label || ""}
    />
  );
};
