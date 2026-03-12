import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import WarningIcon from "@mui/icons-material/Warning";
import {
  Box,
  Button,
  Collapse,
  IconButton,
  Paper,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useCallback, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { HandyAPIv3 } from "src/hooks/Interactive/handy-api-v3";
import { IInteractiveClient } from "src/hooks/Interactive/utils";

interface IProps {
  client: IInteractiveClient;
  show: boolean;
}

export const InteractiveControls: React.FC<IProps> = ({ client, show }) => {
  const intl = useIntl();
  const [expanded, setExpanded] = useState(false);
  const [hampMode, setHampMode] = useState(false);
  const [velocity, setVelocity] = useState(50);
  const [strokeRange, setStrokeRange] = useState<[number, number]>([0, 100]);

  const handleEmergencyStop = useCallback(async () => {
    try {
      await client.emergencyStop?.();
    } catch {
      // best-effort
    }
  }, [client]);

  const toggleHampMode = useCallback(async () => {
    if (!client.hasV3Capabilities) return;
    try {
      if (!hampMode) {
        await client.setMode?.(HandyAPIv3.MODE.HAMP);
        await client.hampStart?.();
        setHampMode(true);
      } else {
        await client.hampStop?.();
        await client.setMode?.(HandyAPIv3.MODE.HSSP);
        setHampMode(false);
      }
    } catch {
      // best-effort
    }
  }, [client, hampMode]);

  const handleVelocityChange = useCallback(
    async (_: Event, value: number | number[]) => {
      const v = Array.isArray(value) ? value[0] : value;
      setVelocity(v);
      try {
        await client.setHampVelocity?.(v);
      } catch {
        // best-effort
      }
    },
    [client]
  );

  const handleStrokeChange = useCallback(
    async (_: Event, value: number | number[]) => {
      if (!Array.isArray(value)) return;
      const [min, max] = value as [number, number];
      setStrokeRange([min, max]);
      try {
        await client.setHampStroke?.(min / 100, max / 100);
      } catch {
        // best-effort
      }
    },
    [client]
  );

  if (!show || !client.hasV3Capabilities) return null;

  return (
    <Box
      sx={{
        position: "absolute",
        bottom: 0,
        right: 0,
        zIndex: 10,
        m: 1,
      }}
    >
      <Paper
        elevation={4}
        sx={{
          bgcolor: "rgba(0,0,0,0.75)",
          color: "white",
          borderRadius: 1,
          overflow: "hidden",
          minWidth: 240,
        }}
      >
        {/* header row */}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 1 }}
        >
          <Typography variant="caption" sx={{ fontWeight: "bold", py: 0.5 }}>
            <FormattedMessage id="handy_controls.interactive_controls" />
          </Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Tooltip
              title={intl.formatMessage({
                id: "handy_controls.emergency_stop",
              })}
            >
              <IconButton
                size="small"
                color="error"
                onClick={handleEmergencyStop}
              >
                <WarningIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <IconButton
              size="small"
              sx={{ color: "white" }}
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? (
                <ExpandLessIcon fontSize="small" />
              ) : (
                <ExpandMoreIcon fontSize="small" />
              )}
            </IconButton>
          </Stack>
        </Stack>

        {/* expandable controls */}
        <Collapse in={expanded}>
          <Box sx={{ px: 2, pb: 1.5 }}>
            {/* HAMP mode toggle */}
            <Button
              size="small"
              variant={hampMode ? "contained" : "outlined"}
              color={hampMode ? "primary" : "inherit"}
              onClick={toggleHampMode}
              sx={{
                mb: 1,
                width: "100%",
                color: hampMode ? undefined : "white",
                borderColor: "rgba(255,255,255,0.5)",
              }}
            >
              <FormattedMessage id="handy_controls.hamp_mode" />
            </Button>

            {hampMode && (
              <>
                {/* Velocity slider */}
                <Typography variant="caption" display="block">
                  <FormattedMessage id="handy_controls.hamp_velocity" />:{" "}
                  {velocity}%
                </Typography>
                <Slider
                  size="small"
                  min={0}
                  max={100}
                  value={velocity}
                  onChange={handleVelocityChange}
                  sx={{ color: "white" }}
                />

                {/* Stroke zone range slider */}
                <Typography variant="caption" display="block">
                  <FormattedMessage id="handy_controls.stroke_zone" />
                </Typography>
                <Slider
                  size="small"
                  min={0}
                  max={100}
                  value={strokeRange}
                  onChange={handleStrokeChange}
                  sx={{ color: "white" }}
                />
              </>
            )}
          </Box>
        </Collapse>
      </Paper>
    </Box>
  );
};

export default InteractiveControls;
