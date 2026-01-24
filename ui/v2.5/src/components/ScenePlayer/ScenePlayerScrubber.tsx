import React, {
  CSSProperties,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { Box, IconButton, Typography, alpha, useTheme } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import TextUtils from "src/utils/text";
import { Icon } from "src/components/Shared/Icon";
import { logger } from "src/utils/logger";
import {
  faChevronRight,
  faChevronLeft,
} from "@fortawesome/free-solid-svg-icons";
import { useSpriteInfo } from "src/hooks/sprite";

const SCRUBBER_HEIGHT = 140;

interface IScenePlayerScrubberProps {
  file: GQL.VideoFileDataFragment;
  scene: GQL.SceneDataFragment;
  time: number;
  start?: number;
  end?: number;
  onSeek: (seconds: number) => void;
  onScroll: () => void;
}

interface ISceneSpriteItem {
  style: CSSProperties;
  time: string;
}

export const ScenePlayerScrubber: React.FC<IScenePlayerScrubberProps> = ({
  file,
  scene,
  time,
  start = 0,
  end,
  onSeek,
  onScroll,
}) => {
  const theme = useTheme();
  const contentEl = useRef<HTMLDivElement>(null);
  const indicatorEl = useRef<HTMLDivElement>(null);
  const sliderEl = useRef<HTMLDivElement>(null);
  const mouseDown = useRef(false);
  const lastMouseEvent = useRef<MouseEvent | null>(null);
  const startMouseEvent = useRef<MouseEvent | null>(null);
  const velocity = useRef(0);

  const prevTime = useRef(NaN);
  const _width = useRef(0);
  const [width, setWidth] = useState(0);
  const [scrubWidth, setScrubWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const position = useRef(0);
  const setPosition = useCallback(
    (value: number, seek: boolean) => {
      if (!scrubWidth) return;

      const slider = sliderEl.current!;
      const indicator = indicatorEl.current!;

      const midpointOffset = slider.clientWidth / 2;

      let newPosition: number;
      let percentage: number;
      if (value >= midpointOffset) {
        percentage = 0;
        newPosition = midpointOffset;
      } else if (value <= midpointOffset - scrubWidth) {
        percentage = 1;
        newPosition = midpointOffset - scrubWidth;
      } else {
        percentage = (midpointOffset - value) / scrubWidth;
        newPosition = value;
      }

      slider.style.transform = `translateX(${newPosition}px)`;
      indicator.style.transform = `translateX(${percentage * 100}%)`;

      position.current = newPosition;

      if (seek) {
        const duration = (end ?? file.duration ?? 0) - start;
        onSeek(start + percentage * duration);
      }
    },
    [onSeek, file.duration, scrubWidth, start, end]
  );

  const spriteInfo = useSpriteInfo(scene.paths.vtt ?? undefined);
  const [spriteItems, setSpriteItems] = useState<ISceneSpriteItem[]>();

  useEffect(() => {
    if (!spriteInfo) return;
    let totalWidth = 0;
    const newSprites: ISceneSpriteItem[] = [];

    // Virtual timeline bounds
    const virtualStart = start;
    const virtualEnd = end ?? Number.MAX_VALUE;

    spriteInfo.forEach((sprite) => {
      // Skip sprites strictly before start or strictly after end
      if (sprite.end < virtualStart || sprite.start > virtualEnd) {
        return;
      }

      totalWidth += sprite.w;
      // Position is based on cumulative width of *included* sprites
      const left = totalWidth - sprite.w;

      const style = {
        width: `${sprite.w}px`,
        height: `${sprite.h}px`,
        backgroundPosition: `${-sprite.x}px ${-sprite.y}px`,
        backgroundImage: `url(${sprite.url})`,
        left: `${left}px`,
      };

      // Adjust timestamps to be relative to the virtual start
      const relativeStart = Math.max(0, sprite.start - virtualStart);
      const relativeEnd = Math.max(0, sprite.end - virtualStart);

      const startStr = TextUtils.secondsToTimestamp(relativeStart);
      const endStr = TextUtils.secondsToTimestamp(relativeEnd);

      newSprites.push({
        style,
        time: `${startStr} - ${endStr}`,
      });
    });

    logger.debug("[Scrubber] Generated sprite items", { count: newSprites.length });

    setScrubWidth(totalWidth);
    setSpriteItems(newSprites);
  }, [spriteInfo, start, end]);

  useEffect(() => {
    const onResize = (entries: ResizeObserverEntry[]) => {
      const newWidth = entries[0].target.clientWidth;
      if (_width.current != newWidth) {
        // set prevTime to NaN to not use a transition when updating the slider position
        prevTime.current = NaN;
        _width.current = newWidth;
        setWidth(newWidth);
      }
    };

    const content = contentEl.current!;
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(content);

    return () => {
      resizeObserver.unobserve(content);
    };
  }, []);

  function setLinearTransition() {
    const slider = sliderEl.current!;
    slider.style.transition = "500ms linear";
  }

  function setEaseOutTransition() {
    const slider = sliderEl.current!;
    slider.style.transition = "333ms ease-out";
  }

  function clearTransition() {
    const slider = sliderEl.current!;
    slider.style.transition = "";
  }

  // Update slider position when player time changes
  useEffect(() => {
    if (!scrubWidth || !width) return;

    const duration = (end ?? Number(file.duration)) - start;
    if (duration <= 0) return;

    // Clamp time to start/end for display purposes
    const displayTime = Math.max(start, Math.min(time, end ?? Number(file.duration)));
    const percentage = (displayTime - start) / duration;

    const newPosition = width / 2 - percentage * scrubWidth;

    // Ignore position changes of < 1px
    if (Math.abs(newPosition - position.current) < 1) return;

    const delta = Math.abs(time - prevTime.current);
    if (isNaN(delta)) {
      // Don't use a transition on initial time change or after resize
      clearTransition();
    } else if (delta <= 1) {
      // If time changed by < 1s, use linear transition instead of ease-out
      setLinearTransition();
    } else {
      setEaseOutTransition();
    }
    prevTime.current = time;

    setPosition(newPosition, false);
  }, [file.duration, setPosition, time, width, scrubWidth, start, end]);

  const onMouseUp = useCallback(
    (event: MouseEvent) => {
      if (!mouseDown.current) return;
      const slider = sliderEl.current!;

      mouseDown.current = false;
      setIsDragging(false);

      let newPosition = position.current;
      const midpointOffset = slider.clientWidth / 2;
      const delta = Math.abs(event.clientX - startMouseEvent.current!.clientX);
      if (delta < 1 && event.target instanceof HTMLDivElement) {
        const { target } = event;

        if (target.hasAttribute("data-sprite-item-id")) {
          newPosition = midpointOffset - (target.offsetLeft + event.offsetX);
        }

        if (target.hasAttribute("data-marker-id")) {
          newPosition = midpointOffset - target.offsetLeft;
        }
      }
      if (Math.abs(velocity.current) > 25) {
        newPosition = position.current + velocity.current * 10;
        velocity.current = 0;
      }

      setEaseOutTransition();
      setPosition(newPosition, true);
    },
    [setPosition]
  );

  const onMouseDown = useCallback((event: MouseEvent) => {
    // Only if left mouse button pressed
    if (event.button !== 0) return;

    event.preventDefault();

    mouseDown.current = true;
    lastMouseEvent.current = event;
    startMouseEvent.current = event;
    velocity.current = 0;
  }, []);

  const onMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!mouseDown.current) return;

      // negative dragging right (past), positive left (future)
      const delta = event.clientX - lastMouseEvent.current!.clientX;

      if (lastMouseEvent.current === startMouseEvent.current) {
        // this is the first mousemove event after mousedown

        // #4295: a mousemove with delta 0 can be sent when just clicking
        // ignore such an event to prevent pausing the player
        if (delta === 0) return;

        onScroll();
      }

      setIsDragging(true);

      const movement = event.movementX;
      velocity.current = movement;

      clearTransition();
      setPosition(position.current + delta, false);
      lastMouseEvent.current = event;
    },
    [onScroll, setPosition]
  );

  useEffect(() => {
    const content = contentEl.current!;

    content.addEventListener("mousedown", onMouseDown, false);
    content.addEventListener("mousemove", onMouseMove, false);
    window.addEventListener("mouseup", onMouseUp, false);

    return () => {
      content.removeEventListener("mousedown", onMouseDown);
      content.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseDown, onMouseMove, onMouseUp]);

  function goBack() {
    const slider = sliderEl.current!;
    const newPosition = position.current + slider.clientWidth;
    setEaseOutTransition();
    setPosition(newPosition, true);
  }

  function goForward() {
    const slider = sliderEl.current!;
    const newPosition = position.current - slider.clientWidth;
    setEaseOutTransition();
    setPosition(newPosition, true);
  }

  function renderTags() {
    if (!spriteItems) return null;

    return scene.scene_markers.map((marker, index) => {
      const duration = (end ?? Number(file.duration)) - start;
      // Filter markers outside of range
      if (marker.seconds < start || (end && marker.seconds > end)) return null;

      const left = (scrubWidth * (marker.seconds - start)) / duration;

      return (
        <Box
          key={index}
          data-marker-id={index}
          sx={{
            position: "absolute",
            left: `${left}px`,
            transform: "translateX(-50%)",
            height: 20,
            px: 1.25,
            fontSize: "10px",
            whiteSpace: "nowrap",
            cursor: "pointer",
            backgroundColor: alpha(theme.palette.common.black, 0.85),
            color: theme.palette.common.white,
            borderRadius: "4px 4px 0 0",
            display: "flex",
            alignItems: "center",
            transition: "background-color 0.2s ease",
            "&:hover": {
              backgroundColor: alpha(theme.palette.primary.main, 0.7),
            },
            "&::after": {
              content: '""',
              position: "absolute",
              bottom: -5,
              left: "50%",
              marginLeft: "-5px",
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: `5px solid ${alpha(theme.palette.common.black, 0.85)}`,
            },
            "&:hover::after": {
              borderTopColor: alpha(theme.palette.primary.main, 0.7),
            },
          }}
        >
          {marker.title || marker.primary_tag.name}
        </Box>
      );
    });
  }

  function renderSprites() {
    if (!scene.paths.vtt) return null;

    return spriteItems?.map((sprite, index) => (
      <Box
        key={index}
        data-sprite-item-id={index}
        sx={{
          position: "absolute",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          color: theme.palette.common.white,
          fontSize: "10px",
          textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
          ...sprite.style,
        }}
      >
        <Typography
          variant="caption"
          sx={{
            display: "block",
            width: "100%",
            textAlign: "center",
            pb: 0.25,
            fontSize: "inherit",
          }}
        >
          {sprite.time}
        </Typography>
      </Box>
    ));
  }

  return (
    <Box
      className="scrubber-wrapper"
      sx={{
        display: "flex",
        flexShrink: 0,
        my: 0.5,
        overflow: "hidden",
        position: "relative",
        borderRadius: 1,
        backgroundColor: alpha(theme.palette.background.paper, 0.5),
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Back Button */}
      <IconButton
        onClick={goBack}
        size="small"
        sx={{
          borderRadius: 0,
          width: 32,
          height: SCRUBBER_HEIGHT,
          color: theme.palette.primary.main,
          backgroundColor: alpha(theme.palette.background.default, 0.6),
          border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
          "&:hover": {
            backgroundColor: alpha(theme.palette.primary.main, 0.15),
          },
        }}
      >
        <Icon icon={faChevronLeft} />
      </IconButton>

      {/* Scrubber Content */}
      <Box
        ref={contentEl}
        sx={{
          display: "inline-block",
          flexGrow: 1,
          height: SCRUBBER_HEIGHT,
          mx: 0.5,
          overflow: "hidden",
          position: "relative",
          cursor: isDragging ? "grabbing" : "pointer",
          userSelect: "none",
          WebkitUserSelect: "none",
          borderRadius: 0.5,
        }}
      >
        {/* Tags Background */}
        <Box
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 20,
            backgroundColor: alpha(theme.palette.grey[800], 0.8),
          }}
        />

        {/* Heatmap */}
        {scene.paths.interactive_heatmap && (
          <Box
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              height: 20,
              backgroundImage: `url(${scene.paths.interactive_heatmap})`,
              backgroundSize: "100% 100%",
            }}
          />
        )}

        {/* Position Indicator (progress background) */}
        <Box
          ref={indicatorEl}
          sx={{
            position: "absolute",
            left: "-100%",
            width: "100%",
            height: 24,
            backgroundColor: alpha(theme.palette.primary.main, 0.25),
            zIndex: 0,
          }}
        />

        {/* Current Position Line */}
        <Box
          sx={{
            position: "absolute",
            left: "50%",
            width: 2,
            height: 34,
            backgroundColor: theme.palette.primary.main,
            boxShadow: `0 0 8px ${alpha(theme.palette.primary.main, 0.6)}`,
            zIndex: 2,
          }}
        />

        {/* Viewport */}
        <Box
          sx={{
            height: "100%",
            overflow: "hidden",
            position: "static",
          }}
        >
          {/* Slider */}
          <Box
            ref={sliderEl}
            sx={{
              height: "100%",
              left: 0,
              position: "absolute",
              width: "100%",
            }}
          >
            {/* Tags */}
            <Box
              sx={{
                height: 20,
                mb: 1.25,
                position: "relative",
              }}
            >
              {renderTags()}
            </Box>

            {/* Sprites */}
            {renderSprites()}
          </Box>
        </Box>
      </Box>

      {/* Forward Button */}
      <IconButton
        onClick={goForward}
        size="small"
        sx={{
          borderRadius: 0,
          width: 32,
          height: SCRUBBER_HEIGHT,
          color: theme.palette.primary.main,
          backgroundColor: alpha(theme.palette.background.default, 0.6),
          border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
          "&:hover": {
            backgroundColor: alpha(theme.palette.primary.main, 0.15),
          },
        }}
      >
        <Icon icon={faChevronRight} />
      </IconButton>
    </Box>
  );
};
