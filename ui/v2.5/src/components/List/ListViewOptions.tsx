import React, { useEffect, useRef, useState } from "react";
import Mousetrap from "mousetrap";
import {
  Button,
  ButtonGroup,
  Popover,
  MenuItem,
  Tooltip,
  Box,
} from "@mui/material";
import { DisplayMode } from "src/models/list-filter/types";
import { IntlShape, useIntl } from "react-intl";
import { Icon } from "../Shared/Icon";
import {
  faChevronDown,
  faList,
  faSquare,
  faTags,
  faThLarge,
} from "@fortawesome/free-solid-svg-icons";
import { ZoomSelect } from "./ZoomSlider";

interface IListViewOptionsProps {
  zoomIndex?: number;
  onSetZoom?: (zoomIndex: number) => void;
  displayMode: DisplayMode;
  onSetDisplayMode: (m: DisplayMode) => void;
  displayModeOptions: DisplayMode[];
}

function getIcon(option: DisplayMode) {
  switch (option) {
    case DisplayMode.Grid:
      return faThLarge;
    case DisplayMode.List:
      return faList;
    case DisplayMode.Wall:
      return faSquare;
    case DisplayMode.Tagger:
      return faTags;
  }
}

function getLabelId(option: DisplayMode) {
  let displayModeId = "unknown";
  switch (option) {
    case DisplayMode.Grid:
      displayModeId = "grid";
      break;
    case DisplayMode.List:
      displayModeId = "list";
      break;
    case DisplayMode.Wall:
      displayModeId = "wall";
      break;
    case DisplayMode.Tagger:
      displayModeId = "tagger";
      break;
  }
  return `display_mode.${displayModeId}`;
}

function getLabel(intl: IntlShape, option: DisplayMode) {
  return intl.formatMessage({ id: getLabelId(option) });
}

export const ListViewOptions: React.FC<IListViewOptionsProps> = ({
  zoomIndex,
  onSetZoom,
  displayMode,
  onSetDisplayMode,
  displayModeOptions,
}) => {
  const intl = useIntl();

  const overlayTarget = useRef<HTMLButtonElement>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const showOptions = Boolean(anchorEl);

  useEffect(() => {
    Mousetrap.bind("v g", () => {
      if (displayModeOptions.includes(DisplayMode.Grid)) {
        onSetDisplayMode(DisplayMode.Grid);
      }
    });
    Mousetrap.bind("v l", () => {
      if (displayModeOptions.includes(DisplayMode.List)) {
        onSetDisplayMode(DisplayMode.List);
      }
    });
    Mousetrap.bind("v w", () => {
      if (displayModeOptions.includes(DisplayMode.Wall)) {
        onSetDisplayMode(DisplayMode.Wall);
      }
    });
    Mousetrap.bind("v t", () => {
      if (displayModeOptions.includes(DisplayMode.Tagger)) {
        onSetDisplayMode(DisplayMode.Tagger);
      }
    });

    return () => {
      Mousetrap.unbind("v g");
      Mousetrap.unbind("v l");
      Mousetrap.unbind("v w");
      Mousetrap.unbind("v t");
    };
  });

  function onChangeZoom(v: number) {
    if (onSetZoom) {
      onSetZoom(v);
    }
  }

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <>
      <Button
        className="display-mode-select"
        ref={overlayTarget}
        variant="outlined"
        color="secondary"
        title={intl.formatMessage(
          { id: "display_mode.label_current" },
          { current: getLabel(intl, displayMode) }
        )}
        onClick={handleClick}
        size="small"
      >
        <Icon icon={getIcon(displayMode)} />
        <Icon size="xs" icon={faChevronDown} />
      </Button>
      <Popover
        open={showOptions}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "left",
        }}
      >
        <Box className="display-mode-popover" sx={{ p: 1 }}>
          <div className="display-mode-menu">
            {onSetZoom &&
              zoomIndex !== undefined &&
              (displayMode === DisplayMode.Grid ||
                displayMode === DisplayMode.Wall) ? (
              <div className="zoom-slider-container">
                <ZoomSelect
                  zoomIndex={zoomIndex}
                  onChangeZoom={onChangeZoom}
                />
              </div>
            ) : null}
            {displayModeOptions.map((option) => (
              <MenuItem
                key={option}
                selected={displayMode === option}
                onClick={() => {
                  handleClose();
                  onSetDisplayMode(option);
                }}
              >
                <Icon icon={getIcon(option)} /> {getLabel(intl, option)}
              </MenuItem>
            ))}
          </div>
        </Box>
      </Popover>
    </>
  );
};

export const ListViewButtonGroup: React.FC<IListViewOptionsProps> = ({
  zoomIndex,
  onSetZoom,
  displayMode,
  onSetDisplayMode,
  displayModeOptions,
}) => {
  const intl = useIntl();

  return (
    <>
      {displayModeOptions.length > 1 && (
        <ButtonGroup size="small">
          {displayModeOptions.map((option) => (
            <Tooltip
              key={option}
              title={getLabel(intl, option)}
            >
              <Button
                variant={displayMode === option ? "contained" : "outlined"}
                color="secondary"
                onClick={() => onSetDisplayMode(option)}
              >
                <Icon icon={getIcon(option)} />
              </Button>
            </Tooltip>
          ))}
        </ButtonGroup>
      )}
      <div className="zoom-slider-container">
        {onSetZoom &&
          zoomIndex !== undefined &&
          (displayMode === DisplayMode.Grid ||
            displayMode === DisplayMode.Wall) ? (
          <ZoomSelect zoomIndex={zoomIndex} onChangeZoom={onSetZoom} />
        ) : null}
      </div>
    </>
  );
};
