import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Tabs,
  Tab,
  Box,
  Typography,
  IconButton,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

import Introduction from "src/docs/en/Manual/Introduction.md";
import Tasks from "src/docs/en/Manual/Tasks.md";
import AutoTagging from "src/docs/en/Manual/AutoTagging.md";
import JSONSpec from "src/docs/en/Manual/JSONSpec.md";
import Configuration from "src/docs/en/Manual/Configuration.md";
import Interface from "src/docs/en/Manual/Interface.md";
import Images from "src/docs/en/Manual/Images.md";
import Scraping from "src/docs/en/Manual/Scraping.md";
import ScraperDevelopment from "src/docs/en/Manual/ScraperDevelopment.md";
import Plugins from "src/docs/en/Manual/Plugins.md";
import ExternalPlugins from "src/docs/en/Manual/ExternalPlugins.md";
import EmbeddedPlugins from "src/docs/en/Manual/EmbeddedPlugins.md";
import UIPluginApi from "src/docs/en/Manual/UIPluginApi.md";
import Tagger from "src/docs/en/Manual/Tagger.md";
import Contributing from "src/docs/en/Manual/Contributing.md";
import SceneFilenameParser from "src/docs/en/Manual/SceneFilenameParser.md";
import KeyboardShortcuts from "src/docs/en/Manual/KeyboardShortcuts.md";
import Help from "src/docs/en/Manual/Help.md";
import Deduplication from "src/docs/en/Manual/Deduplication.md";
import Interactive from "src/docs/en/Manual/Interactive.md";
import Captions from "src/docs/en/Manual/Captions.md";
import Identify from "src/docs/en/Manual/Identify.md";
import Browsing from "src/docs/en/Manual/Browsing.md";
import { MarkdownPage } from "../Shared/MarkdownPage";

interface IManualProps {
  animation?: boolean; // Unused in MUI Dialog but kept for compatibility
  show: boolean;
  onClose: () => void;
  defaultActiveTab?: string;
}

export const Manual: React.FC<IManualProps> = ({
  show,
  onClose,
  defaultActiveTab,
}) => {
  const content = [
    {
      key: "Introduction.md",
      title: "Introduction",
      content: Introduction,
    },
    {
      key: "Configuration.md",
      title: "Configuration",
      content: Configuration,
    },
    {
      key: "Interface.md",
      title: "Interface Options",
      content: Interface,
    },
    {
      key: "Tasks.md",
      title: "Tasks",
      content: Tasks,
    },
    {
      key: "Identify.md",
      title: "Identify",
      content: Identify,
      className: "indent-1",
    },
    {
      key: "AutoTagging.md",
      title: "Auto Tagging",
      content: AutoTagging,
      className: "indent-1",
    },
    {
      key: "SceneFilenameParser.md",
      title: "Scene Filename Parser",
      content: SceneFilenameParser,
      className: "indent-1",
    },
    {
      key: "JSONSpec.md",
      title: "JSON Specification",
      content: JSONSpec,
      className: "indent-1",
    },
    {
      key: "Browsing.md",
      title: "Browsing",
      content: Browsing,
    },
    {
      key: "Images.md",
      title: "Images and Galleries",
      content: Images,
    },
    {
      key: "Scraping.md",
      title: "Metadata Scraping",
      content: Scraping,
    },
    {
      key: "ScraperDevelopment.md",
      title: "Scraper Development",
      content: ScraperDevelopment,
      className: "indent-1",
    },
    {
      key: "Plugins.md",
      title: "Plugins",
      content: Plugins,
    },
    {
      key: "ExternalPlugins.md",
      title: "External",
      content: ExternalPlugins,
      className: "indent-1",
    },
    {
      key: "EmbeddedPlugins.md",
      title: "Embedded",
      content: EmbeddedPlugins,
      className: "indent-1",
    },
    {
      key: "UIPluginApi.md",
      title: "UI Plugin API",
      content: UIPluginApi,
      className: "indent-1",
    },
    {
      key: "Tagger.md",
      title: "Scene Tagger",
      content: Tagger,
    },
    {
      key: "Deduplication.md",
      title: "Dupe Checker",
      content: Deduplication,
    },
    {
      key: "Interactive.md",
      title: "Interactivity",
      content: Interactive,
    },
    {
      key: "Captions.md",
      title: "Captions",
      content: Captions,
    },
    {
      key: "KeyboardShortcuts.md",
      title: "Keyboard Shortcuts",
      content: KeyboardShortcuts,
    },
    {
      key: "Contributing.md",
      title: "Contributing",
      content: Contributing,
    },
    {
      key: "Help.md",
      title: "Further Help",
      content: Help,
    },
  ];

  const [activeTab, setActiveTab] = useState<string>(content[0].key);

  useEffect(() => {
    if (defaultActiveTab) {
      setActiveTab(defaultActiveTab);
    }
  }, [defaultActiveTab]);

  // links to other manual pages are specified as "/help/page.md"
  // intercept clicks to these pages and set the tab accordingly
  function interceptLinkClick(
    event: React.MouseEvent<HTMLDivElement, MouseEvent>
  ) {
    if (event.target instanceof HTMLAnchorElement) {
      const href = event.target.getAttribute("href");
      if (href && href.startsWith("/help")) {
        const newKey = event.target.pathname.substring("/help/".length);
        setActiveTab(newKey);
        event.preventDefault();
      }
    }
  }

  const handleTabChange = (event: React.SyntheticEvent, newValue: string) => {
    setActiveTab(newValue);
  };

  const theme = useTheme();
  // Responsive check if needed, though dialog handles a lot.
  // For vertical tabs, we generally want enough width.
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('md'));

  const activeContent = content.find((c) => c.key === activeTab);

  return (
    <Dialog
      open={show}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      scroll="paper"
      aria-labelledby="manual-dialog-title"
    >
      <DialogTitle id="manual-dialog-title">
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Help</Typography>
          <IconButton edge="end" color="inherit" onClick={onClose} aria-label="close">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, height: '80vh' }}>
        <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, height: "100%" }}>
          <Box
            sx={{
              width: { xs: "100%", md: "25%" },
              borderRight: 1,
              borderColor: "divider",
              overflowY: "auto",
              height: { xs: "auto", md: "100%" },
              maxHeight: { xs: "40vh", md: "100%" }, // Limit tab height on mobile
              flexShrink: 0
            }}
          >
            <Tabs
              orientation={isSmallScreen ? "horizontal" : "vertical"}
              variant="scrollable"
              value={activeTab}
              onChange={handleTabChange}
              aria-label="Manual navigation"
              sx={{
                "& .MuiTab-root": {
                  alignItems: "flex-start",
                  textAlign: "left",
                  textTransform: "none",
                },
              }}
            >
              {content.map((c) => (
                <Tab
                  key={c.key}
                  label={c.title}
                  value={c.key}
                  sx={{
                    pl: c.className === "indent-1" ? 4 : 2,
                    borderBottom: 1,
                    borderColor: "divider"
                  }}
                />
              ))}
            </Tabs>
          </Box>
          <Box
            sx={{
              width: { xs: "100%", md: "75%" },
              overflowY: "auto",
              p: 3,
              height: { xs: "auto", md: "100%" },
              flexGrow: 1
            }}
            onClick={interceptLinkClick}
          >
            {activeContent && (
              <Box>
                <MarkdownPage page={activeContent.content} />
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default Manual;
