import React from "react";
import { Link, Redirect, useLocation } from "react-router-dom";
import { FormattedMessage } from "react-intl";
import { Helmet } from "react-helmet";
import {
  Box,
  Container,
  FormControlLabel,
  Switch,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
  useTheme
} from "@mui/material";

import { useTitleProps } from "src/hooks/title";
import { useCurrentUser } from "src/hooks/UserContext";
import { SettingsAboutPanel } from "./SettingsAboutPanel";
import { SettingsConfigurationPanel } from "./SettingsSystemPanel";
import { SettingsInterfacePanel } from "./SettingsInterfacePanel/SettingsInterfacePanel";
import { SettingsLogsPanel } from "./SettingsLogsPanel";
import { SettingsTasksPanel } from "./Tasks/SettingsTasksPanel";
import { SettingsPluginsPanel } from "./SettingsPluginsPanel";
import { SettingsScrapingPanel } from "./SettingsScrapingPanel";
import { SettingsToolsPanel } from "./SettingsToolsPanel";
import { SettingsServicesPanel } from "./SettingsServicesPanel";
import { SettingsContext, useSettings } from "./context";
import { SettingsLibraryPanel } from "./SettingsLibraryPanel";
import { SettingsSecurityPanel } from "./SettingsSecurityPanel";
import { SettingsUsersPanel } from "./SettingsUsersPanel";
import Changelog from "../Changelog/Changelog";

const validTabs = [
  "tasks",
  "library",
  "interface",
  "security",
  "users",
  "metadata-providers",
  "services",
  "system",
  "plugins",
  "logs",
  "tools",
  "changelog",
  "about",
] as const;
type TabKey = (typeof validTabs)[number];

const defaultTab: TabKey = "tasks";

function isTabKey(tab: string | null): tab is TabKey {
  return validTabs.includes(tab as TabKey);
}

const SettingTabs: React.FC<{ tab: TabKey }> = ({ tab }) => {
  const { advancedMode, setAdvancedMode } = useSettings();
  const { canManageUsers, canModifySettings } = useCurrentUser();
  const theme = useTheme();
  // Responsive sidebar: on small screens, tabs could be horizontal or simpler.
  // Original bootstrap used Col sm={3} md={3} xl={2} for sidebar.
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('md'));

  const titleProps = useTitleProps({ id: "settings" });

  const renderContent = () => {
    switch (tab) {
      case "library": return <SettingsLibraryPanel />;
      case "interface": return <SettingsInterfacePanel />;
      case "security": return <SettingsSecurityPanel />;
      case "users": return <SettingsUsersPanel />;
      case "tasks": return <SettingsTasksPanel />;
      case "services": return <SettingsServicesPanel />;
      case "tools": return <SettingsToolsPanel />;
      case "metadata-providers": return <SettingsScrapingPanel />;
      case "system": return <SettingsConfigurationPanel />;
      case "plugins": return <SettingsPluginsPanel />;
      case "logs": return <SettingsLogsPanel />;
      case "changelog": return <Changelog />;
      case "about": return <SettingsAboutPanel />;
      default: return null;
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        height: 'calc(100vh - 64px)',
      }}
    >
      <Helmet {...titleProps} />
      <Box
        sx={{
          borderBottom: { xs: '1px solid #27272a', md: 0 },
          borderRight: { xs: 0, md: '1px solid #27272a' },
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          overflowY: { xs: 'hidden', md: 'auto' },
          width: { xs: '100%', md: '250px', lg: '300px' },
        }}
      >
        <Tabs
          orientation={isSmallScreen ? "horizontal" : "vertical"}
          variant="scrollable"
          value={tab}
          allowScrollButtonsMobile
          scrollButtons="auto"
          sx={{
            flexGrow: 1,
            "& .MuiTab-root": {
              minHeight: '48px',
              textTransform: 'none',
            },
          }}
        >
          <Tab
            label={<FormattedMessage id="config.categories.tasks" />}
            value="tasks"
            component={Link}
            to="/settings?tab=tasks"
          />
          <Tab
            label={<FormattedMessage id="library" />}
            value="library"
            component={Link}
            to="/settings?tab=library"
          />
          <Tab
            label={<FormattedMessage id="config.categories.interface" />}
            value="interface"
            component={Link}
            to="/settings?tab=interface"
          />
          <Tab
            label={<FormattedMessage id="config.categories.security" />}
            value="security"
            component={Link}
            to="/settings?tab=security"
          />
          {canManageUsers && (
            <Tab
              label={<FormattedMessage id="config.categories.users" defaultMessage="Users" />}
              value="users"
              component={Link}
              to="/settings?tab=users"
            />
          )}
          <Tab
            label={<FormattedMessage id="config.categories.metadata_providers" />}
            value="metadata-providers"
            component={Link}
            to="/settings?tab=metadata-providers"
          />
          <Tab
            label={<FormattedMessage id="config.categories.services" />}
            value="services"
            component={Link}
            to="/settings?tab=services"
          />
          <Tab
            label={<FormattedMessage id="config.categories.system" />}
            value="system"
            component={Link}
            to="/settings?tab=system"
          />
          <Tab
            label={<FormattedMessage id="config.categories.plugins" />}
            value="plugins"
            component={Link}
            to="/settings?tab=plugins"
          />
          <Tab
            label={<FormattedMessage id="config.categories.logs" />}
            value="logs"
            component={Link}
            to="/settings?tab=logs"
          />
          <Tab
            label={<FormattedMessage id="config.categories.tools" />}
            value="tools"
            component={Link}
            to="/settings?tab=tools"
          />
          <Tab
            label={<FormattedMessage id="config.categories.changelog" />}
            value="changelog"
            component={Link}
            to="/settings?tab=changelog"
          />
          <Tab
            label={<FormattedMessage id="config.categories.about" />}
            value="about"
            component={Link}
            to="/settings?tab=about"
          />
        </Tabs>

        <Box sx={{ borderTop: '1px solid #27272a', p: 2 }}>
          <FormControlLabel
            control={
              <Switch
                checked={advancedMode}
                onChange={() => setAdvancedMode(!advancedMode)}
              />
            }
            label={<FormattedMessage id="config.advanced_mode" />}
          />
        </Box>
      </Box>

      <Box sx={{ bgcolor: '#09090b', flexGrow: 1, overflowY: 'auto', p: 3 }}>
        <Container maxWidth="xl" sx={{ p: 0 }}>
          {renderContent()}
        </Container>
      </Box>
    </Box>
  );
};

export const Settings: React.FC = () => {
  const location = useLocation();
  const tab = new URLSearchParams(location.search).get("tab");

  if (!isTabKey(tab)) {
    return (
      <Redirect
        to={{
          ...location,
          search: `tab=${defaultTab}`,
        }}
      />
    );
  }

  return <SettingTabs tab={tab} />;
};

export default Settings;
