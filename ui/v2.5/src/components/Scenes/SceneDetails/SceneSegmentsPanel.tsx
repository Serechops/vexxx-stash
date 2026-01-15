import React, { useState, useMemo } from "react";
import { Button, Box } from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { CreateSceneSegmentDialog } from "../../CreateSceneSegmentDialog";
import { Link } from "react-router-dom";
import { Icon } from "src/components/Shared/Icon";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import TextUtils from "src/utils/text";

interface IProps {
    scene: GQL.SceneDataFragment;
}

export const SceneSegmentsPanel: React.FC<IProps> = ({ scene }) => {
    const intl = useIntl();
    const [showCreateDialog, setShowCreateDialog] = useState(false);

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
                <h3>Segments</h3>
                <Button onClick={() => setShowCreateDialog(true)} variant="contained">
                    <Icon icon={faPlus} className="mr-2" />
                    <FormattedMessage id="actions.create" />
                </Button>
            </div>

            {/* Placeholder for list of segments */}
            {/* 
        To list segments, we would need to fetch all scenes that share the same file_id 
        This might require a new GQL query or updating the current scene query to include 'siblings'
      */}

            {showCreateDialog && (
                <CreateSceneSegmentDialog
                    fileId={file.id}
                    fileDuration={file.duration}
                    onClose={() => setShowCreateDialog(false)}
                    onSuccess={(id) => {
                        setShowCreateDialog(false);
                        // Redirect or refresh?
                        window.location.reload();
                    }}
                />
            )}
        </div>
    );
};
