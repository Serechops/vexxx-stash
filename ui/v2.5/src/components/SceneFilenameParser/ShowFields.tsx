import {
  faCheck,
  faChevronDown,
  faChevronRight,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";
import React, { useState } from "react";
import { Button, Collapse, Box, Typography } from "@mui/material";
import { useIntl } from "react-intl";
import { Icon } from "src/components/Shared/Icon";

interface IShowFieldsProps {
  fields: Map<string, boolean>;
  onShowFieldsChanged: (fields: Map<string, boolean>) => void;
}

export const ShowFields: React.FC<IShowFieldsProps> = (props) => {
  const intl = useIntl();
  const [open, setOpen] = useState(false);

  function handleClick(label: string) {
    const copy = new Map<string, boolean>(props.fields);
    copy.set(label, !props.fields.get(label));
    props.onShowFieldsChanged(copy);
  }

  const fieldRows = [...props.fields.entries()].map(([label, enabled]) => (
    <Button
      fullWidth
      key={label}
      onClick={() => handleClick(label)}
      startIcon={<Icon icon={enabled ? faCheck : faTimes} color={enabled ? "success" : "error"} />}
      sx={{ justifyContent: 'flex-start', textTransform: 'none', color: 'text.primary' }}
      color="inherit"
    >
      {label}
    </Button>
  ));

  return (
    <Box>
      <Button
        onClick={() => setOpen(!open)}
        startIcon={<Icon icon={open ? faChevronDown : faChevronRight} />}
        color="inherit"
        sx={{ textTransform: 'none' }}
      >
        {intl.formatMessage({
          id: "config.tools.scene_filename_parser.display_fields",
        })}
      </Button>
      <Collapse in={open}>
        <Box sx={{ pl: 2, display: 'flex', flexDirection: 'column' }}>{fieldRows}</Box>
      </Collapse>
    </Box>
  );
};
