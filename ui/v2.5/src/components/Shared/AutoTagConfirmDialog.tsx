import React from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { faExclamationTriangle } from "@fortawesome/free-solid-svg-icons";
import { ModalComponent } from "./Modal";
import { Icon } from "./Icon";
import { Box } from "@mui/material";

interface IAutoTagConfirmDialog {
  show: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const AutoTagWarning = () => (
  <>
    <p>
      <FormattedMessage id="config.tasks.auto_tag_based_on_filenames" />
    </p>
    <p>
      <FormattedMessage id="config.tasks.auto_tag_confirm" />
    </p>
    <Box sx={{ color: "warning.main", fontWeight: "bold" }}>
      <Icon icon={faExclamationTriangle} />{" "}
      <FormattedMessage id="config.tasks.auto_tag_warning" />
    </Box>
  </>
);

export const AutoTagConfirmDialog: React.FC<IAutoTagConfirmDialog> = ({
  show,
  onConfirm,
  onCancel,
}) => {
  const intl = useIntl();

  return (
    <ModalComponent
      show={show}
      icon={faExclamationTriangle}
      header={intl.formatMessage({ id: "actions.auto_tag" })}
      accept={{
        text: intl.formatMessage({ id: "actions.confirm" }),
        variant: "danger",
        onClick: onConfirm,
      }}
      cancel={{
        onClick: onCancel,
      }}
    >
      <AutoTagWarning />
    </ModalComponent>
  );
};
