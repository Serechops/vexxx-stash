import React, { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useConfigureUI } from "src/core/StashService";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { Button } from "@mui/material";
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
    <div className="recommendations-container bg-background min-h-screen">
      <LandingHero />
      <div className="px-4 md:px-12 -mt-24 relative z-10 pb-12 space-y-8">
        {frontPageContent?.map((content, i) => (
          <Control key={i} content={content} />
        ))}
      </div>
      <div className="recommendations-footer">
        <Button variant="outlined" onClick={() => setIsEditing(true)}>
          <FormattedMessage id={"actions.customise"} />
        </Button>
      </div>

      <footer className="w-full py-6 mt-12 border-t border-gray-800 text-center text-sm text-gray-500">
        <p>
          Powered by{" "}
          <a
            href="https://github.com/stashapp/stash"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-white transition-colors"
          >
            Stash
          </a>
          . Licensed under{" "}
          <a
            href="https://github.com/stashapp/stash/blob/develop/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-white transition-colors"
          >
            AGPLv3
          </a>
          . <span className="mx-2">|</span> Report bugs at{" "}
          <a
            href="https://github.com/Serechops/vexxx-stash"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-white transition-colors"
          >
            Vexxx Stash
          </a>
          .
        </p>
      </footer>
    </div>
  );
});

export default FrontPage;
