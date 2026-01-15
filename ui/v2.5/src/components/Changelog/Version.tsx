import { faAngleDown, faAngleUp } from "@fortawesome/free-solid-svg-icons";
import React, { useState } from "react";
import { Button, Paper, Collapse, Box, Typography } from "@mui/material";
import { FormattedDate, FormattedMessage } from "react-intl";
import { Icon } from "src/components/Shared/Icon";

interface IVersionProps {
  version: string;
  date?: string;
  defaultOpen?: boolean;
  setOpenState: (key: string, state: boolean) => void;
  openState: Record<string, boolean>;
}

const Version: React.FC<IVersionProps> = ({
  version,
  date,
  defaultOpen,
  openState,
  setOpenState,
  children,
}) => {
  const [open, setOpen] = useState(
    defaultOpen ?? openState[version + date] ?? false
  );

  const updateState = () => {
    setOpenState(version + date, !open);
    setOpen(!open);
  };

  return (
    <Paper className="changelog-version" sx={{ mb: 2 }}>
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" className="changelog-version-header d-flex align-items-center">
          <Button onClick={updateState} variant="text">
            <Icon icon={open ? faAngleUp : faAngleDown} className="mr-3" />
            {version} (
            {date ? (
              <FormattedDate value={date} timeZone="utc" />
            ) : (
              <FormattedMessage
                defaultMessage="Development Version"
                id="developmentVersion"
              />
            )}
            )
          </Button>
        </Typography>
      </Box>
      <Box sx={{ px: 2, pb: 2 }}>
        <Collapse in={open}>
          <div className="changelog-version-body markdown">{children}</div>
        </Collapse>
      </Box>
    </Paper>
  );
};

export default Version;
