import React from "react";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Fade from "@mui/material/Fade";
import { useIntl } from "react-intl";
import cx from "classnames";
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
          className={cx("vexxx-loading", "loading-indicator", { "loading-inline": inline, "loading-card": card })}
        >
          <CircularProgress
            className="vexxx-loading-spinner"
            size={small ? 20 : 40}
            role="status"
            aria-label={typeof text === "string" ? text : undefined}
          />
          {message !== "" && (
            <Typography
              className="vexxx-loading-text loading-message"
              variant="h6"
            >
              {message ?? text}
            </Typography>
          )}
        </Box>
      </Fade>
    );

  }
);
