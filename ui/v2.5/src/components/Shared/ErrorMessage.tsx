import { faWarning } from "@fortawesome/free-solid-svg-icons";
import React, { ReactNode } from "react";
import { Alert, AlertTitle, Box } from "@mui/material";
import { FormattedMessage } from "react-intl";
import { Icon } from "./Icon";

interface IProps {
  message?: React.ReactNode;
  error: string | ReactNode;
}

export const ErrorMessage: React.FC<IProps> = (props) => {
  const { error, message = <FormattedMessage id="errors.header" /> } = props;

  return (
    <div className="ErrorMessage-container">
      <Alert severity="error" className="ErrorMessage">
        <AlertTitle className="ErrorMessage-header">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon icon={faWarning} />
            {message}
          </Box>
        </AlertTitle>
        <div className="ErrorMessage-content code">{error}</div>
      </Alert>
    </div>
  );
};
