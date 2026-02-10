import React, { useState } from "react";
import { Tabs, Tab, Box } from "@mui/material";
import { FormattedMessage } from "react-intl";
import style from "./GlobalSearch.module.scss";
import { CustomCssSettings } from "../Settings/SettingsInterfacePanel/CustomCssSettings";
import { CustomJavascriptSettings } from "../Settings/SettingsInterfacePanel/CustomJavascriptSettings";
import { PluginList } from "../Settings/SettingsPluginsPanel/PluginList";
import { LibrarySettings } from "../Settings/SettingsInterfacePanel/LibrarySettings";
import { StashBoxSettings } from "../Settings/SettingsInterfacePanel/StashBoxSettings";
import { PluginTasks } from "../Settings/Tasks/PluginTasks";

interface QuickSettingsProps {
    onClose?: () => void;
}

export const QuickSettings: React.FC<QuickSettingsProps> = ({ onClose }) => {
    const [activeTab, setActiveTab] = useState<string>("interface");

    const modalProps = {
        contentClassName: "quick-settings-modal-content",
        style: { zIndex: 20000 },
    };

    return (
        <div className={style.quickSettings}>
            <Tabs
                value={activeTab}
                onChange={(_e, newValue) => setActiveTab(newValue)}
                
            >
                <Tab value="interface" label={<FormattedMessage id="UI Settings" />} />
                <Tab value="plugins" label={<FormattedMessage id="Plugins" />} />
                <Tab value="library" label={<FormattedMessage id="Library Settings" />} />
                <Tab value="stashbox" label={<FormattedMessage id="Stash Box Settings" />} />
            </Tabs>

            <Box sx={{ mt: 2 }}>
                {activeTab === "interface" && (
                    <div className={style.settingList}>
                        <CustomCssSettings modalProps={modalProps} />
                        <CustomJavascriptSettings modalProps={modalProps} />
                    </div>
                )}
                {activeTab === "plugins" && (
                    <div className={style.settingList}>
                        <div className={style.pluginItem}>
                            <PluginList modalProps={modalProps} />
                            <div className="mt-4 border-top pt-3">
                                <h5 className="mb-3"><FormattedMessage id="config.tasks.plugin_tasks" /></h5>
                                <PluginTasks />
                            </div>
                        </div>
                    </div>
                )}
                {activeTab === "library" && (
                    <div className={style.settingList}>
                        <LibrarySettings modalProps={modalProps} />
                    </div>
                )}
                {activeTab === "stashbox" && (
                    <div className={style.settingList}>
                        <StashBoxSettings modalProps={modalProps} />
                    </div>
                )}
            </Box>
        </div>
    );
};
