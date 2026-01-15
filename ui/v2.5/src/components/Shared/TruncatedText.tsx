import React, { useRef, useState } from "react";
import { Box, Tooltip } from "@mui/material";
import cx from "classnames";
import { useDebounce } from "src/hooks/debounce";
import { PatchComponent } from "src/patch";

const CLASSNAME = "TruncatedText";
const CLASSNAME_TOOLTIP = `${CLASSNAME}-tooltip`;

type PlacementType = "top" | "bottom" | "left" | "right";

interface ITruncatedTextProps {
  text?: JSX.Element | string | null;
  lineCount?: number;
  placement?: PlacementType;
  delay?: number;
  className?: string;
}

export const TruncatedText: React.FC<ITruncatedTextProps> = PatchComponent(
  "TruncatedText",
  ({ text, className, lineCount = 1, placement = "bottom", delay = 1000 }) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const target = useRef(null);

    const startShowingTooltip = useDebounce(() => setShowTooltip(true), delay);

    if (!text) return <></>;

    const handleFocus = (element: HTMLElement) => {
      // Check if visible size is smaller than the content size
      if (
        element.offsetWidth < element.scrollWidth ||
        element.offsetHeight + 10 < element.scrollHeight
      )
        startShowingTooltip();
    };

    const handleBlur = () => {
      startShowingTooltip.cancel();
      setShowTooltip(false);
    };

    return (
      <Tooltip
        title={text}
        open={showTooltip}
        placement={placement}
        classes={{ tooltip: CLASSNAME_TOOLTIP }}
      >
        <Box
          className={className} // Preserve custom classNames passed from usage sites if any, or migrate them too.
          // Note: The original had CLASSNAME ("TruncatedText") which presumably had some base styles.
          // We need to inline those base styles into sx.
          // .TruncatedText {
          //   -webkit-box-orient: vertical;
          //   display: -webkit-box;
          //   overflow: hidden;
          //   white-space: pre-line;
          // }
          sx={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            whiteSpace: "pre-line",
            WebkitLineClamp: lineCount,
            // Also handle usage site styles if needed
            "&.inline": { // Migrating .TruncatedText.inline logic
              display: "inline",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              WebkitLineClamp: "unset", // Reset line clamp for inline
              WebkitBoxOrient: "unset", // Reset box orient
            }
          }}
          ref={target}
          onMouseEnter={(e) => handleFocus(e.currentTarget)}
          onFocus={(e) => handleFocus(e.currentTarget)}
          onMouseLeave={handleBlur}
          onBlur={handleBlur}
        >
          {text}
        </Box>
      </Tooltip>
    );
  }
);

export const TruncatedInlineText: React.FC<ITruncatedTextProps> = ({
  text,
  className,
  placement = "bottom",
  delay = 1000,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const target = useRef(null);

  const startShowingTooltip = useDebounce(() => setShowTooltip(true), delay);

  if (!text) return <></>;

  const handleFocus = (element: HTMLElement) => {
    // Check if visible size is smaller than the content size
    if (
      element.offsetWidth < element.scrollWidth ||
      element.offsetHeight + 10 < element.scrollHeight
    )
      startShowingTooltip();
  };

  const handleBlur = () => {
    startShowingTooltip.cancel();
    setShowTooltip(false);
  };

  return (
    <Tooltip
      title={text}
      open={showTooltip}
      placement={placement}
      classes={{ tooltip: CLASSNAME_TOOLTIP }}
    >
      <Box
        component="span"
        className={className} // Keep external class
        sx={{
          display: "inline",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          overflow: "hidden" // Ensure overflow hidden is present for ellipsis
        }}
        ref={target}
        onMouseEnter={(e) => handleFocus(e.currentTarget)}
        onFocus={(e) => handleFocus(e.currentTarget)}
        onMouseLeave={handleBlur}
        onBlur={handleBlur}
      >
        {text}
      </Box>
    </Tooltip>
  );
};
