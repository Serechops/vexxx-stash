import React from "react";
import { NumberSetting } from "./Inputs";
import { SettingSection } from "./SettingSection";
import { Alert } from "@mui/material";
import { FormattedMessage } from "react-intl";
import { useSettings } from "./context";
import { LoadingIndicator } from "../Shared/LoadingIndicator";

export const SettingsSecurityPanel: React.FC = () => {
  const { general, loading, error, saveGeneral } = useSettings();

  if (error) return <h1>{error.message}</h1>;
  if (loading) return <LoadingIndicator />;

  return (
    <>
      <SettingSection headingID="config.general.auth.authentication">
        <Alert severity="info" sx={{ mb: 3 }}>
          <FormattedMessage
            id="config.general.auth.managed_by_users"
            defaultMessage="Authentication is managed through user accounts. Use the Users tab to create accounts and control access to this server."
          />
        </Alert>
        <NumberSetting
          id="maxSessionAge"
          headingID="config.general.auth.maximum_session_age"
          subHeadingID="config.general.auth.maximum_session_age_desc"
          value={general.maxSessionAge ?? undefined}
          onChange={(v) => saveGeneral({ maxSessionAge: v })}
        />
      </SettingSection>
    </>
  );
};
