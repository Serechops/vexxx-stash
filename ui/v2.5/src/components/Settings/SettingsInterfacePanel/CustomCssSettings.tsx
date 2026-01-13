import React from "react";
import { Form } from "react-bootstrap";
import { SettingSection } from "../SettingSection";
import { BooleanSetting, ModalSetting } from "../Inputs";
import { ModalProps } from "react-bootstrap";
import { useSettings } from "../context";

interface IProps {
    modalProps?: ModalProps;
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
                    <Form.Control
                        as="textarea"
                        value={value}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                            setValue(e.currentTarget.value)
                        }
                        rows={16}
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
