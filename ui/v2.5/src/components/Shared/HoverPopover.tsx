import React, { useState, useCallback, useEffect, useRef } from "react";
import { Popover, PopoverProps } from "@mui/material";
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

    const getOrigin = (placement: string) => {
      switch (placement) {
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

    return (
      <>
        <div
          className={className}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          ref={triggerRef}
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
          sx={{ 
            pointerEvents: 'none',
            '& .MuiPopover-paper': {
              pointerEvents: 'auto'
            }
          }}
        >
          <div
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{ maxWidth: '32rem', textAlign: 'center' }}
          >
            {content}
          </div>
        </Popover>
      </>
    );
  }
);
