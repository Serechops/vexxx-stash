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
import GridViewIcon from "@mui/icons-material/GridView";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import SquareIcon from "@mui/icons-material/Square";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
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
      return <GridViewIcon fontSize="small" />;
    case DisplayMode.List:
      return <FormatListBulletedIcon fontSize="small" />;
    case DisplayMode.Wall:
      return <SquareIcon fontSize="small" />;
    case DisplayMode.Tagger:
      return <LocalOfferIcon fontSize="small" />;
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
        ref={overlayTarget}
        variant="outlined"
        color="secondary"
        title={intl.formatMessage(
          { id: "display_mode.label_current" },
          { current: getLabel(intl, displayMode) }
        )}
        onClick={handleClick}
        size="small"
        sx={{
          px: 1.5,
          whiteSpace: "nowrap",
          "& > span": { mr: 0 }
        }}
      >
        {getIcon(displayMode)}
        <KeyboardArrowDownIcon sx={{ fontSize: 12 }} />
      </Button>
      <Popover
        open={showOptions}
        anchorEl={anchorEl}
        onClose={handleClose}
        disableScrollLock
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "left",
        }}
        PaperProps={{
          sx: { padding: 0 }
        }}
      >
        <Box sx={{ p: 1 }}>
          <Box display="flex" flexDirection="column">
            {onSetZoom &&
              zoomIndex !== undefined &&
              (displayMode === DisplayMode.Grid ||
                displayMode === DisplayMode.Wall) ? (
              <Box display="flex" justifyContent="center" py={1} minHeight="1rem">
                <ZoomSelect
                  zoomIndex={zoomIndex}
                  onChangeZoom={onChangeZoom}
                />
              </Box>
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
                {getIcon(option)} <Box component="span" sx={{ ml: 1 }}>{getLabel(intl, option)}</Box>
              </MenuItem>
            ))}
          </Box>
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
                {getIcon(option)}
              </Button>
            </Tooltip>
          ))}
        </ButtonGroup>
      )}
      <Box display={{ xs: 'none', sm: 'flex' }} justifyContent="center" mb={0.5} minHeight="1rem" pb={0.5} pt={0.25}>
        {onSetZoom &&
          zoomIndex !== undefined &&
          (displayMode === DisplayMode.Grid ||
            displayMode === DisplayMode.Wall) ? (
          <ZoomSelect zoomIndex={zoomIndex} onChangeZoom={onSetZoom} />
        ) : null}
      </Box>
    </>
  );
};
