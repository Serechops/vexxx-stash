import React from "react";
import { Button } from "@mui/material";
import { FormattedMessage } from "react-intl";
import { Link } from "react-router-dom";
import { Setting } from "./Inputs";
import { SettingSection } from "./SettingSection";
import { PatchContainerComponent } from "src/patch";
import { ExternalLink } from "../Shared/ExternalLink";

const SettingsToolsSection = PatchContainerComponent("SettingsToolsSection");

type InternalTool = {
  type: "internal";
  id: string;
  to: string;
  labelId: string;
  defaultLabel: string;
};

type ExternalTool = {
  type: "external";
  id: string;
  href: string;
  labelId: string;
  defaultLabel: string;
};

const generalTools: ExternalTool[] = [
  {
    type: "external",
    id: "graphql-playground",
    href: "/playground",
    labelId: "config.tools.graphql_playground",
    defaultLabel: "GraphQL playground",
  },
];

const sceneTools: InternalTool[] = [
  {
    type: "internal",
    id: "scene-filename-parser",
    to: "/sceneFilenameParser",
    labelId: "config.tools.scene_filename_parser.title",
    defaultLabel: "Scene Filename Parser",
  },
  {
    type: "internal",
    id: "scene-duplicate-checker",
    to: "/sceneDuplicateChecker",
    labelId: "config.tools.scene_duplicate_checker",
    defaultLabel: "Scene Duplicate Checker",
  },
  {
    type: "internal",
    id: "moviefy",
    to: "/moviefy",
    labelId: "config.tools.moviefy",
    defaultLabel: "MovieFy",
  },
  {
    type: "internal",
    id: "renamer",
    to: "/renamer",
    labelId: "config.tools.renamer",
    defaultLabel: "Renamer",
  },
];

function renderToolAction(tool: InternalTool | ExternalTool) {
  const label = (
    <FormattedMessage id="config.tools.open" defaultMessage="Open" />
  );

  if (tool.type === "external") {
    return (
      <ExternalLink href={tool.href}>
        <Button variant="contained">{label}</Button>
      </ExternalLink>
    );
  }

  return (
    <Link to={tool.to}>
      <Button variant="contained">{label}</Button>
    </Link>
  );
}

export const SettingsToolsPanel: React.FC = () => {
  return (
    <>
      <SettingSection headingID="config.tools.heading">
        <SettingsToolsSection>
          {generalTools.map((tool) => (
            <Setting
              key={tool.id}
              heading={
                <FormattedMessage
                  id={tool.labelId}
                  defaultMessage={tool.defaultLabel}
                />
              }
            >
              {renderToolAction(tool)}
            </Setting>
          ))}
        </SettingsToolsSection>
      </SettingSection>
      <SettingSection headingID="config.tools.scene_tools">
        <SettingsToolsSection>
          {sceneTools.map((tool) => (
            <Setting
              key={tool.id}
              heading={
                <FormattedMessage
                  id={tool.labelId}
                  defaultMessage={tool.defaultLabel}
                />
              }
            >
              {renderToolAction(tool)}
            </Setting>
          ))}
        </SettingsToolsSection>
      </SettingSection>
    </>
  );
};
