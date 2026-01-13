import React from "react";
import { Button } from "react-bootstrap";
import { FormattedMessage } from "react-intl";
import {
  mutateReloadPlugins,
  usePlugins,
} from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import { Icon } from "../Shared/Icon";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { SettingSection } from "./SettingSection";
import { Setting } from "./Inputs";
import { faSyncAlt } from "@fortawesome/free-solid-svg-icons";
import { useSettings } from "./context";
import {
  AvailablePluginPackages,
  InstalledPluginPackages,
} from "./PluginPackageManager";
import { PluginList } from "./SettingsPluginsPanel/PluginList";

export const SettingsPluginsPanel: React.FC = () => {
  const Toast = useToast();
  const { loading: configLoading } = useSettings();
  const { loading } = usePlugins();

  async function onReloadPlugins() {
    try {
      await mutateReloadPlugins();
    } catch (e) {
      Toast.error(e);
    }
  }

  if (loading || configLoading) return <LoadingIndicator />;

  return (
    <>
      <InstalledPluginPackages />
      <AvailablePluginPackages />

      <SettingSection headingID="config.categories.plugins">
        <Setting headingID="actions.reload_plugins">
          <Button onClick={() => onReloadPlugins()}>
            <span className="fa-icon">
              <Icon icon={faSyncAlt} />
            </span>
            <span>
              <FormattedMessage id="actions.reload_plugins" />
            </span>
          </Button>
        </Setting>
        <PluginList />
      </SettingSection>
    </>
  );
};
