import React from "react";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Fade from "@mui/material/Fade";
import { useIntl } from "react-intl";
import { PatchComponent } from "src/patch";

interface ILoadingProps {
  message?: JSX.Element | string;
  inline?: boolean;
  small?: boolean;
  card?: boolean;
}



export const LoadingIndicator: React.FC<ILoadingProps> = PatchComponent(
  "LoadingIndicator",
  ({ message, inline = false, small = false, card = false }) => {
    const intl = useIntl();

    const text = intl.formatMessage({ id: "loading.generic" });

    return (

      <Fade in={true} style={{ transitionDelay: "200ms" }}>
        <Box
          className="vexxx-loading"
          sx={{
            width: inline ? "auto" : "100%",
            display: inline ? "inline-flex" : "flex",
            flexDirection: inline ? "row" : "column",
            alignItems: "center",
            justifyContent: inline ? "flex-start" : "center",
            paddingTop: !card && !inline ? "2rem" : 0,
            padding: card ? 2 : undefined,
            marginLeft: inline ? "0.5rem" : 0,
            gap: 1,
            opacity: 1, // Override default opacity from Fade if needed, but Fade handles it
          }}
        >
          <CircularProgress
            className="vexxx-loading-spinner"
            size={small ? 20 : 40}
            role="status"
            aria-label={typeof text === "string" ? text : undefined}
          />
          {message !== "" && (
            <Typography
              className="vexxx-loading-text"
              variant="h6"
              sx={{ marginTop: inline ? 0 : "1rem" }}
            >
              {message ?? text}
            </Typography>
          )}
        </Box>
      </Fade>
    );

  }
);
