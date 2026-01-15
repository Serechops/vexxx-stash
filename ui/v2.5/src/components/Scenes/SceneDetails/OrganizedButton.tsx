import React from "react";
import cx from "classnames";
import { Button, CircularProgress } from "@mui/material";
import { Icon } from "src/components/Shared/Icon";
import { defineMessages, useIntl } from "react-intl";
import { faBox } from "@fortawesome/free-solid-svg-icons";

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
      color="secondary"
      title={intl.formatMessage(messages.organized)}
      className={cx(
        "minimal",
        "organized-button",
        props.organized ? "organized" : "not-organized"
      )}
      onClick={props.onClick}
      size="small"
    >
      <Icon icon={faBox} />
    </Button>
  );
};
