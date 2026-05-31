import React, { useMemo, useState } from "react";
import { Tabs, Tab, Box, Typography } from "@mui/material";
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

type QuickSettingsTab = "interface" | "plugins" | "library" | "stashbox";

export const QuickSettings: React.FC<QuickSettingsProps> = () => {
    const [activeTab, setActiveTab] = useState<QuickSettingsTab>("interface");

    const modalProps = useMemo(() => ({
        contentClassName: "quick-settings-modal-content",
        style: { zIndex: 20000 },
    }), []);

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
            }}
        >
            <Tabs
                value={activeTab}
                onChange={(_e, newValue: QuickSettingsTab) => setActiveTab(newValue)}
                aria-label="Quick settings tabs"
            >
                <Tab value="interface" label={<FormattedMessage id="config.categories.interface" />} />
                <Tab value="plugins" label={<FormattedMessage id="config.categories.plugins" />} />
                <Tab value="library" label={<FormattedMessage id="library" />} />
                <Tab value="stashbox" label={<FormattedMessage id="config.stashbox.title" />} />
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
                        <Box sx={{ ...pluginItemSx, bgcolor: 'background.paper', border: 1, borderColor: 'divider' }}>
                            <PluginList modalProps={modalProps} />
                            <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider' }}>
                                <Typography variant="h5" sx={{ mb: 3 }}><FormattedMessage id="config.tasks.plugin_tasks" /></Typography>
                                <PluginTasks />
                            </Box>
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
