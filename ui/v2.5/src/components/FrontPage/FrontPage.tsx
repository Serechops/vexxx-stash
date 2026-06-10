import React, { useState } from "react";
import { useIntl } from "react-intl";
import { useConfigureUI } from "src/core/StashService";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { Box, IconButton, Tooltip } from "@mui/material";
import { Settings } from "lucide-react";
import { FrontPageConfig } from "./FrontPageConfig";
import { HeroBanner } from "./HeroBanner";
import { useToast } from "src/hooks/Toast";
import { Control } from "./Control";
import { ContinueWatchingRow } from "../Scenes/ContinueWatchingRow";
import { useConfigurationContext } from "src/hooks/Config";
import {
  FrontPageContent,
  generateDefaultFrontPageContent,
  getFrontPageContent,
} from "src/core/config";
import { useScrollToTopOnMount } from "src/hooks/scrollToTop";
import { PatchComponent } from "src/patch";

const FrontPage: React.FC = PatchComponent("FrontPage", () => {
  const intl = useIntl();
  const Toast = useToast();

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [saveUI] = useConfigureUI();

  const { configuration } = useConfigurationContext();

  useScrollToTopOnMount();

  async function onUpdateConfig(content?: FrontPageContent[]) {
    setIsEditing(false);

    if (!content) {
      return;
    }

    setSaving(true);
    try {
      await saveUI({
        variables: {
          input: {
            ...configuration?.ui,
            frontPageContent: content,
          },
        },
      });
    } catch (e) {
      Toast.error(e);
    }
    setSaving(false);
  }

  if (saving) {
    return <LoadingIndicator />;
  }

  if (isEditing) {
    return <FrontPageConfig onClose={(content) => onUpdateConfig(content)} />;
  }

  const ui = configuration?.ui ?? {};

  if (!ui.frontPageContent) {
    const defaultContent = generateDefaultFrontPageContent(intl);
    onUpdateConfig(defaultContent);
  }

  const frontPageContent = getFrontPageContent(ui);

  return (
    <Box
      sx={{
        bgcolor: "background.default",
        minHeight: "100vh",
        position: "relative",
        width: "100vw",
        marginLeft: "calc(50% - 50vw)",
        marginRight: "calc(50% - 50vw)",
        maxWidth: "none",
        overflowX: "hidden", // Prevent horizontal scrollbars if calc is slightly off due to scrollbar width
        "& > *": { maxWidth: "none" },
      }}
    >
      {/* Fixed Hero Banner */}
      <Box sx={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100vh", zIndex: 0 }}>
        <HeroBanner />
      </Box>

      {/* Scrollable Content Overlay */}
      <Box
        sx={{
          position: "relative",
          zIndex: 10,
          mt: { xs: "50vw", md: "65vh" }, // Push content down to reveal hero (responsive)
          background: "linear-gradient(to bottom, transparent, #09090b 20%, #09090b)",
          pt: { xs: 4, md: 10 },
          pb: 6,
          px: { xs: 2, md: 6 },
          minHeight: "40vh", // Ensure enough scroll space
          width: "100%",
          maxWidth: "100%",
        }}
      >
        <ContinueWatchingRow />
{frontPageContent?.map((content, i) => (
          <Control key={i} content={content} />
        ))}

        {/* Floating customise button */}
        <Tooltip title="Customise front page" placement="left">
          <IconButton
            onClick={() => setIsEditing(true)}
            sx={{
              position: "fixed",
              bottom: 24,
              right: 24,
              zIndex: 50,
              bgcolor: "rgba(0,0,0,0.5)",
              border: "1px solid rgba(255,255,255,0.15)",
              backdropFilter: "blur(8px)",
              color: "grey.400",
              "&:hover": { bgcolor: "rgba(0,0,0,0.75)", color: "white" },
              transition: "all 0.2s",
            }}
          >
            <Settings size={20} />
          </IconButton>
        </Tooltip>

        <Box
          component="footer"
          sx={{
            width: "100%",
            py: 3,
            mt: 6,
            borderTop: 1,
            borderColor: "grey.800",
            textAlign: "center",
            fontSize: "0.875rem",
            color: "grey.500",
            "& a": {
              color: "grey.400",
              "&:hover": { color: "white" },
              transition: "color 0.2s",
            },
          }}
        >
          <p>
            Powered by{" "}
            <a
              href="https://github.com/stashapp/stash"
              target="_blank"
              rel="noopener noreferrer"
            >
              Stash
            </a>
            . Licensed under{" "}
            <a
              href="https://github.com/stashapp/stash/blob/develop/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
            >
              AGPLv3
            </a>
            . <span>|</span> Report bugs at{" "}
            <a
              href="https://github.com/Serechops/vexxx-stash"
              target="_blank"
              rel="noopener noreferrer"
            >
              Vexxx Stash
            </a>
            .
          </p>
        </Box>
      </Box>
    </Box>
  );
});

export default FrontPage;
