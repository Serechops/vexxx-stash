import React, { useMemo } from "react";
import cx from "classnames";
import { Box } from "@mui/material";

// #5231: TouchEvent is not defined on all browsers
const touchEventDefined = window.TouchEvent !== undefined;

interface IHoverScrubber {
  totalSprites: number;
  activeIndex: number | undefined;
  setActiveIndex: (index: number | undefined) => void;
  onClick?: (index: number) => void;
}

export const HoverScrubber: React.FC<IHoverScrubber> = ({
  totalSprites,
  activeIndex,
  setActiveIndex,
  onClick,
}) => {
  function getActiveIndex(
    e:
      | React.MouseEvent<HTMLDivElement, MouseEvent>
      | React.TouchEvent<HTMLDivElement>
  ) {
    const { width } = e.currentTarget.getBoundingClientRect();

    let x = 0;
    if (e.nativeEvent instanceof MouseEvent) {
      x = e.nativeEvent.offsetX;
    } else if (touchEventDefined && e.nativeEvent instanceof TouchEvent) {
      x =
        e.nativeEvent.touches[0].clientX -
        e.currentTarget.getBoundingClientRect().x;
    }

    const i = Math.round((x / width) * (totalSprites - 1));

    // clamp to [0, totalSprites)
    if (i < 0) return 0;
    if (i >= totalSprites) return totalSprites - 1;
    return i;
  }

  function onMove(
    e:
      | React.MouseEvent<HTMLDivElement, MouseEvent>
      | React.TouchEvent<HTMLDivElement>
  ) {
    const relatedTarget = e.currentTarget;

    if (
      (e instanceof MouseEvent && relatedTarget !== e.target) ||
      (touchEventDefined &&
        e instanceof TouchEvent &&
        document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY))
    )
      return;

    setActiveIndex(getActiveIndex(e));
  }

  function onLeave() {
    setActiveIndex(undefined);
  }

  function onScrubberClick(
    e:
      | React.MouseEvent<HTMLDivElement, MouseEvent>
      | React.TouchEvent<HTMLDivElement>
  ) {
    if (!onClick) return;

    const relatedTarget = e.currentTarget;

    if (
      (e instanceof MouseEvent && relatedTarget !== e.target) ||
      (touchEventDefined &&
        e instanceof TouchEvent &&
        document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY))
    )
      return;

    e.preventDefault();
    e.stopPropagation();

    const i = getActiveIndex(e);
    if (i === undefined) return;
    onClick(i);
  }

  const indicatorStyle = useMemo(() => {
    if (activeIndex === undefined || !totalSprites) return {};

    const width = ((activeIndex + 1) / totalSprites) * 100;

    return {
      width: `${width}%`,
    };
  }, [activeIndex, totalSprites]);

  return (
    <Box
      className={cx("hover-scrubber", {
        "hover-scrubber-inactive": !totalSprites,
      })}
      sx={{
        bottom: 0,
        height: "20px",
        overflow: "hidden",
        position: "absolute",
        width: "100%",
        "&.hover-scrubber-inactive": {
          "& .hover-scrubber-area": {
            cursor: "inherit"
          }
        }
      }}
    >
      <Box
        className="hover-scrubber-area"
        onMouseMove={onMove}
        onTouchMove={onMove}
        onMouseLeave={onLeave}
        onTouchEnd={onLeave}
        onTouchCancel={onLeave}
        onClick={onScrubberClick}
        sx={{
          cursor: "col-resize",
          height: "100%",
          position: "absolute",
          width: "100%",
          zIndex: 1
        }}
      />
      <Box
        className="hover-scrubber-indicator"
        sx={{
          bottom: 0,
          height: "4px",
          position: "absolute",
          width: "100%"
        }}
      >
        {activeIndex !== undefined && (
          <Box
            className="hover-scrubber-indicator-marker"
            style={indicatorStyle}
            sx={{
              backgroundColor: "primary.main",
              height: "100%",
              transition: "width 0.1s"
            }}
          />
        )}
      </Box>
    </Box>
  );
};
