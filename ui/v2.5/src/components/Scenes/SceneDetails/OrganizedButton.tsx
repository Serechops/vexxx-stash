import React from "react";
import cx from "classnames";
import { Button, CircularProgress } from "@mui/material";
import InventoryIcon from "@mui/icons-material/Inventory";
import { defineMessages, useIntl } from "react-intl";

export interface IOrganizedButtonProps {
  loading: boolean;
  organized: boolean;
  onClick: () => void;
}

export const OrganizedButton: React.FC<IOrganizedButtonProps> = (
  props: IOrganizedButtonProps
) => {
  const intl = useIntl();
  const messages = defineMessages({
    organized: {
      id: "organized",
      defaultMessage: "Organized",
    },
  });

  if (props.loading) return <CircularProgress size={20} />;

  return (
    <Button
      variant="text"
      title={intl.formatMessage(messages.organized)}
      sx={{
        minWidth: "auto",
        color: props.organized ? "#664c3f" : "rgba(191, 204, 214, 0.5)",
        "&:hover": {
          backgroundColor: "rgba(138, 155, 168, 0.15)"
        }
      }}
      onClick={props.onClick}
      size="small"
    >
      <InventoryIcon fontSize="small" />
    </Button>
  );
};
