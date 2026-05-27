import CloseIcon from "@mui/icons-material/Close";
import WarningIcon from "@mui/icons-material/Warning";
import {
  Box,
  Button,
  IconButton,
  Paper,
  Slider,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { HandyAPIv3 } from "src/hooks/Interactive/handy-api-v3";
import { IInteractiveClient } from "src/hooks/Interactive/utils";

interface PatternStep {
  pos: number;    // target position 0–100
  vel: number;    // velocity 0–100
  holdMs: number; // ms to wait after sending before sending the next step
}

// Small helpers for natural variation
// ±12% time jitter
const jt = (ms: number): number => ms * (0.88 + Math.random() * 0.24);
// position jitter ±spread, clamped to 0-100
const jp = (pos: number, spread: number): number =>
  Math.max(0, Math.min(100, pos + (Math.random() * 2 - 1) * spread));

// holdMs guidelines (device travel at velocity v over range r%):
//   travel_ms ≈ 300 * (100 / v) * (r / 100)   +   dwell_ms
// e.g. v=55, r=100% → ~545 ms travel. Add ~50 ms dwell = 595 ms total.
const HDSP_PATTERNS: Array<{
  id: string;
  labelId: string;
  descId: string;
  getSteps: () => PatternStep[];
}> = [
  {
    // Deep, slow full strokes — sensual baseline
    id: "slow_wave",
    labelId: "handy_modal.pattern_slow_wave",
    descId: "handy_modal.pattern_slow_wave_desc",
    getSteps: () => {
      const v = 28 + Math.random() * 8;
      return [
        { pos: jp(2, 3),  vel: v, holdMs: jt(970) },
        { pos: jp(98, 3), vel: v, holdMs: jt(920) },
      ];
    },
  },
  {
    // Medium-pace full strokes — the workhorse
    id: "steady",
    labelId: "handy_modal.pattern_steady",
    descId: "handy_modal.pattern_steady_desc",
    getSteps: () => {
      const v = 54 + Math.random() * 12;
      return [
        { pos: jp(3, 4),  vel: v, holdMs: jt(560) },
        { pos: jp(97, 3), vel: v, holdMs: jt(535) },
      ];
    },
  },
  {
    // Mixed full strokes + tip-focused short strokes
    id: "fast_pulse",
    labelId: "handy_modal.pattern_fast_pulse",
    descId: "handy_modal.pattern_fast_pulse_desc",
    getSteps: () => [
      { pos: jp(4, 4),   vel: 60 + Math.random() * 8, holdMs: jt(530) }, // full down
      { pos: jp(97, 3),  vel: 62 + Math.random() * 8, holdMs: jt(490) }, // full up
      { pos: jp(5, 4),   vel: 58 + Math.random() * 8, holdMs: jt(510) }, // full down
      { pos: jp(55, 6),  vel: 55 + Math.random() * 8, holdMs: jt(340) }, // partial up to mid
      { pos: jp(98, 3),  vel: 76 + Math.random() * 8, holdMs: jt(265) }, // tip (fast)
      { pos: jp(53, 6),  vel: 50 + Math.random() * 8, holdMs: jt(345) }, // back to mid
      { pos: jp(100, 2), vel: 80 + Math.random() * 8, holdMs: jt(260) }, // tip again
    ],
  },
  {
    // Slow build-up strokes that never quite reach the top — teasing
    id: "tease",
    labelId: "handy_modal.pattern_tease",
    descId: "handy_modal.pattern_tease_desc",
    getSteps: () => [
      { pos: jp(8, 5),  vel: 28 + Math.random() * 6, holdMs: jt(830) },
      { pos: jp(55, 7), vel: 30 + Math.random() * 6, holdMs: jt(790) },
      { pos: jp(10, 5), vel: 34 + Math.random() * 6, holdMs: jt(760) },
      { pos: jp(70, 6), vel: 32 + Math.random() * 6, holdMs: jt(770) },
      { pos: jp(12, 5), vel: 37 + Math.random() * 6, holdMs: jt(730) },
      { pos: jp(48, 7), vel: 28 + Math.random() * 6, holdMs: jt(790) },
    ],
  },
  {
    // Focused on upper half — targets erogenous tip zone
    // v=65, r=50% → travel ~230 ms + 120 ms dwell = 350 ms (well within holdMs)
    id: "upper_zone",
    labelId: "handy_modal.pattern_upper_zone",
    descId: "handy_modal.pattern_upper_zone_desc",
    getSteps: () => [
      { pos: jp(50, 5), vel: 60 + Math.random() * 10, holdMs: jt(365) },
      { pos: jp(98, 3), vel: 70 + Math.random() * 10, holdMs: jt(315) },
    ],
  },
  {
    // Short oscillating strokes across the upper shaft — ripple sensation
    // v=82, r=25% → travel ~91 ms + 155 ms dwell = 246 ms (achievable over network)
    id: "ripple",
    labelId: "handy_modal.pattern_ripple",
    descId: "handy_modal.pattern_ripple_desc",
    getSteps: () => [
      { pos: jp(40, 6), vel: 80 + Math.random() * 8, holdMs: jt(255) },
      { pos: jp(65, 6), vel: 80 + Math.random() * 8, holdMs: jt(255) },
      { pos: jp(35, 6), vel: 80 + Math.random() * 8, holdMs: jt(255) },
      { pos: jp(70, 6), vel: 80 + Math.random() * 8, holdMs: jt(255) },
      { pos: jp(42, 6), vel: 80 + Math.random() * 8, holdMs: jt(255) },
      { pos: jp(62, 6), vel: 80 + Math.random() * 8, holdMs: jt(255) },
    ],
  },
];

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
  const patternTimerRef = useRef<number | null>(null);
  const patternRunningRef = useRef(false);
  const [activePattern, setActivePattern] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (patternTimerRef.current !== null) {
        clearTimeout(patternTimerRef.current);
      }
    };
  }, []);

  const handleEmergencyStop = useCallback(async () => {
    patternRunningRef.current = false;
    if (patternTimerRef.current !== null) {
      clearTimeout(patternTimerRef.current);
      patternTimerRef.current = null;
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
    patternRunningRef.current = false;
    if (patternTimerRef.current !== null) {
      clearTimeout(patternTimerRef.current);
      patternTimerRef.current = null;
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
    patternRunningRef.current = false;
    if (patternTimerRef.current !== null) {
      clearTimeout(patternTimerRef.current);
      patternTimerRef.current = null;
    }
    setActivePattern(null);
  }, []);

  const startPattern = useCallback(
    async (patternId: string) => {
      // Stop any running pattern
      patternRunningRef.current = false;
      if (patternTimerRef.current !== null) {
        clearTimeout(patternTimerRef.current);
        patternTimerRef.current = null;
      }

      const pattern = HDSP_PATTERNS.find((p) => p.id === patternId);
      if (!pattern) return;

      setActivePattern(patternId);

      // Device must be in HDSP mode to accept position commands.
      // Silently ignore failures — the device may already be in HDSP mode.
      try {
        await client.setMode?.(HandyAPIv3.MODE.HDSP);
      } catch {
        // best-effort
      }

      patternRunningRef.current = true;

      let stepIndex = 0;
      let currentSteps = pattern.getSteps();

      const tick = () => {
        if (!patternRunningRef.current) return;
        // Regenerate steps at loop boundary for natural variation each cycle
        if (stepIndex >= currentSteps.length) {
          stepIndex = 0;
          currentSteps = pattern.getSteps();
        }
        const step = currentSteps[stepIndex++];
        client.hdspSetPosition?.(step.pos, step.vel).catch(() => {});
        patternTimerRef.current = window.setTimeout(tick, step.holdMs);
      };

      tick();
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
      await client.setMode?.(HandyAPIv3.MODE.HDSP);
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

  if (!open) return null;

  return (
    <Paper
      elevation={12}
      sx={{
        position: "absolute",
        bottom: "calc(100% + 14px)",
        left: 0,
        width: 320,
        maxHeight: "calc(100vh - 120px)",
        display: "flex",
        flexDirection: "column",
        bgcolor: "#1e1e1e",
        color: "white",
        zIndex: 1300,
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      {/* sticky title bar */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 2, py: 1, borderBottom: "1px solid rgba(255,255,255,0.1)" }}
      >
        <Typography variant="subtitle2" fontWeight={600}>
          <FormattedMessage id="handy_modal.title" />
        </Typography>
        <Stack direction="row" spacing={0.5}>
          <Tooltip
            title={intl.formatMessage({ id: "handy_controls.emergency_stop" })}
          >
            <IconButton size="small" color="error" onClick={handleEmergencyStop}>
              <WarningIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <IconButton
            size="small"
            sx={{ color: "grey.400" }}
            onClick={handleClose}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>

      <Box sx={{ px: 2, pt: 1, pb: 2, overflowY: "auto" }}>
        <Tabs
          value={tab}
          onChange={(_, v: number) => setTab(v)}
          textColor="inherit"
          variant="scrollable"
          scrollButtons="auto"
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
      </Box>
    </Paper>
  );
};

export default HandyControlModal;
