import CloseIcon from "@mui/icons-material/Close";
import WarningIcon from "@mui/icons-material/Warning";
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Slider,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { IInteractiveClient } from "src/hooks/Interactive/utils";

// Patterns derived from real funscript analysis (Slibowitz PMV script)
const HDSP_PATTERNS = [
  {
    id: "slow_wave",
    labelId: "handy_modal.pattern_slow_wave",
    descId: "handy_modal.pattern_slow_wave_desc",
    posA: 0, posB: 100, intervalMs: 750, velocity: 25,
  },
  {
    id: "steady",
    labelId: "handy_modal.pattern_steady",
    descId: "handy_modal.pattern_steady_desc",
    posA: 0, posB: 100, intervalMs: 400, velocity: 50,
  },
  {
    id: "fast_pulse",
    labelId: "handy_modal.pattern_fast_pulse",
    descId: "handy_modal.pattern_fast_pulse_desc",
    posA: 0, posB: 100, intervalMs: 220, velocity: 90,
  },
  {
    id: "tease",
    labelId: "handy_modal.pattern_tease",
    descId: "handy_modal.pattern_tease_desc",
    posA: 0, posB: 35, intervalMs: 250, velocity: 70,
  },
  {
    id: "upper_zone",
    labelId: "handy_modal.pattern_upper_zone",
    descId: "handy_modal.pattern_upper_zone_desc",
    posA: 45, posB: 100, intervalMs: 170, velocity: 85,
  },
  {
    id: "ripple",
    labelId: "handy_modal.pattern_ripple",
    descId: "handy_modal.pattern_ripple_desc",
    posA: 45, posB: 65, intervalMs: 100, velocity: 100,
  },
] as const;

interface IProps {
  open: boolean;
  onClose: () => void;
  client: IInteractiveClient;
}

