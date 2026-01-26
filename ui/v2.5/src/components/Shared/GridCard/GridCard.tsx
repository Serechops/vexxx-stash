import React, {
  MutableRefObject,
  PropsWithChildren,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Card, Checkbox as MuiCheckbox, alpha } from "@mui/material";
import { Link } from "react-router-dom";
import cx from "classnames";
import { TruncatedText } from "../TruncatedText";
import ScreenUtils from "src/utils/screen";
import useResizeObserver from "@react-hook/resize-observer";
import { Icon } from "../Icon";
import { faGripLines } from "@fortawesome/free-solid-svg-icons";
import { DragSide, useDragMoveSelect } from "./dragMoveSelect";
import { useDebounce } from "src/hooks/debounce";
import { PatchComponent } from "src/patch";

interface ICardProps {
  className?: string;
  linkClassName?: string;
  thumbnailSectionClassName?: string;
  width?: number;
  url: string;
  pretitleIcon?: JSX.Element;
  title?: JSX.Element | string | null;
  image: JSX.Element;
  details?: JSX.Element;
  overlays?: JSX.Element;
  popovers?: JSX.Element;
  selecting?: boolean;
  selected?: boolean;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
  resumeTime?: number;
  duration?: number;
  interactiveHeatmap?: string;

  // move logic - both of the following are required to enable move dragging
  objectId?: string; // required for move dragging
  onMove?: (srcIds: string[], targetId: string, after: boolean) => void;
}

export const calculateCardWidth = (
  containerWidth: number,
  preferredWidth: number
) => {
  const containerPadding = 30;
  const cardMargin = 10;
  let maxUsableWidth = containerWidth - containerPadding;
  let maxElementsOnRow = Math.ceil(maxUsableWidth / preferredWidth);
  return maxUsableWidth / maxElementsOnRow - cardMargin;
};

interface IDimension {
  width: number;
  height: number;
}

export const useContainerDimensions = <T extends HTMLElement = HTMLDivElement>(
  sensitivityThreshold = 20
): [MutableRefObject<T | null>, IDimension] => {
  const target = useRef<T | null>(null);
  const [dimension, setDimension] = useState<IDimension>({
    width: 0,
    height: 0,
  });

  const debouncedSetDimension = useDebounce((entry: ResizeObserverEntry) => {
    const { inlineSize: width, blockSize: height } = entry.contentBoxSize[0];
    let difference = Math.abs(dimension.width - width);
    // Only adjust when width changed by a significant margin. This addresses the cornercase that sees
    // the dimensions toggle back and forward when the window is adjusted perfectly such that overflow
    // is trigger then immediable disabled because of a resize event then continues this loop endlessly.
    // the scrollbar size varies between platforms. Windows is apparently around 17 pixels.
    if (difference > sensitivityThreshold) {
      setDimension({ width, height });
    }
  }, 50);

  useResizeObserver(target, debouncedSetDimension);

  return [target, dimension];
};

export function useCardWidth(
  containerWidth: number,
  zoomIndex: number,
  zoomWidths: number[]
) {
  return useMemo(() => {
    if (
      !containerWidth ||
      zoomIndex === undefined ||
      zoomIndex < 0 ||
      zoomIndex >= zoomWidths.length ||
      ScreenUtils.isMobile()
    )
      return;

    let zoomValue = zoomIndex;
    const preferredCardWidth = zoomWidths[zoomValue];
    let fittedCardWidth = calculateCardWidth(
      containerWidth,
      preferredCardWidth!
    );
    return fittedCardWidth;
  }, [containerWidth, zoomIndex, zoomWidths]);
}

const Checkbox: React.FC<{
  selected?: boolean;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
}> = ({ selected = false, onSelectedChanged }) => {
  let shiftKey = false;

  return (
    <MuiCheckbox
      // #2750 - add mousetrap class to ensure keyboard shortcuts work
      className="card-check mousetrap"
      checked={selected}
      onChange={() => onSelectedChanged!(!selected, shiftKey)}
      onClick={(event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
        shiftKey = event.shiftKey;
        event.stopPropagation();
      }}
      size="small"
      sx={{
        color: "grey.400",
        bgcolor: (t) => alpha(t.palette.background.paper, 0.8),
        backdropFilter: "blur(4px)",
        borderRadius: 1,
        p: 0.5,
        "&.Mui-checked": {
          color: "primary.main",
        },
        "&:hover": {
          bgcolor: (t) => alpha(t.palette.background.paper, 0.95),
        },
      }}
    />
  );
};

const DragHandle: React.FC<{
  setInHandle: (inHandle: boolean) => void;
}> = ({ setInHandle }) => {
  function onMouseEnter() {
    setInHandle(true);
  }

  function onMouseLeave() {
    setInHandle(false);
  }

  return (
    <Box
      component="span"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "grab",
        p: 0.5,
        borderRadius: 1,
        bgcolor: (t) => alpha(t.palette.background.paper, 0.8),
        backdropFilter: "blur(4px)",
        color: "grey.400",
        transition: "all 0.15s ease",
        "&:hover": {
          bgcolor: (t) => alpha(t.palette.background.paper, 0.95),
          color: "grey.200",
        },
        "&:active": {
          cursor: "grabbing",
        },
      }}
      className="card-drag-handle-container"
    >
      <Icon className="card-drag-handle" icon={faGripLines} />
    </Box>
  );
};

