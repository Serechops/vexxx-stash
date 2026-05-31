import React from "react";
import { Alert } from "@mui/material";
import { LoadingIndicator } from "../../Shared/LoadingIndicator";
import { StashBoxSetting } from "../StashBoxConfiguration";
import { useSettings } from "../context";

interface IProps {
    modalProps?: any;
}

export const StashBoxSettings: React.FC<IProps> = ({ modalProps }) => {
    const { general, loading, error, saveGeneral } = useSettings();

    if (error) return <Alert severity="error">{error.message}</Alert>;
    if (loading) return <LoadingIndicator />;

    return (
        <StashBoxSetting
            value={general.stashBoxes ?? []}
            onChange={(v) => saveGeneral({ stashBoxes: v })}
            modalProps={modalProps}
        />
    );
};
