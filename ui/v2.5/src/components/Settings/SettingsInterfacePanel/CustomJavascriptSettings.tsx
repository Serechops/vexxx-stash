import React from "react";
import { TextField, FormHelperText } from "@mui/material";
import { useIntl } from "react-intl";
import { SettingSection } from "../SettingSection";
import { BooleanSetting, ModalSetting } from "../Inputs";

import { useSettings } from "../context";

interface IProps {
    modalProps?: any;
}

export const CustomJavascriptSettings: React.FC<IProps> = ({ modalProps }) => {
    const intl = useIntl();
    const { interface: iface, saveInterface } = useSettings();

    function validateJavascriptString(v: string) {
        if (!v) return;
        try {
            // creates a function from the string to validate it but does not execute it
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            new Function(v);
        } catch (e) {
            throw new Error(
                intl.formatMessage(
                    { id: "errors.invalid_javascript_string" },
                    {
                        error: (e as SyntaxError).message,
                    }
                )
            );
        }
    }

    return (
        <SettingSection headingID="config.ui.custom_javascript.heading">
            <BooleanSetting
                id="custom-javascript-enabled"
                headingID="config.ui.custom_javascript.option_label"
                checked={iface.javascriptEnabled ?? undefined}
                onChange={(v) => saveInterface({ javascriptEnabled: v })}
            />

            <ModalSetting<string>
                id="custom-javascript"
                headingID="config.ui.custom_javascript.heading"
                subHeadingID="config.ui.custom_javascript.description"
                value={iface.javascript ?? undefined}
                onChange={(v) => saveInterface({ javascript: v })}
                validateChange={validateJavascriptString}
                modalProps={modalProps}
                renderField={(value, setValue, err) => (
                    <>
                        <TextField
                            multiline
                            fullWidth
                            variant="outlined"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            minRows={16}
                            className="text-input code"
                            error={!!err}
                        />
                        <FormHelperText error>
                            {err}
                        </FormHelperText>
                    </>
                )}
                renderValue={() => {
                    return <></>;
                }}
            />
        </SettingSection>
    );
};
