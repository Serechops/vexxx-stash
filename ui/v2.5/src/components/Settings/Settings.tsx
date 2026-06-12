import React, { useEffect, useMemo, useState } from "react";
import { Link, Redirect, useLocation } from "react-router-dom";
import { FormattedMessage } from "react-intl";
import { Helmet } from "react-helmet";
import {
  Box,
  Container,
  FormControlLabel,
  Switch,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import * as GQL from "src/core/generated-graphql";
import { useFindScenes } from "src/core/StashService";
import { ListFilterModel } from "src/models/list-filter/filter";
import { useConfigurationContextOptional } from "src/hooks/Config";
import { IUIConfig } from "src/core/config";

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
import { useSettings } from "./context";
import { SettingsLibraryPanel } from "./SettingsLibraryPanel";
import { SettingsSecurityPanel } from "./SettingsSecurityPanel";
import { SettingsUsersPanel } from "./SettingsUsersPanel";
import { SettingsRecycleBinPanel } from "./SettingsRecycleBinPanel";
import { SettingsDeoVRTunnelPanel } from "./SettingsDeoVRTunnelPanel";
import Changelog from "../Changelog/Changelog";

// ─── Crossfading screenshot background ───────────────────────────────────────

const SettingsBackground: React.FC = () => {
  const { configuration } = useConfigurationContextOptional() || {};
  const [activeIndex, setActiveIndex] = useState(0);

  const uiConfig = configuration?.ui as IUIConfig | undefined;
  const sfwMode =
    configuration?.interface?.sfwContentMode && (uiConfig?.sfwBlurImages ?? true);

  // Scenes for screenshots (priority)
  const sceneFilter = useMemo(() => {
    const f = new ListFilterModel(GQL.FilterMode.Scenes, undefined);
    f.itemsPerPage = 12;
    f.sortBy = "random";
    f.sortDirection = GQL.SortDirectionEnum.Desc;
    return f;
  }, []);
  const { data: sceneData } = useFindScenes(sceneFilter);
  const sceneScreenshots = useMemo(
    () =>
      sfwMode
        ? []
        : (sceneData?.findScenes?.scenes ?? [])
            .map((s) => s.paths.screenshot)
            .filter((src): src is string => !!src),
    [sfwMode, sceneData]
  );

  // Image fallback
  const { data: imageData } = GQL.useFindImagesQuery({
    variables: { filter: { per_page: 12, sort: "random" }, image_filter: {} },
    fetchPolicy: "no-cache",
  });
  const imageSrcs = useMemo(
    () =>
      sfwMode
        ? []
        : (imageData?.findImages?.images ?? []).map(
            (img) => img.paths?.thumbnail || ""
          ),
    [sfwMode, imageData]
  );

  const srcs = sceneScreenshots.length > 0 ? sceneScreenshots : imageSrcs;

  useEffect(() => {
    if (srcs.length < 2) return;
    const id = setInterval(
      () => setActiveIndex((prev) => (prev + 1) % srcs.length),
      12000
    );
    return () => clearInterval(id);
  }, [srcs.length]);

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        bgcolor: "#03030a",
        overflow: "hidden",
        pointerEvents: "none",
        display: { xs: "none", md: "block" },
      }}
    >
      {srcs.map((src, i) => (
        <Box
          key={src}
          component="img"
          src={src}
          alt=""
          sx={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: i === activeIndex ? 1 : 0,
            transition: "opacity 3s ease",
          }}
        />
      ))}

      {/* Vignette */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, transparent 20%, rgba(3,3,10,0.45) 100%)",
        }}
      />
      {/* Dark overlay */}
      <Box sx={{ position: "absolute", inset: 0, bgcolor: "rgba(3,3,10,0.20)" }} />
      {/* Scanline texture */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.007) 3px, rgba(255,255,255,0.007) 4px)",
        }}
      />
    </Box>
  );
};

// ─── Nav item ─────────────────────────────────────────────────────────────────

const NavItem: React.FC<{
  label: React.ReactNode;
  to: string;
  active: boolean;
}> = ({ label, to, active }) => (
  <Link to={to} style={{ textDecoration: "none" }}>
    <Box
      sx={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        px: 2.5,
        py: 1.1,
        gap: 1.25,
        cursor: "pointer",
        borderLeft: "2px solid",
        borderColor: active ? "primary.main" : "transparent",
        bgcolor: active ? "rgba(255,255,255,0.04)" : "transparent",
        transition: "all 0.15s ease",
        "&:hover": {
          bgcolor: "rgba(255,255,255,0.035)",
          borderColor: active ? "primary.main" : "rgba(255,255,255,0.18)",
        },
      }}
    >
      {active && (
        <Box
          sx={{
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            width: 2,
            height: "60%",
            bgcolor: "primary.main",
            boxShadow: (theme) => `0 0 8px ${alpha(theme.palette.primary.main, 0.7)}`,
          }}
        />
      )}
      <Typography
        sx={{
          fontSize: "0.855rem",
          fontWeight: active ? 600 : 400,
          letterSpacing: active ? "0.035em" : "0.02em",
          color: active ? "primary.light" : "rgba(255,255,255,0.72)",
          transition: "color 0.15s ease",
          userSelect: "none",
        }}
      >
        {label}
      </Typography>
    </Box>
  </Link>
);

