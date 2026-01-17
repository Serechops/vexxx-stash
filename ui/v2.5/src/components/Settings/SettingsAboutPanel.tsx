import React from "react";
import { Button } from "@mui/material";
import { useIntl } from "react-intl";
import { useLatestVersion, useVersion } from "src/core/StashService";
import { ExternalLink } from "../Shared/ExternalLink";
import { ConstantSetting, SettingGroup } from "./Inputs";
import { SettingSection } from "./SettingSection";

export const SettingsAboutPanel: React.FC = () => {
  const gitHash = import.meta.env.VITE_APP_GITHASH;
  const stashVersion = import.meta.env.VITE_APP_STASH_VERSION;
  const buildTime = import.meta.env.VITE_APP_DATE;

  const intl = useIntl();

  const {
    data: dataLatest,
    error: errorLatest,
    loading: loadingLatest,
    refetch,
    networkStatus,
  } = useLatestVersion();
  const { data: dataVersion } = useVersion();

  const currentRepo = (dataVersion?.version as any)?.repo || "stashapp/stash";
  const latestRepo = (dataLatest?.latestversion as any)?.repo || "stashapp/stash";

  function renderLatestVersion() {
    if (errorLatest) {
      return (
        <SettingGroup
          settingProps={{
            heading: errorLatest.message,
          }}
        />
      );
    } else if (!dataLatest || loadingLatest || networkStatus === 4) {
      return (
        <SettingGroup
          settingProps={{
            headingID: "loading.generic",
          }}
        />
      );
    } else {
      let heading = dataLatest.latestversion.version;
      const hashString = dataLatest.latestversion.shorthash;
      if (gitHash !== hashString) {
        heading +=
          " " +
          intl.formatMessage({
            id: "config.about.new_version_notice",
          });
      }
      return (
        <SettingGroup
          settingProps={{
            heading,
          }}
        >
          <div className="setting">
            <div>
              <h3>
                {intl.formatMessage({
                  id: "config.about.build_hash",
                })}
              </h3>
              <div className="value">
                <ExternalLink href={`https://github.com/${latestRepo}/commit/${hashString}`}>
                  {hashString}
                </ExternalLink>
              </div>
            </div>
            <div>
              <Button
                href="https://www.patreon.com/c/Creat1veB1te"
                variant="contained"
                target="_blank"
                rel="noopener noreferrer"
              >
                {intl.formatMessage({
                  id: "config.about.check_for_new_version",
                })}
              </Button>
            </div>
          </div>
          <ConstantSetting
            headingID="config.about.release_date"
            value={dataLatest.latestversion.release_date}
          />
          {latestRepo !== currentRepo && (
            <ConstantSetting
              heading="Release Repository"
              value={(
                <ExternalLink href={`https://github.com/${latestRepo}`}>
                  {latestRepo}
                </ExternalLink>
              )}
            />
          )}
        </SettingGroup>
      );
    }
  }

  return (
    <>
      <SettingSection headingID="config.about.version">
        <SettingGroup
          settingProps={{
            heading: `${stashVersion}${currentRepo !== "stashapp/stash" ? ` (${currentRepo})` : ""}`,
          }}
        >
          <ConstantSetting
            headingID="config.about.build_hash"
            value={(
              <ExternalLink href={`https://github.com/${currentRepo}/commit/${gitHash}`}>
                {gitHash}
              </ExternalLink>
            )}
          />
          <ConstantSetting
            headingID="config.about.build_time"
            value={buildTime}
          />
        </SettingGroup>
      </SettingSection>

      <SettingSection headingID="config.about.latest_version">
        {renderLatestVersion()}
      </SettingSection>

      <SettingSection headingID="config.categories.about">
        <div className="setting">
          <div>
            <p>
              {intl.formatMessage(
                { id: "config.about.stash_home" },
                {
                  url: (
                    <ExternalLink href={`https://github.com/${currentRepo}`}>
                      GitHub
                    </ExternalLink>
                  ),
                }
              )}
            </p>
            <p>
              {intl.formatMessage(
                { id: "config.about.stash_wiki" },
                {
                  url: (
                    <ExternalLink href="https://docs.stashapp.cc">
                      Documentation
                    </ExternalLink>
                  ),
                }
              )}
            </p>
            <p>
              {intl.formatMessage(
                { id: "config.about.stash_discord" },
                {
                  url: (
                    <ExternalLink href="https://discord.gg/2TsNFKt">
                      Discord
                    </ExternalLink>
                  ),
                }
              )}
            </p>
            <p>
              {intl.formatMessage(
                { id: "config.about.stash_open_collective" },
                {
                  url: (
                    <ExternalLink href="https://opencollective.com/stashapp">
                      Open Collective
                    </ExternalLink>
                  ),
                }
              )}
            </p>
          </div>
          <div />
        </div>
      </SettingSection>
    </>
  );
};