export const HandyControlModal: React.FC<IProps> = ({
  open,
  onClose,
  client,
}) => {
  const intl = useIntl();
  const [tab, setTab] = useState(0);

  // HAMP state
  const [hampActive, setHampActive] = useState(false);
  const [hampVelocity, setHampVelocity] = useState(50);
  const [strokeRange, setStrokeRange] = useState<[number, number]>([0, 100]);

  // HDSP state
  const [hdspPosition, setHdspPosition] = useState(50);
  const [hdspVelocity, setHdspVelocity] = useState(50);

  // HVP state
  const [hvpActive, setHvpActive] = useState(false);
  const [hvpAmplitude, setHvpAmplitude] = useState(50);
  const [hvpFrequency, setHvpFrequency] = useState(100);

  // Pattern state
  const patternIntervalRef = useRef<number | null>(null);
  const patternPosRef = useRef<boolean>(false);
  const [activePattern, setActivePattern] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (patternIntervalRef.current !== null) {
        clearInterval(patternIntervalRef.current);
      }
    };
  }, []);

  const handleEmergencyStop = useCallback(async () => {
    if (patternIntervalRef.current !== null) {
      clearInterval(patternIntervalRef.current);
      patternIntervalRef.current = null;
    }
    setActivePattern(null);
    try {
      await client.emergencyStop?.();
    } catch {
      // best-effort
    }
    setHampActive(false);
    setHvpActive(false);
  }, [client]);

  const handleClose = useCallback(async () => {
    if (patternIntervalRef.current !== null) {
      clearInterval(patternIntervalRef.current);
      patternIntervalRef.current = null;
    }
    setActivePattern(null);
    if (hampActive) {
      try {
        await client.hampStop?.();
      } catch {
        // best-effort
      }
      setHampActive(false);
    }
    if (hvpActive) {
      try {
        await client.hvpStop?.();
      } catch {
        // best-effort
      }
      setHvpActive(false);
    }
    onClose();
  }, [client, hampActive, hvpActive, onClose]);

  // ── Patterns ─────────────────────────────────────────────────────────────

  const clearPattern = useCallback(() => {
    if (patternIntervalRef.current !== null) {
      clearInterval(patternIntervalRef.current);
      patternIntervalRef.current = null;
    }
    setActivePattern(null);
  }, []);

  const startPattern = useCallback(
    (patternId: string) => {
      if (patternIntervalRef.current !== null) {
        clearInterval(patternIntervalRef.current);
        patternIntervalRef.current = null;
      }
      const pattern = HDSP_PATTERNS.find((p) => p.id === patternId);
      if (!pattern) return;
      setActivePattern(patternId);
      patternPosRef.current = false;
      client.hdspSetPosition?.(pattern.posA, pattern.velocity).catch(() => {});
      patternIntervalRef.current = window.setInterval(() => {
        patternPosRef.current = !patternPosRef.current;
        const pos = patternPosRef.current ? pattern.posB : pattern.posA;
        client.hdspSetPosition?.(pos, pattern.velocity).catch(() => {});
      }, pattern.intervalMs);
    },
    [client]
  );

  // ── HAMP ────────────────────────────────────────────────────────────────

  const toggleHamp = useCallback(async () => {
    try {
      if (!hampActive) {
        await client.hampStart?.();
        await client.setHampVelocity?.(hampVelocity);
        setHampActive(true);
      } else {
        await client.hampStop?.();
        setHampActive(false);
      }
    } catch {
      // best-effort
    }
  }, [client, hampActive, hampVelocity]);

  const handleVelocityChange = useCallback(
    async (_: Event, value: number | number[]) => {
      const v = Array.isArray(value) ? value[0] : value;
      setHampVelocity(v);
      if (hampActive) {
        try {
          await client.setHampVelocity?.(v);
        } catch {
          // best-effort
        }
      }
    },
    [client, hampActive]
  );

  const handleStrokeChange = useCallback(
    async (_: Event, value: number | number[]) => {
      if (!Array.isArray(value)) return;
      const [min, max] = value as [number, number];
      setStrokeRange([min, max]);
      try {
        // /slider/stroke takes 0.0–1.0; convert from 0–100 slider
        await client.setHampStroke?.(min / 100, max / 100);
      } catch {
        // best-effort
      }
    },
    [client]
  );

  // ── HDSP ────────────────────────────────────────────────────────────────

  const handleSendPosition = useCallback(async () => {
    try {
      await client.hdspSetPosition?.(hdspPosition, hdspVelocity);
    } catch {
      // best-effort
    }
  }, [client, hdspPosition, hdspVelocity]);

  // ── HVP ─────────────────────────────────────────────────────────────────

  const toggleHvp = useCallback(async () => {
    try {
      if (!hvpActive) {
        await client.hvpStart?.();
        // amplitude: 0.0–1.0; frequency: Hz; position: mm (0 = not applicable)
        await client.setHvpState?.(hvpAmplitude / 100, hvpFrequency, 0);
        setHvpActive(true);
      } else {
        await client.hvpStop?.();
        setHvpActive(false);
      }
    } catch {
      // best-effort
    }
  }, [client, hvpActive, hvpAmplitude, hvpFrequency]);

  const handleAmplitudeChange = useCallback(
    async (_: Event, value: number | number[]) => {
      const v = Array.isArray(value) ? value[0] : value;
      setHvpAmplitude(v);
      if (hvpActive) {
        try {
          await client.setHvpState?.(v / 100, hvpFrequency, 0);
        } catch {
          // best-effort
        }
      }
    },
    [client, hvpActive, hvpFrequency]
  );

  const handleFrequencyChange = useCallback(
    async (_: Event, value: number | number[]) => {
      const v = Array.isArray(value) ? value[0] : value;
      setHvpFrequency(v);
      if (hvpActive) {
        try {
          await client.setHvpState?.(hvpAmplitude / 100, v, 0);
        } catch {
          // best-effort
        }
      }
    },
    [client, hvpActive, hvpAmplitude]
  );

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: { bgcolor: "#1e1e1e", color: "white" } }}
    >
      <DialogTitle sx={{ pb: 0 }}>
        <FormattedMessage id="handy_modal.title" />
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <Tooltip
            title={intl.formatMessage({ id: "handy_controls.emergency_stop" })}
          >
            <IconButton size="small" color="error" onClick={handleEmergencyStop}>
              <WarningIcon />
            </IconButton>
          </Tooltip>
          <IconButton
            size="small"
            sx={{ color: "grey.400" }}
            onClick={handleClose}
          >
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ px: 2, pt: 1 }}>
        <Tabs
          value={tab}
          onChange={(_, v: number) => setTab(v)}
          textColor="inherit"
          TabIndicatorProps={{ style: { backgroundColor: "white" } }}
          sx={{ mb: 2, borderBottom: "1px solid rgba(255,255,255,0.12)" }}
        >
          <Tab label={<FormattedMessage id="handy_modal.tab_hamp" />} />
          <Tab label={<FormattedMessage id="handy_modal.tab_position" />} />
          <Tab label={<FormattedMessage id="handy_modal.tab_vibration" />} />
          <Tab label={<FormattedMessage id="handy_modal.tab_patterns" />} />
        </Tabs>

        {/* ── HAMP tab ── */}
        {tab === 0 && (
          <Box>
            <Button
              fullWidth
              variant={hampActive ? "contained" : "outlined"}
              color={hampActive ? "success" : "inherit"}
              onClick={toggleHamp}
              sx={{
                mb: 2.5,
                color: hampActive ? undefined : "white",
                borderColor: "rgba(255,255,255,0.3)",
              }}
            >
              <FormattedMessage
                id={hampActive ? "handy_modal.hamp_stop" : "handy_modal.hamp_start"}
              />
            </Button>

            <Typography variant="caption" display="block" color="grey.400">
              <FormattedMessage id="handy_controls.hamp_velocity" />
              {": "}
              {hampVelocity}%
            </Typography>
            <Slider
              size="small"
              min={0}
              max={100}
              value={hampVelocity}
              onChange={handleVelocityChange}
              sx={{ color: "white", mb: 2 }}
            />

            <Typography variant="caption" display="block" color="grey.400">
              <FormattedMessage id="handy_modal.stroke_zone" />
              {": "}
              {strokeRange[0]}%–{strokeRange[1]}%
            </Typography>
            <Slider
              size="small"
              min={0}
              max={100}
              value={strokeRange}
              onChange={handleStrokeChange}
              sx={{ color: "white" }}
            />
            <Typography variant="caption" color="grey.600" sx={{ mt: 0.5 }}>
              <FormattedMessage id="handy_modal.stroke_zone_note" />
            </Typography>
          </Box>
        )}

        {/* ── HDSP position tab ── */}
        {tab === 1 && (
          <Box>
            <Typography variant="caption" display="block" color="grey.400">
              <FormattedMessage id="handy_modal.position" />
              {": "}
              {hdspPosition}%
            </Typography>
            <Slider
              size="small"
              min={0}
              max={100}
              value={hdspPosition}
              onChange={(_, v) =>
                setHdspPosition(Array.isArray(v) ? v[0] : v)
              }
              sx={{ color: "white" }}
            />

            <Typography
              variant="caption"
              display="block"
              color="grey.400"
              sx={{ mt: 2 }}
            >
              <FormattedMessage id="handy_modal.move_speed" />
              {": "}
              {hdspVelocity}%
            </Typography>
            <Slider
              size="small"
              min={1}
              max={100}
              value={hdspVelocity}
              onChange={(_, v) =>
                setHdspVelocity(Array.isArray(v) ? v[0] : v)
              }
              sx={{ color: "white" }}
            />

            <Button
              fullWidth
              variant="contained"
              onClick={handleSendPosition}
              sx={{ mt: 2.5 }}
            >
              <FormattedMessage id="handy_modal.send_position" />
            </Button>
          </Box>
        )}

        {/* ── HVP vibration tab ── */}
        {tab === 2 && (
          <Box>
            <Button
              fullWidth
              variant={hvpActive ? "contained" : "outlined"}
              color={hvpActive ? "success" : "inherit"}
              onClick={toggleHvp}
              sx={{
                mb: 2.5,
                color: hvpActive ? undefined : "white",
                borderColor: "rgba(255,255,255,0.3)",
              }}
            >
              <FormattedMessage
                id={hvpActive ? "handy_modal.hvp_stop" : "handy_modal.hvp_start"}
              />
            </Button>

            <Typography variant="caption" display="block" color="grey.400">
              <FormattedMessage id="handy_controls.amplitude" />
              {": "}
              {hvpAmplitude}%
            </Typography>
            <Slider
              size="small"
              min={0}
              max={100}
              value={hvpAmplitude}
              onChange={handleAmplitudeChange}
              sx={{ color: "white", mb: 2 }}
            />

            <Typography variant="caption" display="block" color="grey.400">
              <FormattedMessage id="handy_controls.frequency" />
              {": "}
              {hvpFrequency} Hz
            </Typography>
            <Slider
              size="small"
              min={0}
              max={1000}
              step={10}
              value={hvpFrequency}
              onChange={handleFrequencyChange}
              sx={{ color: "white" }}
            />
          </Box>
        )}

        {/* ── Patterns tab ── */}
        {tab === 3 && (
          <Box>
            {activePattern !== null && (
              <Button
                fullWidth
                variant="contained"
                color="error"
                onClick={clearPattern}
                sx={{ mb: 2 }}
              >
                <FormattedMessage id="handy_modal.pattern_stop" />
              </Button>
            )}
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 1.5,
              }}
            >
              {HDSP_PATTERNS.map((p) => (
                <Box
                  key={p.id}
                  onClick={() =>
                    activePattern === p.id
                      ? clearPattern()
                      : startPattern(p.id)
                  }
                  sx={{
                    border: `1px solid ${
                      activePattern === p.id
                        ? "#4caf50"
                        : "rgba(255,255,255,0.2)"
                    }`,
                    borderRadius: 1,
                    p: 1.5,
                    cursor: "pointer",
                    bgcolor:
                      activePattern === p.id
                        ? "rgba(76,175,80,0.15)"
                        : "rgba(255,255,255,0.04)",
                    "&:hover": {
                      bgcolor:
                        activePattern === p.id
                          ? "rgba(76,175,80,0.2)"
                          : "rgba(255,255,255,0.08)",
                    },
                  }}
                >
                  <Typography variant="body2" fontWeight={600}>
                    <FormattedMessage id={p.labelId} />
                  </Typography>
                  <Typography variant="caption" color="grey.400">
                    <FormattedMessage id={p.descId} />
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default HandyControlModal;
