import React, { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";

/**
 * Animated vertical position tracker for The Handy device.
 *
 * Shows a vertical track (0–100%) with:
 *  - A glowing green puck for the current device position
 *  - A smaller purple diamond/cursor for the funscript-commanded position
 *  - A highlighted stroke-zone region
 *  - Soft velocity glow (faster = brighter)
 */

interface IProps {
  /** Current device position 0–100. Updated frequently. */
  position: number;
  /** Stroke-zone range [min, max] 0–100. */
  strokeRange: [number, number];
  /** Current velocity estimate 0–100 (used for glow intensity). */
  velocity?: number;
  /** Funscript-commanded position 0–100 at current video time, if available. */
  funscriptPos?: number;
  /** Label shown above the track. */
  label?: string;
}

const TRACK_HEIGHT = 160;
const PUCK_SIZE = 14;
const FUNSCRIPT_SIZE = 10;

export const PositionVisualizer: React.FC<IProps> = ({
  position,
  strokeRange,
  velocity = 0,
  funscriptPos,
  label,
}) => {
  const [recentPositions, setRecentPositions] = useState<number[]>([]);
  const prevPosRef = useRef(position);

  // Track recent positions for trail effect
  useEffect(() => {
    if (position === prevPosRef.current) return;
    prevPosRef.current = position;
    setRecentPositions((prev) => {
      const next = [...prev, position];
      // Keep last 4 for a short motion trail
      return next.length > 4 ? next.slice(-4) : next;
    });
  }, [position]);

  // Map 0–100 to px from bottom of track (0% = bottom, 100% = top)
  const toPx = (val: number) =>
    ((100 - Math.min(100, Math.max(0, val))) / 100) * TRACK_HEIGHT;

  const strokeTop = toPx(strokeRange[1]);
  const strokeBottom = toPx(strokeRange[0]);
  const strokeHeight = strokeBottom - strokeTop;

  const glowOpacity = Math.min(1, velocity / 60);
  const glowSize = 3 + (velocity / 100) * 8;

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.25,
      }}
    >
      {label && (
        <Typography variant="caption" color="grey.400" sx={{ mb: 0.25 }}>
          {label}
        </Typography>
      )}

      <Box
        sx={{
          position: "relative",
          width: 28,
          height: TRACK_HEIGHT,
          bgcolor: "rgba(255,255,255,0.06)",
          borderRadius: "14px",
          border: "1px solid rgba(255,255,255,0.12)",
          overflow: "visible",
        }}
      >
        {/* Stroke zone highlight */}
        <Box
          sx={{
            position: "absolute",
            left: 2,
            right: 2,
            top: strokeTop,
            height: strokeHeight,
            bgcolor: "rgba(76, 175, 80, 0.18)",
            borderRadius: "10px",
            border: "1px solid rgba(76, 175, 80, 0.3)",
            transition: "top 0.3s ease, height 0.3s ease",
          }}
        />

        {/* Percentage labels */}
        <Typography
          variant="caption"
          sx={{
            position: "absolute",
            right: -30,
            top: -1,
            fontSize: 9,
            color: "grey.500",
            lineHeight: 1,
          }}
        >
          100
        </Typography>
        <Typography
          variant="caption"
          sx={{
            position: "absolute",
            right: -24,
            bottom: -1,
            fontSize: 9,
            color: "grey.500",
            lineHeight: 1,
          }}
        >
          0
        </Typography>

        {/* Motion trail - ghost pucks */}
        {recentPositions.slice(0, -1).map((p, i) => {
          const top = toPx(p);
          const fade = (i + 1) / recentPositions.length;
          return (
            <Box
              key={i}
              sx={{
                position: "absolute",
                left: "50%",
                top,
                width: PUCK_SIZE * 0.5,
                height: PUCK_SIZE * 0.5,
                transform: "translate(-50%, -50%)",
                borderRadius: "50%",
                bgcolor: `rgba(76, 175, 80, ${fade * 0.2})`,
                transition: "none",
                pointerEvents: "none",
              }}
            />
          );
        })}

        {/* Funscript cursor — a small diamond showing script target */}
        {funscriptPos !== undefined && (
          <Box
            sx={{
              position: "absolute",
              left: "50%",
              top: toPx(funscriptPos),
              width: FUNSCRIPT_SIZE,
              height: FUNSCRIPT_SIZE,
              transform: "translate(-50%, -50%) rotate(45deg)",
              bgcolor: "rgba(156, 39, 176, 0.7)",
              border: "1.5px solid rgba(156, 39, 176, 0.9)",
              borderRadius: 1.5,
              zIndex: 1,
              transition: "top 0.05s linear",
              pointerEvents: "none",
            }}
          />
        )}

        {/* Outer glow */}
        <Box
          sx={{
            position: "absolute",
            left: "50%",
            top: toPx(position),
            width: PUCK_SIZE + glowSize,
            height: PUCK_SIZE + glowSize,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            bgcolor: `rgba(76, 175, 80, ${glowOpacity * 0.25})`,
            filter: "blur(3px)",
            transition: "all 0.08s ease-out",
            pointerEvents: "none",
          }}
        />

        {/* Main puck */}
        <Box
          sx={{
            position: "absolute",
            left: "50%",
            top: toPx(position),
            width: PUCK_SIZE,
            height: PUCK_SIZE,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            bgcolor: "#4caf50",
            boxShadow: `0 0 ${5 + glowSize * 0.4}px rgba(76, 175, 80, ${0.4 + glowOpacity * 0.4})`,
            border: "2px solid rgba(255,255,255,0.5)",
            transition: "top 0.08s ease-out, box-shadow 0.15s ease",
            zIndex: 3,
          }}
        />
      </Box>

      {/* Numeric readout */}
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 0.25 }}>
        <Typography
          variant="caption"
          sx={{
            color: "#4caf50",
            fontWeight: 700,
            fontFamily: "monospace",
            fontSize: 11,
          }}
        >
          {Math.round(position)}%
        </Typography>
        {funscriptPos !== undefined && (
          <Typography
            variant="caption"
            sx={{
              color: "#9c27b0",
              fontWeight: 600,
              fontFamily: "monospace",
              fontSize: 11,
            }}
          >
            ~{Math.round(funscriptPos)}%
          </Typography>
        )}
      </Box>
    </Box>
  );
};

export default PositionVisualizer;
