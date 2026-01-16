import React, { useEffect, useState } from "react";
import { Box, Button, Collapse, CollapseProps, SxProps, Theme } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

interface IProps {
  className?: string;
  text: React.ReactNode;
  collapseProps?: Partial<CollapseProps>;
  outsideCollapse?: React.ReactNode;
  onOpenChanged?: (o: boolean) => void;
  open?: boolean;
  sx?: SxProps<Theme>;
}

export const CollapseButton: React.FC<React.PropsWithChildren<IProps>> = (
  props: React.PropsWithChildren<IProps>
) => {
  const [open, setOpen] = useState(props.open ?? false);

  function toggleOpen() {
    const nv = !open;
    setOpen(nv);
    props.onOpenChanged?.(nv);
  }

  useEffect(() => {
    if (props.open !== undefined) {
      setOpen(props.open);
    }
  }, [props.open]);

  return (
    <Box className={props.className} sx={props.sx}>
      <Box className="collapse-header" sx={{ padding: "0.25rem" }}>
        <Button
          onClick={() => toggleOpen()}
          className="minimal collapse-button"
          color="inherit"
          sx={{
            fontWeight: "bold",
            textAlign: "left",
            width: "100%",
            justifyContent: "flex-start",
            paddingLeft: 0,
            textTransform: "none",
            color: "text.primary",
            "& .fa-icon": { marginLeft: 0, marginRight: "0.5rem" }
          }}
        >
          {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          <span>{props.text}</span>
        </Button>
      </Box>
      {props.outsideCollapse}
      <Collapse in={open} {...props.collapseProps}>
        <Box sx={{ paddingTop: "0.25rem" }}>{props.children}</Box>
      </Collapse>
    </Box>
  );
};

export const ExpandCollapseButton: React.FC<{
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}> = ({ collapsed, setCollapsed }) => {
  return (
    <span className="detail-expand-collapse">
      <Button
        className="minimal expand-collapse"
        onClick={() => setCollapsed(!collapsed)}
        color="inherit"
      >
        {collapsed ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
      </Button>
    </span>
  );
};
