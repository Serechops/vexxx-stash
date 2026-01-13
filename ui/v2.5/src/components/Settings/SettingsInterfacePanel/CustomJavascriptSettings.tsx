import React from "react";
import { Form } from "react-bootstrap";
import { useIntl } from "react-intl";
import { SettingSection } from "../SettingSection";
import { BooleanSetting, ModalSetting } from "../Inputs";
import { ModalProps } from "react-bootstrap";
import { useSettings } from "../context";

interface IProps {
    modalProps?: ModalProps;
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
                        <Form.Control
                            as="textarea"
                            value={value}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                                setValue(e.currentTarget.value)
                            }
                            rows={16}
                            className="text-input code"
                            isInvalid={!!err}
                        />
                        <Form.Control.Feedback type="invalid">
                            {err}
                        </Form.Control.Feedback>
                    </>
                )}
                renderValue={() => {
                    return <></>;
                }}
            />
        </SettingSection>
    );
};
