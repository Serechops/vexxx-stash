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
      sx={{
        "&:not(:first-of-type)": {
          marginTop: "1.5em",
        },
        "& .MuiCard-root": {
          padding: 0,
        },
      }}
    >
      <Typography variant="h4" component="h1" sx={{ fontSize: "2rem" }}>
        {headingID ? intl.formatMessage({ id: headingID }) : undefined}
      </Typography>
      {subHeadingID ? (
        <Typography
          variant="body2"
          sx={{ fontSize: "0.8rem", marginTop: "0.5rem" }}
        >
          {intl.formatMessage({ id: subHeadingID })}
        </Typography>
      ) : undefined}
      <Card>{children}</Card>
    </Box>
  );
};
