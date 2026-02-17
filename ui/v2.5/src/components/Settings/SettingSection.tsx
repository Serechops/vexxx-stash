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
      sx={{
        '&:not(:first-of-type)': { mt: '1.5em' },
        '& .MuiCard-root': { p: 0 },
      }}
    >
      <Typography variant="h4" component="h1" sx={{ fontSize: '2rem' }}>
        {headingID ? intl.formatMessage({ id: headingID, defaultMessage: headingDefault }) : headingDefault}
      </Typography>
      {subHeadingID || subHeadingDefault ? (
        <Typography
          variant="body2"
          sx={{ fontSize: '0.8rem', mt: '0.5rem' }}
        >
          {subHeadingID ? intl.formatMessage({ id: subHeadingID, defaultMessage: subHeadingDefault }) : subHeadingDefault}
        </Typography>
      ) : undefined}
      <Card>{children}</Card>
    </Box>
  );
};
