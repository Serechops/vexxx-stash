import React, { useMemo } from "react";
import { Button, Typography, Box } from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import {
    mutateSetPluginsEnabled,
    usePlugins,
} from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import TextUtils from "src/utils/text";
import { CollapseButton } from "../../Shared/CollapseButton";
import { Icon } from "../../Shared/Icon";
import { LoadingIndicator } from "../../Shared/LoadingIndicator";
import {
    BooleanSetting,
    NumberSetting,
    SettingGroup,
    StringSetting,
} from "../Inputs";
import { faLink } from "@fortawesome/free-solid-svg-icons";
import { useSettings } from "../context";
import { ExternalLink } from "../../Shared/ExternalLink";
import { PatchComponent } from "src/patch";

interface IPluginSettingProps {
    pluginID: string;
    setting: GQL.PluginSetting;
    value: unknown;
    onChange: (value: unknown) => void;
    modalProps?: any;
}

const PluginSetting: React.FC<IPluginSettingProps> = ({
    pluginID,
    setting,
    value,
    onChange,
    modalProps,
}) => {
    const commonProps = {
        heading: setting.display_name ? setting.display_name : setting.name,
        id: `plugin-${pluginID}-${setting.name}`,
        subHeading: setting.description ?? undefined,
    };

    switch (setting.type) {
        case GQL.PluginSettingTypeEnum.Boolean:
            return (
                <BooleanSetting
                    {...commonProps}
                    checked={(value as boolean) ?? false}
                    onChange={() => onChange(!value)}
                />
            );
        case GQL.PluginSettingTypeEnum.String:
            return (
                <StringSetting
                    {...commonProps}
                    value={(value as string) ?? ""}
                    onChange={(v) => onChange(v)}
                    modalProps={modalProps}
                />
            );
        case GQL.PluginSettingTypeEnum.Number:
            return (
                <NumberSetting
                    {...commonProps}
                    value={(value as number) ?? 0}
                    onChange={(v) => onChange(v)}
                    modalProps={modalProps}
                />
            );
    }
};

const PluginSettings: React.FC<{
    pluginID: string;
    settings: GQL.PluginSetting[];
    modalProps?: any;
}> = PatchComponent("PluginSettings", ({ pluginID, settings, modalProps }) => {
    const { plugins, savePluginSettings } = useSettings();
    const pluginSettings = plugins[pluginID] ?? {};

    return (
        <div className="plugin-settings">
            {settings.map((setting) => (
                <PluginSetting
                    key={setting.name}
                    pluginID={pluginID}
                    setting={setting}
                    value={pluginSettings[setting.name]}
                    onChange={(v) =>
                        savePluginSettings(pluginID, {
                            ...pluginSettings,
                            [setting.name]: v,
                        })
                    }
                    modalProps={modalProps}
                />
            ))}
        </div>
    );
});


interface IPluginListProps {
    modalProps?: any;
}

export const PluginList: React.FC<IPluginListProps> = ({ modalProps }) => {
    const Toast = useToast();
    const intl = useIntl();
    const { data, loading } = usePlugins();

    const [changedPluginID, setChangedPluginID] = React.useState<string | undefined>();

    const pluginElements = useMemo(() => {
        function renderLink(url?: string) {
            if (url) {
                return (
                    <Button
                        component={ExternalLink}
                        href={TextUtils.sanitiseURL(url)}
                        className="minimal link"
                    >
                        <Icon icon={faLink} />
                    </Button>
                );
            }
        }

        function renderEnableButton(pluginID: string, enabled: boolean) {
            async function onClick() {
                try {
                    await mutateSetPluginsEnabled({ [pluginID]: !enabled });
                } catch (e) {
                    Toast.error(e);
                }

                setChangedPluginID(pluginID);
            }

            return (
                <Button size="small" onClick={onClick} variant="outlined">
                    <FormattedMessage
                        id={enabled ? "actions.disable" : "actions.enable"}
                    />
                </Button>
            );
        }

        function onReloadUI() {
            window.location.reload();
        }

        function maybeRenderReloadUI(pluginID: string) {
            if (pluginID === changedPluginID) {
                return (
                    <Button size="small" onClick={() => onReloadUI()} variant="outlined">
                        Reload UI
                    </Button>
                );
            }
        }

        function renderPlugins() {
            const elements = (data?.plugins ?? []).map((plugin) => (
                <SettingGroup
                    key={plugin.id}
                    settingProps={{
                        heading: `${plugin.name} ${plugin.version ? `(${plugin.version})` : undefined
                            }`,
                        className: !plugin.enabled ? "disabled" : undefined,
                        subHeading: plugin.description,
                    }}
                    topLevel={
                        <>
                            {renderLink(plugin.url ?? undefined)}
                            {maybeRenderReloadUI(plugin.id)}
                            {renderEnableButton(plugin.id, plugin.enabled)}
                        </>
                    }
                >
                    {renderPluginHooks(plugin.hooks ?? undefined)}
                    <PluginSettings
                        pluginID={plugin.id}
                        settings={plugin.settings ?? []}
                        modalProps={modalProps}
                    />
                </SettingGroup>
            ));

            return <div>{elements}</div>;
        }

        function renderPluginHooks(
            hooks?: Pick<GQL.PluginHook, "name" | "description" | "hooks">[]
        ) {
            if (!hooks || hooks.length === 0) {
                return;
            }

            return (
                <div className="setting">
                    <Box>
                        <Typography variant="h6" gutterBottom>
                            <FormattedMessage id="config.plugins.hooks" />
                        </Typography>
                        {hooks.map((h) => (
                            <Box key={`${h.name}`} sx={{ mb: 2 }}>
                                <Typography variant="subtitle1" gutterBottom>{h.name}</Typography>
                                <CollapseButton
                                    text={intl.formatMessage({
                                        id: "config.plugins.triggers_on",
                                    })}
                                >
                                    <ul>
                                        {h.hooks?.map((hh) => (
                                            <li key={hh}>
                                                <code>{hh}</code>
                                            </li>
                                        ))}
                                    </ul>
                                </CollapseButton>
                                <Typography variant="caption" color="textSecondary">{h.description}</Typography>
                            </Box>
                        ))}
                    </Box>
                    <div />
                </div>
            );
        }

        return renderPlugins();
    }, [data?.plugins, intl, Toast, changedPluginID]);

    if (loading) return <LoadingIndicator />;

    return <>{pluginElements}</>;
};
