import React from "react";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import cx from "classnames";
import { useIntl } from "react-intl";
import { PatchComponent } from "src/patch";

interface ILoadingProps {
  message?: JSX.Element | string;
  inline?: boolean;
  small?: boolean;
  card?: boolean;
}

const CLASSNAME = "LoadingIndicator";
const CLASSNAME_MESSAGE = `${CLASSNAME}-message`;

export const LoadingIndicator: React.FC<ILoadingProps> = PatchComponent(
  "LoadingIndicator",
  ({ message, inline = false, small = false, card = false }) => {
    const intl = useIntl();

    const text = intl.formatMessage({ id: "loading.generic" });

    return (
      <Box
        className={cx(CLASSNAME, { inline, small, "card-based": card })}
        display="flex"
        alignItems="center"
        justifyContent={inline ? "flex-start" : "center"}
        flexDirection={inline ? "row" : "column"}
        gap={1}
        p={card ? 2 : 0}
      >
        <CircularProgress
          size={small ? 20 : 40}
          role="status"
          aria-label={typeof text === "string" ? text : undefined}
        />
        {(message !== "") && (
          <Typography variant="h6" className={CLASSNAME_MESSAGE}>
            {message ?? text}
          </Typography>
        )}
      </Box>
    );
  }
);
