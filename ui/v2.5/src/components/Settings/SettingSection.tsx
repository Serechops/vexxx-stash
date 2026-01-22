import React, { PropsWithChildren } from "react";
import { Box, Card, Typography } from "@mui/material";
import { useIntl } from "react-intl";
import { useSettings } from "./context";

interface ISettingGroup {
  id?: string;
  headingID?: string;
  headingDefault?: string;
  subHeadingID?: string;
  subHeadingDefault?: string;
  advanced?: boolean;
}

export const SettingSection: React.FC<PropsWithChildren<ISettingGroup>> = ({
  id,
  children,
  headingID,
  headingDefault,
  subHeadingID,
  subHeadingDefault,
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
        {headingID ? intl.formatMessage({ id: headingID, defaultMessage: headingDefault }) : headingDefault}
      </Typography>
      {subHeadingID || subHeadingDefault ? (
        <Typography
          variant="body2"
          className="setting-section-subheader"
        >
          {subHeadingID ? intl.formatMessage({ id: subHeadingID, defaultMessage: subHeadingDefault }) : subHeadingDefault}
        </Typography>
      ) : undefined}
      <Card>{children}</Card>
    </Box>
  );
};
