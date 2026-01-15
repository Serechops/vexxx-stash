import React from "react";
import { Button } from "@mui/material";
import { FormattedMessage } from "react-intl";
import { Link } from "react-router-dom";
import { Setting } from "./Inputs";
import { SettingSection } from "./SettingSection";
import { PatchContainerComponent } from "src/patch";
import { ExternalLink } from "../Shared/ExternalLink";

const SettingsToolsSection = PatchContainerComponent("SettingsToolsSection");

export const SettingsToolsPanel: React.FC = () => {
  return (
    <>
      <SettingSection headingID="config.tools.heading">
        <SettingsToolsSection>
          <Setting
            heading={
              <ExternalLink href="/playground">
                <Button variant="contained">
                  <FormattedMessage id="config.tools.graphql_playground" />
                </Button>
              </ExternalLink>
            }
          />
        </SettingsToolsSection>
      </SettingSection>
      <SettingSection headingID="config.tools.scene_tools">
        <SettingsToolsSection>
          <Setting
            heading={
              <Link to="/sceneFilenameParser">
                <Button variant="contained">
                  <FormattedMessage id="config.tools.scene_filename_parser.title" />
                </Button>
              </Link>
            }
          />

          <Setting
            heading={
              <Link to="/sceneDuplicateChecker">
                <Button variant="contained">
                  <FormattedMessage id="config.tools.scene_duplicate_checker" />
                </Button>
              </Link>
            }
          />

          <Setting
            heading={
              <Link to="/moviefy">
                <Button variant="contained">MovieFy</Button>
              </Link>
            }
          />
          <Setting
            heading={
              <Link to="/renamer">
                <Button variant="contained">Renamer</Button>
              </Link>
            }
          />
        </SettingsToolsSection>
      </SettingSection>
    </>
  );
};
