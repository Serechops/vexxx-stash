import React, { useState, useMemo } from "react";
import { Button, Box, Typography } from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { CreateSceneSegmentPanel } from "./CreateSceneSegmentPanel";
import { Link } from "react-router-dom";
import AddIcon from "@mui/icons-material/Add";
import TextUtils from "src/utils/text";

interface IProps {
    scene: GQL.SceneDataFragment;
}

export const SceneSegmentsPanel: React.FC<IProps> = ({ scene }) => {
    const intl = useIntl();
    const [showCreatePanel, setShowCreatePanel] = useState(true);

    // TODO: we need a way to fetch siblings (other scenes sharing the same file)
    // For now, we only show the creation button.
    // Ideally, the parent component or a new query would provide related scenes.

    const file = scene.files?.[0];

    if (!file) {
        return <div>No video file associated with this scene.</div>;
    }

    return (
        <div className="scene-segments-panel">
            <div className="d-flex justify-content-between align-items-center mb-3">
                <Typography variant="h5">Segments</Typography>
            </div>

            {showCreatePanel && (
                <CreateSceneSegmentPanel
                    fileId={file.id}
                    fileDuration={file.duration}
                    onSuccess={(id) => {
                        // Redirect or refresh?
                        window.location.reload();
                    }}
                />
            )}

            {/* Placeholder for list of segments */}
            {/* 
        To list segments, we would need to fetch all scenes that share the same file_id 
        This might require a new GQL query or updating the current scene query to include 'siblings'
      */}
        </div>
    );
};
