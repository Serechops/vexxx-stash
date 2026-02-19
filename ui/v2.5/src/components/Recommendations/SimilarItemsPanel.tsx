import React from 'react';
import { Box } from '@mui/material';
import { useSimilarScenesQuery } from '../../core/generated-graphql';
import { LoadingIndicator } from '../Shared/LoadingIndicator';
import { AlertModal as Alert } from '../Shared/Alert';
import { SceneCard } from '../Scenes/SceneCard';

interface SimilarScenesPanelProps {
    sceneId: string;
}

export const SimilarScenesPanel: React.FC<SimilarScenesPanelProps> = ({ sceneId }) => {
    const { data, loading, error } = useSimilarScenesQuery({
        variables: { scene_id: sceneId }
    });

    if (loading) return <LoadingIndicator />;
    if (error) return <Alert text={error.message} show onConfirm={() => { }} onCancel={() => { }} />;

    const recommendations = data?.similarScenes || [];

    if (recommendations.length === 0) {
        return null;
    }

    return (
        <Box
            className="similar-scenes-panel"
            sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                mt: 1,
            }}
        >
            {recommendations.map((r) => {
                if (r.scene) {
                    return (
                        <Box key={r.id}>
                            <SceneCard scene={r.scene} />
                        </Box>
                    );
                }
                return null;
            })}
        </Box>
    );
};
