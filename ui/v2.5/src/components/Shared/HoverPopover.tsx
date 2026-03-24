import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Popover } from "@mui/material";
import { PatchComponent } from "src/patch";

interface IHoverPopover {
  enterDelay?: number;
  leaveDelay?: number;
  content: JSX.Element[] | JSX.Element | string;
  className?: string;
  placement?: "top" | "bottom" | "left" | "right";
  onOpen?: () => void;
  onClose?: () => void;
  target?: React.RefObject<HTMLElement>;
}

const ARROW = 10; // px — half the arrow diamond size

export const HoverPopover: React.FC<IHoverPopover> = PatchComponent(
  "HoverPopover",
  ({
    enterDelay = 200,
    leaveDelay = 200,
    content,
    children,
    className,
    placement = "top",
    onOpen,
    onClose,
    target,
  }) => {
    const [show, setShow] = useState(false);
    const triggerRef = useRef<HTMLDivElement>(null);
    const enterTimer = useRef<number>();
    const leaveTimer = useRef<number>();

    const handleMouseEnter = useCallback(() => {
      window.clearTimeout(leaveTimer.current);
      enterTimer.current = window.setTimeout(() => {
        setShow(true);
        onOpen?.();
      }, enterDelay);
    }, [enterDelay, onOpen]);

    const handleMouseLeave = useCallback(() => {
      window.clearTimeout(enterTimer.current);
      leaveTimer.current = window.setTimeout(() => {
        setShow(false);
        onClose?.();
      }, leaveDelay);
    }, [leaveDelay, onClose]);

    useEffect(
      () => () => {
        window.clearTimeout(enterTimer.current);
        window.clearTimeout(leaveTimer.current);
      },
      []
    );

    const getOrigin = (p: string) => {
      switch (p) {
        case "top":
          return {
            anchorOrigin: { vertical: "top", horizontal: "center" } as const,
            transformOrigin: { vertical: "bottom", horizontal: "center" } as const,
          };
        case "bottom":
          return {
            anchorOrigin: { vertical: "bottom", horizontal: "center" } as const,
            transformOrigin: { vertical: "top", horizontal: "center" } as const,
          };
        case "left":
          return {
            anchorOrigin: { vertical: "center", horizontal: "left" } as const,
            transformOrigin: { vertical: "center", horizontal: "right" } as const,
          };
        case "right":
          return {
            anchorOrigin: { vertical: "center", horizontal: "right" } as const,
            transformOrigin: { vertical: "center", horizontal: "left" } as const,
          };
        default:
          return {
            anchorOrigin: { vertical: "top", horizontal: "center" } as const,
            transformOrigin: { vertical: "bottom", horizontal: "center" } as const,
          };
      }
    };

    const { anchorOrigin, transformOrigin } = getOrigin(placement);

    // Offset the paper away from the anchor to leave room for the arrow tail.
    const paperMargin = {
      top:    { marginBottom: `${ARROW}px` },
      bottom: { marginTop:    `${ARROW}px` },
      left:   { marginRight:  `${ARROW}px` },
      right:  { marginLeft:   `${ARROW}px` },
    }[placement] ?? {};

    // Arrow tail: a rotated square that straddles the paper edge.
    // Half of it overlaps the paper (same bgcolor → invisible there),
    // the other half sticks out to form the visible point.
    const arrowSx = {
      top: {
        bottom: `${-ARROW}px`,
        left:   `calc(50% - ${ARROW}px)`,
      },
      bottom: {
        top:  `${-ARROW}px`,
        left: `calc(50% - ${ARROW}px)`,
      },
      left: {
        right: `${-ARROW}px`,
        top:   `calc(50% - ${ARROW}px)`,
      },
      right: {
        left: `${-ARROW}px`,
        top:  `calc(50% - ${ARROW}px)`,
      },
    }[placement] ?? {};

    return (
      <>
        <div
          className={className}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          ref={triggerRef}
          style={{ display: 'inline-block' }}
        >
          {children}
        </div>
        <Popover
          open={show}
          anchorEl={target?.current ?? triggerRef.current}
          onClose={() => {
            setShow(false);
            onClose?.();
          }}
          anchorOrigin={anchorOrigin}
          transformOrigin={transformOrigin}
          disableRestoreFocus
          hideBackdrop
          slotProps={{
            paper: {
              sx: {
                overflow: "visible",
                pointerEvents: "auto",
                ...paperMargin,
              },
            },
          }}
          sx={{ pointerEvents: "none" }}
        >
          <Box
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            sx={{ maxWidth: "32rem", textAlign: "center", position: "relative" }}
          >
            {content}
            {/* Arrow tail */}
            <Box
              sx={{
                position: "absolute",
                width:  ARROW * 2,
                height: ARROW * 2,
                bgcolor: "background.paper",
                transform: "rotate(45deg)",
                ...arrowSx,
              }}
            />
          </Box>
        </Popover>
      </>
    );
  }
);
