import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import React from "react";
import { FormattedMessage } from "react-intl";
import { Box } from "@mui/material";
import {
  ConnectionState,
  connectionStateLabel,
  InteractiveContext,
} from "./context";

function getStateColor(state: ConnectionState): string | undefined {
  switch (state) {
    case ConnectionState.Disconnected:
    case ConnectionState.Error:
      return "#dc3545";
    case ConnectionState.Connecting:
    case ConnectionState.Syncing:
    case ConnectionState.Uploading:
      return "#f59e0b";
    case ConnectionState.Ready:
      return "#28a745";
    default:
      return undefined;
  }
}

function isAnimated(state: ConnectionState): boolean {
  return (
    state === ConnectionState.Connecting ||
    state === ConnectionState.Syncing ||
    state === ConnectionState.Uploading
  );
}

export const SceneInteractiveStatus: React.FC = ({ }) => {
  const { state, error } = React.useContext(InteractiveContext);

  if (state === ConnectionState.Missing) {
    return <></>;
  }

  const color = getStateColor(state);
  const animated = isAnimated(state);

  return (
    <Box
      sx={{
        opacity: 0.75,
        p: '0.75rem',
        position: 'absolute',
        color: color,
        '& svg': {
          ...(animated && {
            animation: '1s ease 0s infinite alternate fadepulse',
          }),
        },
        '@keyframes fadepulse': {
          '0%': { opacity: 0.4 },
          '100%': { opacity: 1 },
        },
      }}
    >
      <FiberManualRecordIcon
        sx={{
          animation: 'pulse 1s infinite',
          fontSize: '10px',
        }}
      />
      <Box component="span" sx={{ ml: '0.5rem' }}>
        <FormattedMessage id={connectionStateLabel(state)} />
        {error && <span>: {error}</span>}
      </Box>
    </Box>
  );
};
