import React from "react";
import { TextField, FormHelperText } from "@mui/material";
import { useIntl } from "react-intl";
import { SettingSection } from "../SettingSection";
import { BooleanSetting, ModalSetting } from "../Inputs";
import { useSettings } from "../context";

export const CustomLocalesSettings: React.FC = () => {
    const intl = useIntl();
    const { interface: iface, saveInterface } = useSettings();

    function validateLocaleString(v: string) {
        if (!v) return;
        try {
            JSON.parse(v);
        } catch (e) {
            throw new Error(
                intl.formatMessage(
                    { id: "errors.invalid_json_string" },
                    {
                        error: (e as SyntaxError).message,
                    }
                )
            );
        }
    }

    return (
        <SettingSection headingID="config.ui.custom_locales.heading">
            <BooleanSetting
                id="custom-locales-enabled"
                headingID="config.ui.custom_locales.option_label"
                checked={iface.customLocalesEnabled ?? undefined}
                onChange={(v) => saveInterface({ customLocalesEnabled: v })}
            />

            <ModalSetting<string>
                id="custom-locales"
                headingID="config.ui.custom_locales.heading"
                subHeadingID="config.ui.custom_locales.description"
                value={iface.customLocales ?? undefined}
                onChange={(v) => saveInterface({ customLocales: v })}
                validateChange={validateLocaleString}
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
