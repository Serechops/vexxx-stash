import React from "react";
import { Box } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import TextUtils from "src/utils/text";

interface IResumeProgressBarProps {
  resumeTime: number | null | undefined;
  duration: number | null | undefined;
  /** If true, show the "▶ X:XX" timestamp chip. Defaults to true. */
  showLabel?: boolean;
}

/**
 * Renders a thin indigo progress bar and an optional "▶ X:XX" resume chip at
 * the bottom of a card thumbnail. Must be placed inside a `position: relative`
 * container with `overflow: hidden` to clip correctly.
 */
export const ResumeProgressBar: React.FC<IResumeProgressBarProps> = ({
  resumeTime,
  duration,
  showLabel = true,
}) => {
  if (!resumeTime || resumeTime <= 0 || !duration || duration <= 0) return null;

  const pct = Math.min((resumeTime / duration) * 100, 100);
  const ts = TextUtils.secondsToTimestamp(Math.round(resumeTime));

  return (
    <>
      {/* Timestamp chip — fades in on parent hover via CSS (parent adds .resume-bar-parent class) */}
      {showLabel && (
        <Box
          className="resume-timestamp-chip"
          sx={{
            position: "absolute",
            bottom: "7px",
            left: "6px",
            zIndex: 11,
            display: "flex",
            alignItems: "center",
            gap: "2px",
            px: "5px",
            py: "2px",
            borderRadius: "4px",
            fontSize: "10px",
            fontWeight: 700,
            color: "#fff",
            bgcolor: "rgba(99, 102, 241, 0.85)",
            backdropFilter: "blur(4px)",
            lineHeight: 1,
            pointerEvents: "none",
            opacity: 0,
            transition: "opacity 0.2s",
            // Parent hover reveal — callers add sx or className to parent
            ".resume-bar-host:hover &, .scene-card-link:hover ~ * &, .scene-card-overlay-variant:hover &": {
              opacity: 1,
            },
          }}
        >
          <PlayArrowIcon sx={{ fontSize: 10 }} />
          {ts}
        </Box>
      )}

      {/* Progress bar — always visible */}
      <Box
        sx={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          height: "3px",
          bgcolor: "rgba(0,0,0,0.45)",
          pointerEvents: "none",
        }}
      >
        <Box
          sx={{
            height: "100%",
            width: `${pct}%`,
            bgcolor: "#6366f1",
            borderRadius: "0 1px 1px 0",
            boxShadow: "0 0 6px rgba(99,102,241,0.7)",
          }}
        />
      </Box>
    </>
  );
};
