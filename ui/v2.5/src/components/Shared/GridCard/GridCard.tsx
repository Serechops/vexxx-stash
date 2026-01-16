import React, {
  MutableRefObject,
  PropsWithChildren,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Card, CardContent, Checkbox as MuiCheckbox } from "@mui/material";
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
    <span onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <Icon className="card-drag-handle" icon={faGripLines} />
    </span>
  );
};

const Controls: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  return <div className="card-controls">{children}</div>;
};

const MoveTarget: React.FC<{ dragSide: DragSide }> = ({ dragSide }) => {
  if (dragSide === undefined) {
    return null;
  }

  return (
    <div
      className={`move-target move-target-${dragSide === DragSide.BEFORE ? "before" : "after"
        }`}
    ></div>
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
          <div title={Math.round(percentValue) + "%"} className="progress-bar">
            <Box className="progress-indicator" sx={{ width: percentStr }} />
          </div>
        );
      }
    }

    return (
      <Card
        className={cx(
          props.className,
          "grid-card transition-transform duration-300 hover:scale-105 hover:z-50 hover:shadow-2xl bg-card border-none rounded-md overflow-hidden"
        )}
        onClick={handleImageClick}
        {...dragProps}
        sx={
          props.width && !ScreenUtils.isMobile()
            ? { width: `${props.width}px` }
            : {}
        }
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

        <div
          className={cx(props.thumbnailSectionClassName, "thumbnail-section")}
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
        </div>
        {maybeRenderInteractiveHeatmap()}
        <div className="card-section">
          {props.title && (
            <Link to={props.url} onClick={handleImageClick}>
              <h5 className="card-section-title flex-aligned text-sm font-medium px-2 py-2 truncate">
                {props.pretitleIcon}
                <TruncatedText text={props.title} lineCount={1} />
              </h5>
            </Link>
          )}
          {props.details}
        </div>

        {props.popovers}
      </Card>
    );
  }
);
