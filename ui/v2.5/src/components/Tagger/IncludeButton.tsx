import { faCheck, faTimes } from "@fortawesome/free-solid-svg-icons";
import React from "react";
import { IconButton, Box } from "@mui/material";
import { Icon } from "../Shared/Icon";

interface IIncludeExcludeButton {
  exclude: boolean;
  disabled?: boolean;
  setExclude: (v: boolean) => void;
}

export const IncludeExcludeButton: React.FC<IIncludeExcludeButton> = ({
  exclude,
  disabled,
  setExclude,
}) => (
  <IconButton
    onClick={() => setExclude(!exclude)}
    disabled={disabled}
    size="small"
    className="include-exclude-button"
    sx={{
      display: "inline-block",
      mr: "0.38rem",
      p: "0.2rem",
      color: exclude ? "error.main" : "success.main",
    }}
  >
    <Icon className="fa-fw" icon={exclude ? faTimes : faCheck} />
  </IconButton>
);

interface IOptionalField {
  exclude: boolean;
  title?: string;
  disabled?: boolean;
  setExclude: (v: boolean) => void;
  children?: React.ReactNode;
}

export const OptionalField: React.FC<IOptionalField> = ({
  exclude,
  setExclude,
  children,
  title,
}) => {
  return (
    <Box
      className={`optional-field ${!exclude ? "included" : "excluded"}`}
      sx={{
        alignItems: "center",
        display: "inline-flex",
        flexDirection: "row",
      }}
    >
      <IncludeExcludeButton exclude={exclude} setExclude={setExclude} />
      {title && <span>{title}</span>}
      <Box className="optional-field-content">{children}</Box>
    </Box>
  );
};