// ─── Tab routing ──────────────────────────────────────────────────────────────

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
  "recycle-bin",
  "deovr-tunnel",
] as const;
type TabKey = (typeof validTabs)[number];

const defaultTab: TabKey = "tasks";

function isTabKey(tab: string | null): tab is TabKey {
  return validTabs.includes(tab as TabKey);
}

// ─── Settings layout ──────────────────────────────────────────────────────────

const SettingTabs: React.FC<{ tab: TabKey }> = ({ tab }) => {
  const { advancedMode, setAdvancedMode } = useSettings();
  const { canManageUsers } = useCurrentUser();
  const titleProps = useTitleProps({ id: "settings" });

  const renderContent = () => {
    switch (tab) {
      case "library":           return <SettingsLibraryPanel />;
      case "interface":         return <SettingsInterfacePanel />;
      case "security":          return <SettingsSecurityPanel />;
      case "users":             return <SettingsUsersPanel />;
      case "tasks":             return <SettingsTasksPanel />;
      case "services":          return <SettingsServicesPanel />;
      case "tools":             return <SettingsToolsPanel />;
      case "metadata-providers":return <SettingsScrapingPanel />;
      case "system":            return <SettingsConfigurationPanel />;
      case "plugins":           return <SettingsPluginsPanel />;
      case "logs":              return <SettingsLogsPanel />;
      case "changelog":         return <Changelog />;
      case "about":             return <SettingsAboutPanel />;
      case "recycle-bin":       return <SettingsRecycleBinPanel />;
      case "deovr-tunnel":      return <SettingsDeoVRTunnelPanel />;
      default:                  return null;
    }
  };

  return (
    <>
      <Helmet {...titleProps} />
      <SettingsBackground />

      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          minHeight: "calc(100dvh - 64px)",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* ── Sidebar ── */}
        <Box
          component="nav"
          aria-label="Settings sections"
          sx={{
            width: { xs: "100%", md: "240px", lg: "260px" },
            flexShrink: 0,
            bgcolor: { xs: "rgba(3,3,10,0.98)", md: "rgba(3,3,10,0.70)" },
            backdropFilter: { md: "blur(20px)" },
            WebkitBackdropFilter: { md: "blur(20px)" },
            borderBottom: { xs: "1px solid rgba(255,255,255,0.07)", md: 0 },
            borderRight: { xs: 0, md: "1px solid rgba(255,255,255,0.12)" },
            display: "flex",
            flexDirection: "column",
            height: { md: "calc(100dvh - 64px)" },
            position: { md: "sticky" },
            top: { md: 0 },
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <Box sx={{ px: 2.5, pt: 2.5, pb: 1.75 }}>
            <Typography
              sx={{
                fontSize: "0.6rem",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: "primary.main",
                fontWeight: 700,
                mb: 0.4,
                opacity: 0.85,
              }}
            >
              System
            </Typography>
            <Typography
              sx={{
                fontSize: "1.35rem",
                fontWeight: 800,
                color: "rgba(255,255,255,0.92)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                lineHeight: 1,
              }}
            >
              Settings
            </Typography>
            {/* Decorative separator */}
            <Box sx={{ mt: 1.75, display: "flex", alignItems: "center", gap: 1 }}>
              <Box
                sx={{
                  height: "1px",
                  width: 20,
                  bgcolor: "primary.main",
                  opacity: 0.7,
                  boxShadow: (theme) => `0 0 6px ${alpha(theme.palette.primary.main, 0.6)}`,
                }}
              />
              <Box sx={{ height: "1px", flex: 1, bgcolor: "rgba(255,255,255,0.07)" }} />
            </Box>
          </Box>

          {/* Nav items */}
          <Box
            sx={{
              flex: 1,
              overflowY: "auto",
              overflowX: "hidden",
              py: 0.5,
              "&::-webkit-scrollbar": { width: "3px" },
              "&::-webkit-scrollbar-thumb": { bgcolor: "rgba(255,255,255,0.1)", borderRadius: "2px" },
            }}
          >
            <NavItem label={<FormattedMessage id="config.categories.tasks" />} to="/settings?tab=tasks" active={tab === "tasks"} />
            <NavItem label={<FormattedMessage id="library" />} to="/settings?tab=library" active={tab === "library"} />
            <NavItem label={<FormattedMessage id="config.categories.interface" />} to="/settings?tab=interface" active={tab === "interface"} />
            <NavItem label={<FormattedMessage id="config.categories.security" />} to="/settings?tab=security" active={tab === "security"} />
            {canManageUsers && (
              <NavItem label={<FormattedMessage id="config.categories.users" defaultMessage="Users" />} to="/settings?tab=users" active={tab === "users"} />
            )}
            <NavItem label={<FormattedMessage id="config.categories.metadata_providers" />} to="/settings?tab=metadata-providers" active={tab === "metadata-providers"} />
            <NavItem label={<FormattedMessage id="config.categories.services" />} to="/settings?tab=services" active={tab === "services"} />
            <NavItem label={<FormattedMessage id="config.categories.system" />} to="/settings?tab=system" active={tab === "system"} />
            <NavItem label={<FormattedMessage id="config.categories.plugins" />} to="/settings?tab=plugins" active={tab === "plugins"} />
            <NavItem label={<FormattedMessage id="config.categories.logs" />} to="/settings?tab=logs" active={tab === "logs"} />
            <NavItem label={<FormattedMessage id="config.categories.tools" />} to="/settings?tab=tools" active={tab === "tools"} />

            {/* Lower group divider */}
            <Box sx={{ mx: 2.5, my: 1, height: "1px", bgcolor: "rgba(255,255,255,0.06)" }} />

            <NavItem label={<FormattedMessage id="config.categories.changelog" />} to="/settings?tab=changelog" active={tab === "changelog"} />
            <NavItem label={<FormattedMessage id="config.categories.about" />} to="/settings?tab=about" active={tab === "about"} />
            <NavItem label={<FormattedMessage id="config.categories.recycle_bin" />} to="/settings?tab=recycle-bin" active={tab === "recycle-bin"} />
            <NavItem label={<FormattedMessage id="config.categories.deovr-tunnel" />} to="/settings?tab=deovr-tunnel" active={tab === "deovr-tunnel"} />
          </Box>

          {/* Advanced mode toggle */}
          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderTop: "1px solid rgba(255,255,255,0.06)",
              bgcolor: "rgba(0,0,0,0.2)",
            }}
          >
            <FormControlLabel
              control={
                <Switch
                  checked={advancedMode}
                  onChange={() => setAdvancedMode(!advancedMode)}
                  size="small"
                  sx={{
                    "& .MuiSwitch-thumb": { transition: "all 0.2s ease" },
                  }}
                />
              }
              label={
                <Typography sx={{ fontSize: "0.775rem", color: "rgba(255,255,255,0.45)", letterSpacing: "0.02em" }}>
                  <FormattedMessage id="config.advanced_mode" />
                </Typography>
              }
            />
          </Box>
        </Box>

        {/* ── Content panel ── */}
        <Box
          sx={{
            flex: 1,
            position: "relative",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            bgcolor: { xs: "rgba(4,4,14,0.98)", md: "rgba(4,4,14,0.30)" },
          }}
        >
          {/* Corner brackets — desktop only */}
          {[
            { top: 10, left: 10, borderTop: "1px solid", borderLeft: "1px solid" },
            { top: 10, right: 10, borderTop: "1px solid", borderRight: "1px solid" },
            { bottom: 10, left: 10, borderBottom: "1px solid", borderLeft: "1px solid" },
            { bottom: 10, right: 10, borderBottom: "1px solid", borderRight: "1px solid" },
          ].map((corner, i) => (
            <Box
              key={i}
              sx={{
                display: { xs: "none", md: "block" },
                position: "absolute",
                width: 16,
                height: 16,
                borderColor: (theme) => alpha(theme.palette.primary.main, 0.25),
                zIndex: 2,
                pointerEvents: "none",
                ...corner,
              }}
            />
          ))}

          {/* Scrollable content */}
          <Box
            sx={{
              flex: 1,
              overflowY: "auto",
              p: { xs: 2, md: 3 },
              pb: { xs: 4, md: 4 },
              "&::-webkit-scrollbar": { width: "5px" },
              "&::-webkit-scrollbar-thumb": {
                bgcolor: "rgba(255,255,255,0.1)",
                borderRadius: "3px",
                "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
              },
              // Glass treatment for all Paper/Card surfaces in the settings panels
              "& .MuiPaper-root": {
                background: "rgba(8,8,22,0.35) !important",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
              },
              "& .MuiPaper-outlined": {
                borderColor: "rgba(255,255,255,0.09) !important",
              },
              // Tab panels and accordion-style containers
              "& .MuiAccordion-root": {
                background: "rgba(8,8,22,0.35) !important",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
              },
              // Table containers
              "& .MuiTableContainer-root": {
                background: "rgba(8,8,22,0.35) !important",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
              },
            }}
          >
            <Container maxWidth="xl" sx={{ p: 0 }}>
              {renderContent()}
            </Container>
          </Box>
        </Box>
      </Box>
    </>
  );
};

// ─── Root ─────────────────────────────────────────────────────────────────────

export const Settings: React.FC = () => {
  const location = useLocation();
  const tab = new URLSearchParams(location.search).get("tab");

  if (!isTabKey(tab)) {
    return (
      <Redirect
        to={{
          ...location,
          search: `?tab=${defaultTab}`,
        }}
      />
    );
  }

  return <SettingTabs tab={tab} />;
};

export default Settings;
