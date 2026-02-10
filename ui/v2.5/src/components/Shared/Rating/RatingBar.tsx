import React, { useState, useRef, useCallback } from "react";
import { Box } from "@mui/material";
import {
  getRatingPrecision,
  RatingStarPrecision,
  RatingSystemType,
} from "src/utils/rating";
import { PatchComponent } from "src/patch";

export interface IRatingBarProps {
  value: number | null;
  onSetRating?: (value: number | null) => void;
  disabled?: boolean;
  ratingSystemType: RatingSystemType;
  precision: RatingStarPrecision;
  // Compact mode for inline use (like in cards/lists)
  compact?: boolean;
  // Show "+" after the value to indicate "or more"
  orMore?: boolean;
}

export const RatingBar = PatchComponent(
  "RatingBar",
  (props: IRatingBarProps) => {
    const {
      value,
      onSetRating,
      disabled,
      ratingSystemType,
      precision,
      compact = false,
      orMore = false,
    } = props;

    const [hoverValue, setHoverValue] = useState<number | null>(null);
    const barRef = useRef<HTMLDivElement>(null);

    const isStars = ratingSystemType === RatingSystemType.Stars;
    const maxValue = isStars ? 5 : 10;

    // Get step size based on precision
    const step = isStars ? getRatingPrecision(precision) : 1;

    // Minimum value is the step size (smallest possible rating)
    const minValue = step;

    // Convert rating100 to display value - preserve precision
    const rating100ToDisplay = (rating100: number | null): number | null => {
      if (rating100 === null) return null;
      if (isStars) {
        // rating100 / 20 gives 0-5 scale
        const raw = rating100 / 20;
        return Math.round(raw / step) * step;
      }
      // rating100 / 10 gives 0-10 scale
      return Math.round(rating100 / 10);
    };

    // Convert display value back to rating100
    const displayToRating100 = (display: number): number => {
      if (isStars) {
        // display * 20 gives rating100
        return Math.max(step * 20, Math.min(100, Math.round(display * 20)));
      }
      // display * 10 gives rating100
      return Math.max(10, Math.min(100, display * 10));
    };

    // Round to nearest step
    const roundToStep = useCallback(
      (val: number): number => {
        const rounded = Math.round(val / step) * step;
        return Math.max(minValue, Math.min(maxValue, rounded));
      },
      [step, minValue, maxValue]
    );

    const currentDisplayValue = rating100ToDisplay(value);
    const displayValue = hoverValue !== null ? hoverValue : currentDisplayValue;

    // Calculate percentage for bar fill (0 to maxValue range)
    const percentage =
      displayValue !== null ? (displayValue / maxValue) * 100 : 0;

    // Handle mouse/touch interaction on the bar
    const handleBarInteraction = useCallback(
      (clientX: number, isClick: boolean) => {
        if (!barRef.current || disabled || !onSetRating) return;

        const rect = barRef.current.getBoundingClientRect();
        const x = clientX - rect.left;
        let ratio = Math.max(0, Math.min(1, x / rect.width));

        // Extend clickable area slightly beyond the bar for easier max value selection
        // If within 5% of the end, snap to max
        if (ratio > 0.95) {
          ratio = 1.0;
        }
        // If within 2% of the start, snap to min
        if (ratio < 0.02 && ratio > 0) {
          ratio = minValue / maxValue;
        }

        // Map 0-1 ratio to 0-maxValue, then round to step
        const rawValue = ratio * maxValue;
        const steppedValue = roundToStep(rawValue);

        if (isClick) {
          // Toggle off if clicking same value
          if (
            currentDisplayValue !== null &&
            Math.abs(steppedValue - currentDisplayValue) < step / 2
          ) {
            onSetRating(null);
          } else {
            onSetRating(displayToRating100(steppedValue));
          }
          setHoverValue(null);
        } else {
          setHoverValue(steppedValue);
        }
      },
      [
        maxValue,
        minValue,
        step,
        currentDisplayValue,
        onSetRating,
        disabled,
        roundToStep,
        isStars,
      ]
    );

    const handleMouseMove = (e: React.MouseEvent) => {
      if (!disabled) {
        handleBarInteraction(e.clientX, false);
      }
    };

    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      handleBarInteraction(e.clientX, true);
    };

    const handleMouseLeave = () => {
      setHoverValue(null);
    };

    // Touch event handlers for mobile support
    const handleTouchStart = (e: React.TouchEvent) => {
      if (disabled || !onSetRating) return;
      e.stopPropagation();
      // Show hover value on initial touch
      const touch = e.touches[0];
      handleBarInteraction(touch.clientX, false);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (disabled || !onSetRating) return;
      e.preventDefault(); // Prevent scrolling while dragging
      e.stopPropagation();
      const touch = e.touches[0];
      handleBarInteraction(touch.clientX, false);
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
      if (disabled || !onSetRating) return;
      e.stopPropagation();
      // Use the last hover value to set rating
      if (hoverValue !== null) {
        // Toggle off if tapping same value
        if (
          currentDisplayValue !== null &&
          Math.abs(hoverValue - currentDisplayValue) < step / 2
        ) {
          onSetRating(null);
        } else {
          onSetRating(displayToRating100(hoverValue));
        }
      }
      setHoverValue(null);
    };

    // Format display text based on precision
    const formatValue = (val: number | null): string => {
      if (val === null) return "–";
      let formatted: string;
      if (isStars) {
        if (step === 0.1) formatted = val.toFixed(1);
        else if (step === 0.25) formatted = val.toFixed(2);
        else if (step === 0.5) formatted = val.toFixed(1);
        else formatted = val.toFixed(0);
      } else {
        formatted = val.toFixed(0);
      }
      return orMore ? `${formatted}+` : formatted;
    };

    // Calculate number of major tick marks (whole numbers only)
    const tickCount = maxValue;

    // Sizing based on compact mode
    const barHeight = compact ? 8 : 12;
    const fontSize = compact ? "0.9rem" : "1.1rem";
    const maxFontSize = compact ? "0.7rem" : "0.85rem";
    const minWidth = compact ? 100 : 160;
    const gap = compact ? 4 : 8;

    return (
      <Box
        className="rating-bar"
        onMouseLeave={handleMouseLeave}
        sx={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: `${gap}px`,
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? "default" : "pointer",
        }}
      >
        <Box
          className="rating-bar-label"
          sx={{
            display: "flex",
            alignItems: "baseline",
            gap: "2px",
            userSelect: "none",
            whiteSpace: "nowrap",
          }}
        >
          <Box
            component="span"
            className="rating-bar-value"
            sx={{
              fontSize,
              color: "text.primary",
            }}
          >
            {formatValue(displayValue)}
          </Box>
          <Box
            component="span"
            className="rating-bar-max"
            sx={{
              fontSize,
              color: "text.secondary",
            }}
          >
            /{maxValue}
          </Box>
        </Box>
        <Box
          ref={barRef}
          className="rating-bar-container"
          onMouseMove={handleMouseMove}
          onClick={handleClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          sx={{
            position: "relative",
            height: `${barHeight}px`,
            minWidth: `${minWidth}px`,
            maxWidth: compact ? 200 : 300,
            flexGrow: 1,
            borderRadius: `${barHeight / 2}px`,
            overflow: "hidden",
            cursor: disabled ? "default" : "pointer",
          }}
        >
          {/* Background */}
          <Box
            className="rating-bar-bg"
            sx={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(255, 255, 255, 0.15)",
              borderRadius: `${barHeight / 2}px`,
            }}
          />
          {/* Fill */}
          <Box
            className={`rating-bar-fill ${hoverValue !== null ? "hovering" : ""}`}
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: `${percentage}%`,
              background: hoverValue !== null
                ? "linear-gradient(90deg, #ffcc00, #ff9500)"
                : "linear-gradient(90deg, #ffd700, #ffaa00)",
              borderRadius: `${barHeight / 2}px`,
              transition: hoverValue !== null ? "none" : "width 0.1s ease",
              boxShadow: "0 0 8px rgba(255, 215, 0, 0.4)",
            }}
          />
          {/* Tick marks */}
          <Box
            className="rating-bar-ticks"
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              pointerEvents: "none",
            }}
          >
            {Array.from({ length: tickCount }, (_, i) => (
              <Box
                key={i + 1}
                className="rating-bar-tick"
                sx={{
                  position: "absolute",
                  left: `${((i + 1) / maxValue) * 100}%`,
                  width: "1px",
                  height: `${barHeight * 0.5}px`,
                  backgroundColor: "rgba(255, 255, 255, 0.25)",
                  borderRadius: "1px",
                  transform: "translateX(-50%)",
                }}
              />
            ))}
          </Box>
        </Box>
      </Box>
    );
  }
);
