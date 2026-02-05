import BlockIcon from "@mui/icons-material/Block";
import RemoveIcon from "@mui/icons-material/Remove";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import React, { useState } from "react";
import { Button, ButtonGroup, Menu, MenuItem, Box } from "@mui/material";
import { useIntl } from "react-intl";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { SweatDrops } from "src/components/Shared/SweatDrops";
import { useConfigurationContext } from "src/hooks/Config";

export interface IOCounterButtonProps {
  value: number;
  onIncrement: () => Promise<void>;
  onDecrement: () => Promise<void>;
  onReset: () => Promise<void>;
}

export const OCounterButton: React.FC<IOCounterButtonProps> = (
  props: IOCounterButtonProps
) => {
  const intl = useIntl();
  const { configuration } = useConfigurationContext();
  const { sfwContentMode } = configuration.interface;

  const icon = !sfwContentMode ? <SweatDrops /> : <ThumbUpIcon fontSize="small" />;
  const messageID = !sfwContentMode ? "o_count" : "o_count_sfw";

  const [loading, setLoading] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  async function increment() {
    setLoading(true);
    await props.onIncrement();
    setLoading(false);
  }

  async function decrement() {
    handleClose();
    setLoading(true);
    await props.onDecrement();
    setLoading(false);
  }

  async function reset() {
    handleClose();
    setLoading(true);
    await props.onReset();
    setLoading(false);
  }

  if (loading) return <LoadingIndicator message="" inline small />;

  return (
    <ButtonGroup size="small" sx={{ "& .MuiButton-root": { minWidth: "auto" } }}>
      <Button
        onClick={increment}
        variant="text"
        color="secondary"
        title={intl.formatMessage({ id: messageID })}
        size="small"
        sx={{ pr: 1 }}
      >
        {icon}
        <Box component="span" sx={{ ml: 1 }}>{props.value}</Box>
      </Button>
      {props.value ? (
        <>
          <Button
            variant="text"
            color="secondary"
            onClick={handleClick}
            size="small"
            sx={{ pl: 0 }}
          >
            <KeyboardArrowDownIcon sx={{ fontSize: 14 }} />
          </Button>
          <Menu
            anchorEl={anchorEl}
            open={open}
            onClose={handleClose}
            hideBackdrop
          >
            <MenuItem onClick={decrement}>
              <RemoveIcon sx={{ mr: 1 }} />
              <span>Decrement</span>
            </MenuItem>
            <MenuItem onClick={reset}>
              <BlockIcon sx={{ mr: 1 }} />
              <span>Reset</span>
            </MenuItem>
          </Menu>
        </>
      ) : null}
    </ButtonGroup>
  );
};
