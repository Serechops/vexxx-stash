import React from "react";
import { Box, MenuItem, TextField, Typography } from "@mui/material";
import { FormattedMessage } from "react-intl";
import { StashBox } from "src/core/generated-graphql";

interface IStashBoxSelectorProps {
  stashBoxes: StashBox[];
  selectedEndpoint: string;
  onEndpointChange: (endpoint: string) => void;
}

export const StashBoxSelector: React.FC<IStashBoxSelectorProps> = ({
  stashBoxes,
  selectedEndpoint,
  onEndpointChange,
}) => {
  return (
    <TextField
      select
      size="small"
      value={selectedEndpoint}
      disabled={stashBoxes.length < 2}
      onChange={(e) => onEndpointChange(e.target.value)}
      sx={{ minWidth: 200 }}
    >
      {stashBoxes.map((i) => (
        <MenuItem value={i.endpoint} key={i.endpoint}>
          {i.endpoint}
        </MenuItem>
      ))}
    </TextField>
  );
};

export const StashBoxSelectorField: React.FC<IStashBoxSelectorProps> = (
  props
) => {
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        <FormattedMessage id="component_tagger.config.source" />
      </Typography>
      <StashBoxSelector {...props} />
    </Box>
  );
};
