import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import VisibilityIcon from "@mui/icons-material/Visibility";
import WarningIcon from "@mui/icons-material/Warning";
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Paper,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { HandyAPIv3 } from "src/hooks/Interactive/handy-api-v3";
import { PatternRunner, HDSP_PATTERNS } from "src/hooks/Interactive/patterns";
import { IInteractiveClient } from "src/hooks/Interactive/utils";
import InteractiveUtils from "src/hooks/Interactive/utils";
import { PositionVisualizer } from "./PositionVisualizer";

interface FunscriptAction {
  at: number;
  pos: number;
}

interface IProps {
  open: boolean;
  onClose: () => void;
  client: IInteractiveClient;
  /** Path to .funscript JSON for live position overlay. */
  funscriptPath?: string;
}

export const HandyControlModal: React.FC<IProps> = ({
  open,
  onClose,
  client,
  funscriptPath,
}) => {
  const intl = useIntl();

  // ── Funscript state ───────────────────────────────────────────────────
  const funscriptActionsRef = useRef<FunscriptAction[]>([]);
  const funscriptDurationRef = useRef(0);
  const [funscriptPos, setFunscriptPos] = useState<number | undefined>();

  // Fetch funscript data
  useEffect(() => {
    if (!funscriptPath) {
      funscriptActionsRef.current = [];
      funscriptDurationRef.current = 0;
      return;
    }
    let cancelled = false;
    fetch(funscriptPath)
      .then((r) => r.json())
      .then((data: { actions?: FunscriptAction[] }) => {
        if (cancelled) return;
        const acts = data.actions ?? [];
        funscriptActionsRef.current = acts;
        funscriptDurationRef.current =
          acts.length > 0 ? acts[acts.length - 1].at : 0;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [funscriptPath]);

  // Tick loop: read video time → look up funscript position
  useEffect(() => {
    if (!funscriptPath || funscriptActionsRef.current.length === 0) return;
    let running = true;
    const tick = () => {
      if (!running) return;
      const player = InteractiveUtils.getPlayer();
      if (player && !player.paused()) {
        const t = player.currentTime() * 1000; // ms
        const acts = funscriptActionsRef.current;
        const dur = funscriptDurationRef.current;
        if (acts.length >= 2 && dur > 0) {
          const ct = Math.max(acts[0].at, Math.min(dur, t));
          let lo = 0;
          let hi = acts.length - 1;
          while (lo < hi - 1) {
            const mid = (lo + hi) >> 1;
            if (acts[mid].at <= ct) lo = mid;
            else hi = mid;
          }
          const a = acts[lo];
          const b = acts[Math.min(hi, acts.length - 1)];
          let pos = a.pos;
          if (a.at !== b.at) {
            const frac = (ct - a.at) / (b.at - a.at);
            pos = a.pos + (b.pos - a.pos) * frac;
          }
          setFunscriptPos(Math.max(0, Math.min(100, pos)));
        }
      }
      setTimeout(tick, 50);
    };
    tick();
    return () => {
      running = false;
    };
  }, [funscriptPath]);

  // ── State ──────────────────────────────────────────────────────────────
  const [showVisualizer, setShowVisualizer] = useState(true);
  const [visualizerPos, setVisualizerPos] = useState(50);
  const [visualizerVel, setVisualizerVel] = useState(50);

  // Collapsible sections
  const [hampOpen, setHampOpen] = useState(false);
  const [hdspOpen, setHdspOpen] = useState(false);
  const [hvpOpen, setHvpOpen] = useState(false);
  const [patternOpen, setPatternOpen] = useState(false);

  // HAMP
  const [hampActive, setHampActive] = useState(false);
  const [hampVelocity, setHampVelocity] = useState(50);
  const [strokeRange, setStrokeRange] = useState<[number, number]>([0, 100]);

  // HDSP
  const [hdspPosition, setHdspPosition] = useState(50);
  const [hdspVelocity, setHdspVelocity] = useState(50);

  // HVP
  const [hvpActive, setHvpActive] = useState(false);
  const [hvpAmplitude, setHvpAmplitude] = useState(50);
  const [hvpFrequency, setHvpFrequency] = useState(100);

  // Pattern runner
  const patternRunnerRef = useRef<PatternRunner>(new PatternRunner(client));
  const [activePattern, setActivePattern] = useState<string | null>(null);

  // ── HAMP simulation ────────────────────────────────────────────────────
  const hampSimRef = useRef<number | null>(null);
  const startHampSim = useCallback((velocity: number) => {
    stopHampSim();
    const speed = Math.max(10, 100 - velocity) * 3;
    const tick = () => {
      const delta = (Date.now() % speed) / speed;
      const tri = delta < 0.5 ? delta * 2 : 2 - delta * 2;
      setVisualizerPos(Math.round(5 + tri * 90));
      setVisualizerVel(velocity);
      hampSimRef.current = window.setTimeout(tick, 30);
    };
    tick();
  }, []);
  const stopHampSim = useCallback(() => {
    if (hampSimRef.current !== null) {
      clearTimeout(hampSimRef.current);
      hampSimRef.current = null;
    }
  }, []);

  // ── Standalone preview ─────────────────────────────────────────────────
  const previewRef = useRef<number | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const stopPreview = useCallback(() => {
    if (previewRef.current !== null) {
      clearTimeout(previewRef.current);
      previewRef.current = null;
    }
    setDemoRunning(false);
  }, []);
  const startPreview = useCallback(() => {
    stopPreview();
    setDemoRunning(true);
    const speed = Math.max(10, 100 - hampVelocity) * 3;
    const [rMin, rMax] = strokeRange;
    const tick = () => {
      const delta = (Date.now() % speed) / speed;
      const tri = delta < 0.5 ? delta * 2 : 2 - delta * 2;
      setVisualizerPos(Math.round(rMin + tri * (rMax - rMin)));
      setVisualizerVel(hampVelocity);
      previewRef.current = window.setTimeout(tick, 30);
    };
    tick();
  }, [hampVelocity, strokeRange, stopPreview]);
  const togglePreview = useCallback(() => {
    if (demoRunning) stopPreview();
    else { stopHampSim(); startPreview(); }
  }, [demoRunning, startPreview, stopHampSim, stopPreview]);

  // ── Pattern runner tick ────────────────────────────────────────────────
  useEffect(() => {
    patternRunnerRef.current.onStep = (pos, vel) => {
      setVisualizerPos(pos);
      setVisualizerVel(vel);
    };
    return () => { patternRunnerRef.current.onStep = undefined; };
  }, []);

  useEffect(() => {
    return () => { patternRunnerRef.current.stop(); stopPreview(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleEmergencyStop = useCallback(async () => {
    patternRunnerRef.current.stop();
    setActivePattern(null);
    stopHampSim();
    stopPreview();
    try { await client.emergencyStop?.(); } catch { /* best-effort */ }
    setHampActive(false);
    setHvpActive(false);
  }, [client, stopHampSim, stopPreview]);

  const handleClose = useCallback(async () => {
    patternRunnerRef.current.stop();
    setActivePattern(null);
    stopHampSim();
    stopPreview();
    if (hampActive) {
      try { await client.hampStop?.(); } catch { /* best-effort */ }
      setHampActive(false);
    }
    if (hvpActive) {
      try { await client.hvpStop?.(); } catch { /* best-effort */ }
      setHvpActive(false);
    }
    onClose();
  }, [client, hampActive, hvpActive, onClose, stopHampSim, stopPreview]);

  const toggleHamp = useCallback(async () => {
    if (!hampActive) {
      setHampActive(true);
      startHampSim(hampVelocity);
      try { await client.hampStart?.(); await client.setHampVelocity?.(hampVelocity); } catch { /* preview only */ }
    } else {
      stopHampSim();
      setHampActive(false);
      try { await client.hampStop?.(); } catch { /* best-effort */ }
    }
  }, [client, hampActive, hampVelocity, startHampSim, stopHampSim]);

  const handleVelocityChange = useCallback(
    async (_: Event, value: number | number[]) => {
      const v = Array.isArray(value) ? value[0] : value;
      setHampVelocity(v);
      if (hampActive) {
        startHampSim(v);
        try { await client.setHampVelocity?.(v); } catch { /* best-effort */ }
      }
    }, [client, hampActive, startHampSim]);

  const handleStrokeChange = useCallback(
    async (_: Event, value: number | number[]) => {
      if (!Array.isArray(value)) return;
      const [min, max] = value as [number, number];
      setStrokeRange([min, max]);
      try { await client.setHampStroke?.(min / 100, max / 100); } catch { /* best-effort */ }
    }, [client]);

  const handleStrokeChangeWithPreview = useCallback(
    async (_: Event, value: number | number[]) => {
      await handleStrokeChange(_, value);
      if (demoRunning) startPreview();
    }, [handleStrokeChange, demoRunning, startPreview]);

  const handleSendPosition = useCallback(async () => {
    setVisualizerPos(hdspPosition);
    setVisualizerVel(hdspVelocity);
    try {
      await client.setMode?.(HandyAPIv3.MODE.HDSP);
      await client.hdspSetPosition?.(hdspPosition, hdspVelocity);
    } catch { /* best-effort */ }
  }, [client, hdspPosition, hdspVelocity]);

  const toggleHvp = useCallback(async () => {
    try {
      if (!hvpActive) {
        await client.hvpStart?.();
        await client.setHvpState?.(hvpAmplitude / 100, hvpFrequency, 0);
        setHvpActive(true);
      } else {
        await client.hvpStop?.();
        setHvpActive(false);
      }
    } catch { /* best-effort */ }
  }, [client, hvpActive, hvpAmplitude, hvpFrequency]);

  const handleAmplitudeChange = useCallback(
    async (_: Event, value: number | number[]) => {
      const v = Array.isArray(value) ? value[0] : value;
      setHvpAmplitude(v);
      if (hvpActive) {
        try { await client.setHvpState?.(v / 100, hvpFrequency, 0); } catch { /* best-effort */ }
      }
    }, [client, hvpActive, hvpFrequency]);

  const handleFrequencyChange = useCallback(
    async (_: Event, value: number | number[]) => {
      const v = Array.isArray(value) ? value[0] : value;
      setHvpFrequency(v);
      if (hvpActive) {
        try { await client.setHvpState?.(hvpAmplitude / 100, v, 0); } catch { /* best-effort */ }
      }
    }, [client, hvpActive, hvpAmplitude]);

  const clearPattern = useCallback(() => {
    patternRunnerRef.current.stop();
    setActivePattern(null);
  }, []);
  const startPattern = useCallback((patternId: string) => {
    setActivePattern(patternId);
    patternRunnerRef.current.start(patternId);
  }, []);

  if (!open) return null;

  return (
    <Paper
      elevation={12}
      sx={{
        position: "absolute",
        bottom: "calc(100% + 14px)", left: 0, width: 280,
        maxHeight: "calc(100vh - 120px)", display: "flex", flexDirection: "column",
        bgcolor: "#1e1e1e", color: "white", zIndex: 1300, borderRadius: 2, overflow: "hidden",
      }}
    >
      {/* Title bar */}
      <Stack direction="row" alignItems="center" justifyContent="space-between"
        sx={{ px: 1.5, py: 0.75, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ fontSize: 13 }}>
          <FormattedMessage id="handy_modal.title" />
        </Typography>
        <Stack direction="row" spacing={0.25}>
          <Tooltip title={intl.formatMessage({ id: "handy_modal.toggle_visualizer" })}>
            <IconButton size="small" sx={{ color: showVisualizer ? "#4caf50" : "grey.500", p: 0.5 }}
              onClick={() => setShowVisualizer((v) => !v)}>
              <VisibilityIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={intl.formatMessage({ id: "handy_controls.emergency_stop" })}>
            <IconButton size="small" color="error" sx={{ p: 0.5 }} onClick={handleEmergencyStop}>
              <WarningIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <IconButton size="small" sx={{ color: "grey.400", p: 0.5 }} onClick={handleClose}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Stack>
      </Stack>

      <Box sx={{ px: 1.5, pt: 1, pb: 1.5, overflowY: "auto" }}>
        {/* Visualiser */}
        <Collapse in={showVisualizer}>
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mb: 1, gap: 0.5 }}>
            <PositionVisualizer
              position={visualizerPos} strokeRange={strokeRange}
              velocity={visualizerVel} funscriptPos={funscriptPos}
            />
            <Stack direction="row" spacing={1} alignItems="center">
              {demoRunning && (
                <Chip label={<FormattedMessage id="handy_modal.preview_mode" />}
                  size="small" color="info" variant="outlined" sx={{ height: 20, fontSize: 10 }} />
              )}
              <Tooltip title={intl.formatMessage({
                id: demoRunning ? "handy_modal.preview_stop" : "handy_modal.preview_start",
              })}>
                <IconButton size="small" onClick={togglePreview}
                  sx={{ color: demoRunning ? "#f44336" : "#4caf50", border: "1px solid",
                    width: 24, height: 24,
                    borderColor: demoRunning ? "error.main" : "rgba(76,175,80,0.4)" }}>
                  {demoRunning ? <StopIcon sx={{ fontSize: 12 }} /> : <PlayArrowIcon sx={{ fontSize: 12 }} />}
                </IconButton>
              </Tooltip>
            </Stack>
          </Box>
        </Collapse>

        {/* ── HAMP ── */}
        <SectionHeader label={<FormattedMessage id="handy_modal.tab_hamp" />}
          active={hampActive} open={hampOpen} onToggle={() => setHampOpen((v) => !v)} />
        <Collapse in={hampOpen}>
          <Box sx={{ pl: 0.5, mb: 1 }}>
            <Button size="small" fullWidth variant={hampActive ? "contained" : "outlined"}
              color={hampActive ? "success" : "inherit"} onClick={toggleHamp}
              sx={{ mb: 1, color: hampActive ? undefined : "white", borderColor: "rgba(255,255,255,0.3)", fontSize: 11 }}>
              <FormattedMessage id={hampActive ? "handy_modal.hamp_stop" : "handy_modal.hamp_start"} />
            </Button>
            <SliderLabel text={<FormattedMessage id="handy_controls.hamp_velocity" />} value={`${hampVelocity}%`} />
            <Slider size="small" min={0} max={100} value={hampVelocity}
              onChange={handleVelocityChange} sx={{ color: "white", py: 0 }} />
            <SliderLabel text={<FormattedMessage id="handy_modal.stroke_zone" />} value={`${strokeRange[0]}%–${strokeRange[1]}%`} />
            <Slider size="small" min={0} max={100} value={strokeRange}
              onChange={handleStrokeChangeWithPreview} sx={{ color: "white", py: 0 }} />
          </Box>
        </Collapse>

        {/* ── HDSP ── */}
        <SectionHeader label={<FormattedMessage id="handy_modal.tab_position" />}
          active={false} open={hdspOpen} onToggle={() => setHdspOpen((v) => !v)} />
        <Collapse in={hdspOpen}>
          <Box sx={{ pl: 0.5, mb: 1 }}>
            <SliderLabel text={<FormattedMessage id="handy_modal.position" />} value={`${hdspPosition}%`} />
            <Slider size="small" min={0} max={100} value={hdspPosition}
              onChange={(_, v) => {
                const p = Array.isArray(v) ? v[0] : v;
                setHdspPosition(p); setVisualizerPos(p);
              }}
              sx={{ color: "white", py: 0 }} />
            <SliderLabel text={<FormattedMessage id="handy_modal.move_speed" />} value={`${hdspVelocity}%`} />
            <Slider size="small" min={1} max={100} value={hdspVelocity}
              onChange={(_, v) => {
                const p = Array.isArray(v) ? v[0] : v;
                setHdspVelocity(p); setVisualizerVel(p);
              }}
              sx={{ color: "white", py: 0 }} />
            <Button size="small" fullWidth variant="contained" onClick={handleSendPosition}
              sx={{ mt: 1, fontSize: 11 }}>
              <FormattedMessage id="handy_modal.send_position" />
            </Button>
          </Box>
        </Collapse>

        {/* ── HVP ── */}
        <SectionHeader label={<FormattedMessage id="handy_modal.tab_vibration" />}
          active={hvpActive} open={hvpOpen} onToggle={() => setHvpOpen((v) => !v)} />
        <Collapse in={hvpOpen}>
          <Box sx={{ pl: 0.5, mb: 1 }}>
            <Button size="small" fullWidth variant={hvpActive ? "contained" : "outlined"}
              color={hvpActive ? "success" : "inherit"} onClick={toggleHvp}
              sx={{ mb: 1, color: hvpActive ? undefined : "white", borderColor: "rgba(255,255,255,0.3)", fontSize: 11 }}>
              <FormattedMessage id={hvpActive ? "handy_modal.hvp_stop" : "handy_modal.hvp_start"} />
            </Button>
            <SliderLabel text={<FormattedMessage id="handy_controls.amplitude" />} value={`${hvpAmplitude}%`} />
            <Slider size="small" min={0} max={100} value={hvpAmplitude}
              onChange={handleAmplitudeChange} sx={{ color: "white", py: 0 }} />
            <SliderLabel text={<FormattedMessage id="handy_controls.frequency" />} value={`${hvpFrequency} Hz`} />
            <Slider size="small" min={0} max={1000} step={10} value={hvpFrequency}
              onChange={handleFrequencyChange} sx={{ color: "white", py: 0 }} />
          </Box>
        </Collapse>

        {/* ── Patterns ── */}
        <SectionHeader label={<FormattedMessage id="handy_modal.tab_patterns" />}
          active={activePattern !== null} open={patternOpen}
          onToggle={() => setPatternOpen((v) => !v)}
          badge={activePattern ?? undefined} />
        <Collapse in={patternOpen}>
          <Box>
            {activePattern !== null && (
              <Button size="small" fullWidth variant="contained" color="error"
                onClick={clearPattern} sx={{ mb: 1, fontSize: 11 }}>
                <FormattedMessage id="handy_modal.pattern_stop" />
              </Button>
            )}
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
              {HDSP_PATTERNS.map((p) => (
                <Box key={p.id}
                  onClick={() => activePattern === p.id ? clearPattern() : startPattern(p.id)}
                  sx={{
                    border: `1px solid ${activePattern === p.id ? "#4caf50" : "rgba(255,255,255,0.2)"}`,
                    borderRadius: 1, p: 1, cursor: "pointer",
                    bgcolor: activePattern === p.id ? "rgba(76,175,80,0.15)" : "rgba(255,255,255,0.04)",
                    "&:hover": { bgcolor: activePattern === p.id ? "rgba(76,175,80,0.2)" : "rgba(255,255,255,0.08)" },
                  }}>
                  <Typography variant="caption" fontWeight={600} sx={{ fontSize: 10 }}>
                    {p.label}
                  </Typography>
                  <Typography variant="caption" color="grey.400" sx={{ fontSize: 9 }}>
                    {p.desc}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Collapse>
      </Box>
    </Paper>
  );
};

// ── Mini helpers ───────────────────────────────────────────────────────────

const SliderLabel: React.FC<{ text: React.ReactNode; value: React.ReactNode }> = ({ text, value }) => (
  <Typography variant="caption" color="grey.400" sx={{ fontSize: 10 }}>
    {text}: {value}
  </Typography>
);

const SectionHeader: React.FC<{
  label: React.ReactNode; active: boolean; open: boolean;
  onToggle: () => void; badge?: string;
}> = ({ label, active, open, onToggle, badge }) => (
  <Stack direction="row" alignItems="center" justifyContent="space-between"
    sx={{ py: 0.5, cursor: "pointer", userSelect: "none" }}
    onClick={onToggle}>
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography variant="caption" fontWeight={600}>{label}</Typography>
      {active && (
        <Chip label={badge ?? "ON"} size="small" color="success" sx={{ height: 16, fontSize: 9 }} />
      )}
    </Stack>
    {open ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
  </Stack>
);

export default HandyControlModal;
