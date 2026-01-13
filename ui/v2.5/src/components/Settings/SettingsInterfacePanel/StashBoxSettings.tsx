import React from "react";
import { ModalProps } from "react-bootstrap";
import { LoadingIndicator } from "../../Shared/LoadingIndicator";
import { StashBoxSetting } from "../StashBoxConfiguration";
import { useSettings } from "../context";

interface IProps {
    modalProps?: ModalProps;
}

export const StashBoxSettings: React.FC<IProps> = ({ modalProps }) => {
    const { general, loading, error, saveGeneral } = useSettings();

    if (error) return <h1>{error.message}</h1>;
    if (loading) return <LoadingIndicator />;

    return (
        <>
            <StashBoxSetting
                value={general.stashBoxes ?? []}
                onChange={(v) => saveGeneral({ stashBoxes: v })}
                modalProps={modalProps}
            />
        </>
    );
};
