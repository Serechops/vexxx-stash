import React from "react";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Fade from "@mui/material/Fade";
import { keyframes } from "@mui/material/styles";
import { useIntl } from "react-intl";
import cx from "classnames";
import { PatchComponent } from "src/patch";

interface ILoadingProps {
  message?: JSX.Element | string;
  inline?: boolean;
  small?: boolean;
  card?: boolean;
}

// Subtle pulse animation for the loading text
const pulseAnimation = keyframes`
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
`;

// Gentle float animation for the container
const floatAnimation = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
`;

export const LoadingIndicator: React.FC<ILoadingProps> = PatchComponent(
  "LoadingIndicator",
  ({ message, inline = false, small = false, card = false }) => {
    const intl = useIntl();

    const text = intl.formatMessage({ id: "loading.generic" });

    return (
      <Fade in={true} timeout={300}>
        <Box
          className={cx("vexxx-loading", "loading-indicator", { 
            "loading-inline": inline, 
            "loading-card": card 
          })}
          sx={{
            display: "flex",
            flexDirection: inline ? "row" : "column",
            alignItems: "center",
            justifyContent: "center",
            gap: inline ? 1.5 : 2,
            py: card ? 4 : inline ? 0 : 6,
            px: 2,
            minHeight: card ? "auto" : inline ? "auto" : "200px",
            animation: !inline ? `${floatAnimation} 3s ease-in-out infinite` : "none",
          }}
        >
          <Box
            sx={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Outer glow ring */}
            {!small && (
              <Box
                sx={{
                  position: "absolute",
                  width: small ? 28 : 56,
                  height: small ? 28 : 56,
                  borderRadius: "50%",
                  background: (theme) => 
                    `radial-gradient(circle, ${theme.palette.primary.main}20 0%, transparent 70%)`,
                  animation: `${pulseAnimation} 2s ease-in-out infinite`,
                }}
              />
            )}
            <CircularProgress
              className="vexxx-loading-spinner"
              size={small ? 20 : 40}
              thickness={small ? 4 : 3.5}
              role="status"
              aria-label={typeof text === "string" ? text : undefined}
              sx={{
                color: "primary.main",
                "& .MuiCircularProgress-circle": {
                  strokeLinecap: "round",
                },
              }}
            />
          </Box>
          {message !== "" && !small && (
            <Typography
              className="vexxx-loading-text loading-message"
              variant={inline ? "body2" : "body1"}
              sx={{
                color: "text.secondary",
                fontWeight: 500,
                letterSpacing: "0.02em",
                animation: `${pulseAnimation} 2s ease-in-out infinite`,
                animationDelay: "0.5s",
              }}
            >
              {message ?? text}
            </Typography>
          )}
        </Box>
      </Fade>
    );
  }
);
