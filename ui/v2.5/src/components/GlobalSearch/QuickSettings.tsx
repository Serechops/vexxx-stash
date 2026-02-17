import React, { useState } from "react";
import { Tabs, Tab, Box } from "@mui/material";
import { FormattedMessage } from "react-intl";
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

    const settingListSx = {
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
    };

    const pluginItemSx = {
        background: 'rgba(255, 255, 255, 0.05)',
        borderRadius: '8px',
        p: '1rem',
    };

    return (
        <Box
            sx={{
                p: '1.5rem',
                overflowY: 'auto',
                flex: 1,
                '& .nav-tabs': {
                    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
                    mb: '1.5rem',
                    '& .nav-link': {
                        color: 'rgba(255, 255, 255, 0.6)',
                        border: 'none',
                        borderBottom: '2px solid transparent',
                        '&:hover': {
                            color: '#fff',
                            borderColor: 'transparent',
                        },
                        '&.active': {
                            color: '#fff',
                            background: 'transparent',
                            borderBottomColor: '#3b82f6',
                        },
                    },
                },
            }}
        >
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
                    <Box sx={settingListSx}>
                        <CustomCssSettings modalProps={modalProps} />
                        <CustomJavascriptSettings modalProps={modalProps} />
                    </Box>
                )}
                {activeTab === "plugins" && (
                    <Box sx={settingListSx}>
                        <Box sx={pluginItemSx}>
                            <PluginList modalProps={modalProps} />
                            <div className="mt-4 border-top pt-3">
                                <h5 className="mb-3"><FormattedMessage id="config.tasks.plugin_tasks" /></h5>
                                <PluginTasks />
                            </div>
                        </Box>
                    </Box>
                )}
                {activeTab === "library" && (
                    <Box sx={settingListSx}>
                        <LibrarySettings modalProps={modalProps} />
                    </Box>
                )}
                {activeTab === "stashbox" && (
                    <Box sx={settingListSx}>
                        <StashBoxSettings modalProps={modalProps} />
                    </Box>
                )}
            </Box>
        </Box>
    );
};
