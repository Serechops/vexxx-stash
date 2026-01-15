import React from "react";
import { TextField } from "@mui/material";
import { SettingSection } from "../SettingSection";
import { BooleanSetting, ModalSetting } from "../Inputs";

import { useSettings } from "../context";

interface IProps {
    modalProps?: any;
}

export const CustomCssSettings: React.FC<IProps> = ({ modalProps }) => {
    const { interface: iface, saveInterface } = useSettings();

    return (
        <SettingSection headingID="config.ui.custom_css.heading">
            <BooleanSetting
                id="custom-css-enabled"
                headingID="config.ui.custom_css.option_label"
                checked={iface.cssEnabled ?? undefined}
                onChange={(v) => saveInterface({ cssEnabled: v })}
            />

            <ModalSetting<string>
                id="custom-css"
                headingID="config.ui.custom_css.heading"
                subHeadingID="config.ui.custom_css.description"
                value={iface.css ?? undefined}
                onChange={(v) => saveInterface({ css: v })}
                modalProps={modalProps}
                renderField={(value, setValue) => (
                    <TextField
                        multiline
                        fullWidth
                        variant="outlined"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        minRows={16}
                        className="text-input code"
                    />
                )}
                renderValue={() => {
                    return <></>;
                }}
            />
        </SettingSection>
    );
};
