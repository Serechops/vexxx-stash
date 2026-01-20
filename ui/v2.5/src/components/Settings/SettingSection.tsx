import React, { PropsWithChildren } from "react";
import { Box, Card, Typography } from "@mui/material";
import { useIntl } from "react-intl";
import { useSettings } from "./context";

interface ISettingGroup {
  id?: string;
  headingID?: string;
  subHeadingID?: string;
  advanced?: boolean;
}

export const SettingSection: React.FC<PropsWithChildren<ISettingGroup>> = ({
  id,
  children,
  headingID,
  subHeadingID,
  advanced,
}) => {
  const intl = useIntl();
  const { advancedMode } = useSettings();

  if (advanced && !advancedMode) return null;

  return (
    <Box
      component="section"
      id={id}
      className="setting-section"
    >
      <Typography variant="h4" component="h1" className="setting-section-header">
        {headingID ? intl.formatMessage({ id: headingID }) : undefined}
      </Typography>
      {subHeadingID ? (
        <Typography
          variant="body2"
          className="setting-section-subheader"
        >
          {intl.formatMessage({ id: subHeadingID })}
        </Typography>
      ) : undefined}
      <Card>{children}</Card>
    </Box>
  );
};
