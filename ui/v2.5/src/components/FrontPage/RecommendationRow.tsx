import React, { PropsWithChildren } from "react";
import { Box, Typography } from "@mui/material";

interface IProps {
  className?: string;
  header: string;
  link: JSX.Element;
}

export const RecommendationRow: React.FC<PropsWithChildren<IProps>> = ({
  className,
  header,
  link,
  children,
}) => (
  <Box
    className={`recommendation-row ${className ?? ""}`}
    sx={{
      mb: 4,
      pl: { xs: 2, md: 6 },
      pr: { xs: 2, md: 6 },
      transition: "all 0.3s",
    }}
  >
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        mb: 2,
      }}
    >
      <Typography
        variant="h6"
        sx={{
          fontWeight: 700,
          color: "grey.200",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          textShadow: "0 2px 4px rgba(0,0,0,0.5)",
        }}
      >
        {header}
      </Typography>
      <Box
        sx={{
          fontSize: "0.875rem",
          fontWeight: 600,
          color: "primary.main",
          "&:hover": {
            color: "primary.light",
          },
          transition: "color 0.2s",
          "& a": {
            color: "inherit",
            textDecoration: "none",
          },
        }}
      >
        {link}
      </Box>
    </Box>
    {children}
  </Box>
);
