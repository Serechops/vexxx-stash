import React, { useState } from "react";
import { Tab, Tabs } from "react-bootstrap";
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
                activeKey={activeTab}
                onSelect={(k) => setActiveTab(k ?? "interface")}
                className="nav-tabs"
            >
                <Tab eventKey="interface" title={<FormattedMessage id="UI Settings" />}>
                    <div className={style.settingList}>
                        <CustomCssSettings modalProps={modalProps} />
                        <CustomJavascriptSettings modalProps={modalProps} />
                    </div>
                </Tab>
                <Tab eventKey="plugins" title={<FormattedMessage id="Plugins" />}>
                    <div className={style.settingList}>
                        <div className={style.pluginItem}>
                            <PluginList modalProps={modalProps} />
                            <div className="mt-4 border-top pt-3">
                                <h5 className="mb-3"><FormattedMessage id="config.tasks.plugin_tasks" /></h5>
                                <PluginTasks />
                            </div>
                        </div>
                    </div>
                </Tab>
                <Tab eventKey="library" title={<FormattedMessage id="Library Settings" />}>
                    <div className={style.settingList}>
                        <LibrarySettings modalProps={modalProps} />
                    </div>
                </Tab>
                <Tab eventKey="stashbox" title={<FormattedMessage id="Stash Box Settings" />}>
                    <div className={style.settingList}>
                        <StashBoxSettings modalProps={modalProps} />
                    </div>
                </Tab>
            </Tabs>
        </div>
    );
};
