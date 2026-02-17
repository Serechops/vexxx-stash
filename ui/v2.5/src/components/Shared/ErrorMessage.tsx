import React, { ReactNode } from "react";
import { Alert, AlertTitle, Box } from "@mui/material";
import { FormattedMessage } from "react-intl";
import WarningIcon from "@mui/icons-material/Warning";

interface IProps {
  message?: React.ReactNode;
  error: string | ReactNode;
}

export const ErrorMessage: React.FC<IProps> = (props) => {
  const { error, message = <FormattedMessage id="errors.header" /> } = props;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
      <Alert severity="error" className="ErrorMessage">
        <AlertTitle className="ErrorMessage-header">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WarningIcon fontSize="small" />
            {message}
          </Box>
        </AlertTitle>
        <div className="ErrorMessage-content code">{error}</div>
      </Alert>
    </div>
  );
};
