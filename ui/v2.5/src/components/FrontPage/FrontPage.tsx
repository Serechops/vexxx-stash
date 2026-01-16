import React, { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useConfigureUI } from "src/core/StashService";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { Box, Button } from "@mui/material";
import { FrontPageConfig } from "./FrontPageConfig";
import { LandingHero } from "./LandingHero";
import { useToast } from "src/hooks/Toast";
import { Control } from "./Control";
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
      }}
    >
      <LandingHero />
      <Box
        sx={{
          px: { xs: 2, md: 6 },
          mt: -12,
          position: "relative",
          zIndex: 10,
          pb: 6,
        }}
      >
        {frontPageContent?.map((content, i) => (
          <Control key={i} content={content} />
        ))}
      </Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          mb: 2,
          mr: 2,
        }}
      >
        <Button variant="outlined" onClick={() => setIsEditing(true)}>
          <FormattedMessage id={"actions.customise"} />
        </Button>
      </Box>

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
  );
});

export default FrontPage;
