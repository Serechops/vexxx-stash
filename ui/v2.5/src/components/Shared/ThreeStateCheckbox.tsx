import { faCheck, faMinus, faTimes } from "@fortawesome/free-solid-svg-icons";
import React from "react";
import { Box, IconButton } from "@mui/material";
import { Icon } from "./Icon";

interface IThreeStateCheckbox {
  value: boolean | undefined;
  setValue: (v: boolean | undefined) => void;
  allowUndefined?: boolean;
  label?: React.ReactNode;
  disabled?: boolean;
}

export const ThreeStateCheckbox: React.FC<IThreeStateCheckbox> = ({
  value,
  setValue,
  allowUndefined,
  label,
  disabled = false,
}) => {
  function cycleState() {
    const undefAllowed = allowUndefined ?? true;
    if (undefAllowed && value) {
      return undefined;
    }
    if ((!undefAllowed && value) || value === undefined) {
      return false;
    }
    return true;
  }

  const icon = value === undefined ? faMinus : value ? faCheck : faTimes;
  const labelClassName =
    value === undefined ? "unset" : value ? "checked" : "not-checked";

  return (
    <Box
      component="span"
      className={labelClassName}
      sx={{
        display: "flex",
        alignItems: "center",
        "&.unset .label": {
          color: "text.disabled",
          textDecoration: "line-through",
        },
        "&.checked svg": {
          color: "success.main",
        },
        "&.not-checked svg": {
          color: "error.main",
        }
      }}
    >
      <IconButton
        onClick={() => setValue(cycleState())}
        disabled={disabled}
        size="small"
        sx={{
          fontSize: "12.67px",
          marginLeft: "-0.2em",
          marginRight: "0.25rem",
          padding: 0,
          "&:active, &:focus, &:hover": {
            backgroundColor: "transparent",
            boxShadow: "none"
          }
        }}
      >
        <Icon icon={icon} className="fa-fw" />
      </IconButton>
      <span className="label">{label}</span>
    </Box>
  );
};
