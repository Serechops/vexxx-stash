/* eslint-disable @typescript-eslint/naming-convention */
import videojs, { VideoJsPlayer } from "video.js";
import React, { useState, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import {
  getRatingPrecision,
  RatingSystemType,
  RatingStarPrecision,
  defaultRatingStarPrecision,
} from "src/utils/rating";

// Horizontal bar rating component optimized for video overlay
// Backend uses 1-100 scale with minimum 20 (= 1 star)
// Stars: 0.1-5 display -> 2-100 rating100 (with precision support)
// Decimal: 1-10 display -> 10-100 rating100
interface FullscreenRatingGaugeProps {
  value: number | null;
  onSetRating: (value: number | null) => void;
  ratingSystemType: RatingSystemType;
  precision: RatingStarPrecision;
}

const FullscreenRatingGauge: React.FC<FullscreenRatingGaugeProps> = ({
  value,
  onSetRating,
  ratingSystemType,
  precision,
}) => {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  
  const isStars = ratingSystemType === RatingSystemType.Stars;
  const maxValue = isStars ? 5 : 10;
  
  // Get step size based on precision
  const step = isStars ? getRatingPrecision(precision) : 1;
  
  // Minimum value is the step size (smallest possible rating)
  const minValue = step;
  
  // Convert rating100 to display value - NO rounding, preserve precision
  const rating100ToDisplay = (rating100: number | null): number | null => {
    if (rating100 === null) return null;
    if (isStars) {
      // rating100 / 20 gives 0-5 scale
      // Round to nearest step to handle floating point
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
      // Clamp to valid range (step*20 to 100)
      return Math.max(step * 20, Math.min(100, Math.round(display * 20)));
    }
    // display * 10 gives rating100
    return Math.max(10, Math.min(100, display * 10));
  };
  
  // Round to nearest step
  const roundToStep = (val: number): number => {
    const rounded = Math.round(val / step) * step;
    // Ensure we stay within valid range
    return Math.max(minValue, Math.min(maxValue, rounded));
  };
  
  const currentDisplayValue = rating100ToDisplay(value);
  const displayValue = hoverValue !== null ? hoverValue : currentDisplayValue;
  
  // Calculate percentage for bar fill (0 to maxValue range)
  const percentage = displayValue !== null ? (displayValue / maxValue) * 100 : 0;
  
  // Handle mouse/touch interaction on the bar
  const handleBarInteraction = useCallback((clientX: number, isClick: boolean) => {
    if (!barRef.current) return;
    
    const rect = barRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    
    // Map 0-1 ratio to 0-maxValue, then round to step
    const rawValue = ratio * maxValue;
    const steppedValue = roundToStep(rawValue);
    
    if (isClick) {
      // Toggle off if clicking same value
      if (currentDisplayValue !== null && Math.abs(steppedValue - currentDisplayValue) < step / 2) {
        onSetRating(null);
      } else {
        onSetRating(displayToRating100(steppedValue));
      }
      setHoverValue(null);
    } else {
      setHoverValue(steppedValue);
    }
  }, [maxValue, step, currentDisplayValue, onSetRating, minValue]);
  
  const handleMouseMove = (e: React.MouseEvent) => {
    handleBarInteraction(e.clientX, false);
  };
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleBarInteraction(e.clientX, true);
  };
  
  const handleMouseLeave = () => {
    setHoverValue(null);
  };
  
  // Format display text based on precision
  const formatValue = (val: number | null): string => {
    if (val === null) return "–";
    if (isStars) {
      // Show decimal places based on precision
      if (step === 0.1) return val.toFixed(1);
      if (step === 0.25) return val.toFixed(2);
      if (step === 0.5) return val.toFixed(1);
      return val.toFixed(0);
    }
    return val.toFixed(0);
  };
  
  // Calculate number of major tick marks (whole numbers only)
  const tickCount = maxValue;

  return (
    <div className="fullscreen-rating-gauge horizontal" onMouseLeave={handleMouseLeave}>
      <div className="rating-label">
        <span className="rating-value">{formatValue(displayValue)}</span>
        <span className="rating-max">/{maxValue}</span>
      </div>
      <div 
        ref={barRef}
        className="rating-bar-container"
        onMouseMove={handleMouseMove}
        onClick={handleClick}
      >
        <div className="rating-bar-bg" />
        <div 
          className={`rating-bar-fill ${hoverValue !== null ? "hovering" : ""}`}
          style={{ width: `${percentage}%` }}
        />
        {/* Tick marks for whole number values */}
        <div className="rating-ticks">
          {Array.from({ length: tickCount }, (_, i) => (
            <div 
              key={i + 1}
              className="rating-tick"
              style={{ left: `${((i + 1) / maxValue) * 100}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

interface IRatingButtonOptions {
  rating?: number | null;
  onSetRating?: (value: number | null) => void;
  ratingSystemType?: RatingSystemType;
  precision?: RatingStarPrecision;
}

interface RatingButtonOptions extends videojs.ComponentOptions {
  rating?: number | null;
  onSetRating?: (value: number | null) => void;
  ratingSystemType?: RatingSystemType;
  precision?: RatingStarPrecision;
}

class RatingButtonComponent extends videojs.getComponent("Component") {
  private rating: number | null;
  private onSetRating?: (value: number | null) => void;
  private ratingSystemType: RatingSystemType;
  private precision: RatingStarPrecision;

  constructor(player: VideoJsPlayer, options: RatingButtonOptions) {
    super(player, options);
    this.rating = options.rating ?? null;
    this.onSetRating = options.onSetRating;
    this.ratingSystemType = options.ratingSystemType ?? RatingSystemType.Stars;
    this.precision = options.precision ?? defaultRatingStarPrecision;
    
    this.addClass("vjs-rating-button-component");
    this.render();
  }

  buildCSSClass() {
    return `vjs-rating-button ${super.buildCSSClass()}`;
  }

  private render() {
    const container = this.el();
    
    if (!this.onSetRating) {
      return;
    }
    
    // Render React component using React 17 API
    ReactDOM.render(
      <div 
        className="rating-overlay-container"
        onClick={(e) => e.stopPropagation()} // Prevent video player clicks
      >
        <FullscreenRatingGauge
          value={this.rating}
          onSetRating={this.onSetRating}
          ratingSystemType={this.ratingSystemType}
          precision={this.precision}
        />
      </div>,
      container
    );
  }

  public updateRating(rating: number | null) {
    this.rating = rating;
    this.render();
  }

  dispose() {
    const container = this.el();
    ReactDOM.unmountComponentAtNode(container);
    super.dispose();
  }
}

class RatingButtonPlugin extends videojs.getPlugin("plugin") {
  private component: RatingButtonComponent | null = null;
  private rating: number | null;
  private onSetRating?: (value: number | null) => void;
  private ratingSystemType: RatingSystemType;
  private precision: RatingStarPrecision;

  constructor(player: VideoJsPlayer, options?: IRatingButtonOptions) {
    super(player, options);

    this.rating = options?.rating ?? null;
    this.onSetRating = options?.onSetRating;
    this.ratingSystemType = options?.ratingSystemType ?? RatingSystemType.Stars;
    this.precision = options?.precision ?? defaultRatingStarPrecision;

    player.ready(() => {
      this.ready();
    });
  }

  private ready() {
    if (!this.onSetRating) {
      // Don't show rating button if there's no way to update
      return;
    }

    // Create the component
    this.component = new RatingButtonComponent(this.player, {
      rating: this.rating,
      onSetRating: this.onSetRating,
      ratingSystemType: this.ratingSystemType,
      precision: this.precision,
    });

    // Add as overlay to video container (not control bar)
    // This allows us to position it anywhere on the video
    this.player.addChild(this.component);
  }

  public updateRating(rating: number | null) {
    this.rating = rating;
    if (this.component) {
      this.component.updateRating(rating);
    }
  }

  public setOnSetRating(callback: (value: number | null) => void) {
    this.onSetRating = callback;
    // If component doesn't exist yet, create it
    if (!this.component) {
      this.ready();
    }
  }
}

// Register the plugin with video.js
videojs.registerComponent("RatingButtonComponent", RatingButtonComponent);
videojs.registerPlugin("ratingButton", RatingButtonPlugin);

declare module "video.js" {
  interface VideoJsPlayer {
    ratingButton: () => RatingButtonPlugin;
  }
  interface VideoJsPlayerPluginOptions {
    ratingButton?: IRatingButtonOptions;
  }
}

export default RatingButtonPlugin;
