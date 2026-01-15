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
    sx={{ color: exclude ? 'error.main' : 'success.main' }}
    className="include-exclude-button"
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
    <Box className={`optional-field ${!exclude ? "included" : "excluded"}`}>
      <IncludeExcludeButton exclude={exclude} setExclude={setExclude} />
      {title && <span className="optional-field-title">{title}</span>}
      <Box className="optional-field-content">{children}</Box>
    </Box>
  );
};