const Controls: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  return (
    <Box
      className="card-controls"
      sx={{
        position: "absolute",
        top: 8,
        left: 8,
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        opacity: 0,
        transition: "opacity 0.2s ease",
        ".stash-grid-card:hover &": {
          opacity: 1,
        },
      }}
    >
      {children}
    </Box>
  );
};

const MoveTarget: React.FC<{ dragSide: DragSide }> = ({ dragSide }) => {
  if (dragSide === undefined) {
    return null;
  }

  return (
    <Box
      className={`move-target move-target-${dragSide === DragSide.BEFORE ? "before" : "after"}`}
    ></Box>
  );
};

export const GridCard: React.FC<ICardProps> = PatchComponent(
  "GridCard",
  (props: ICardProps) => {
    const { setInHandle, moveTarget, dragProps } = useDragMoveSelect({
      selecting: props.selecting || false,
      selected: props.selected || false,
      onSelectedChanged: props.onSelectedChanged,
      objectId: props.objectId,
      onMove: props.onMove,
    });

    function handleImageClick(
      event: React.MouseEvent<HTMLElement, MouseEvent>
    ) {
      const { shiftKey } = event;

      if (!props.onSelectedChanged) {
        return;
      }

      if (props.selecting) {
        props.onSelectedChanged(!props.selected, shiftKey);
        event.preventDefault();
        event.stopPropagation();
      }
    }

    function maybeRenderInteractiveHeatmap() {
      if (props.interactiveHeatmap) {
        return (
          <img
            loading="lazy"
            src={props.interactiveHeatmap}
            alt="interactive heatmap"
            className="interactive-heatmap"
          />
        );
      }
    }

    function maybeRenderProgressBar() {
      if (
        props.resumeTime &&
        props.duration &&
        props.duration > props.resumeTime
      ) {
        const percentValue = (100 / props.duration) * props.resumeTime;
        const percentStr = percentValue + "%";
        return (
          <Box 
            title={Math.round(percentValue) + "%"} 
            className="progress-bar"
            sx={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 3,
              bgcolor: "rgba(0,0,0,0.5)",
            }}
          >
            <Box 
              className="progress-indicator" 
              sx={{ 
                width: percentStr,
                height: "100%",
                bgcolor: "primary.main",
                borderRadius: "0 2px 2px 0",
                boxShadow: (t) => `0 0 8px ${alpha(t.palette.primary.main, 0.6)}`,
              }} 
            />
          </Box>
        );
      }
    }

    return (
      <Card
        className={cx(props.className, "stash-grid-card")}
        onClick={handleImageClick}
        {...dragProps}
        sx={{
          position: "relative",
          bgcolor: "background.paper",
          border: "none",
          borderRadius: 2,
          overflow: "hidden",
          transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          cursor: props.selecting ? "pointer" : "default",
          width: props.width && !ScreenUtils.isMobile() ? `${props.width}px` : "100%",
          "&:hover": {
            transform: ScreenUtils.isMobile() ? "none" : "scale(1.03) translateY(-4px)",
            zIndex: 50,
            boxShadow: (t) => `0 20px 40px ${alpha("#000", 0.3)}, 0 0 0 1px ${alpha(t.palette.primary.main, 0.1)}`,
          },
          "&:active": {
            transform: "scale(0.98)",
          },
          // Selected state
          ...(props.selected && {
            boxShadow: (t) => `0 0 0 2px ${t.palette.primary.main}, 0 8px 16px ${alpha("#000", 0.2)}`,
          }),
        }}
      >
        {moveTarget !== undefined && <MoveTarget dragSide={moveTarget} />}
        <Controls>
          {props.onSelectedChanged && (
            <Checkbox
              selected={props.selected}
              onSelectedChanged={props.onSelectedChanged}
            />
          )}

          {!!props.objectId && props.onMove && (
            <DragHandle setInHandle={setInHandle} />
          )}
        </Controls>

        <Box
          className={cx(props.thumbnailSectionClassName, "thumbnail-section")}
          sx={{
            position: "relative",
            overflow: "hidden",
          }}
        >
          <Link
            to={props.url}
            className={props.linkClassName}
            onClick={handleImageClick}
          >
            {props.image}
          </Link>
          {props.overlays}
          {maybeRenderProgressBar()}
        </Box>
        {maybeRenderInteractiveHeatmap()}
        <Box 
          className="card-section"
          sx={{
            display: "flex",
            flexDirection: "column",
          }}
        >
          {props.title && (
            <Link 
              to={props.url} 
              onClick={handleImageClick}
              style={{ textDecoration: "none" }}
            >
              <Box
                component="h5"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  px: 1.5,
                  py: 1,
                  color: "text.primary",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  m: 0,
                  transition: "color 0.15s ease",
                  "&:hover": {
                    color: "primary.light",
                  },
                }}
                className="card-section-title"
              >
                {props.pretitleIcon}
                <TruncatedText text={props.title} lineCount={1} />
              </Box>
            </Link>
          )}
          {props.details}
        </Box>

        {props.popovers}
      </Card>
    );
  }
);
