import React from 'react';
import { Box, Typography } from '@mui/material';
import { useSimilarScenesQuery } from '../../core/generated-graphql';
import { LoadingIndicator } from '../Shared/LoadingIndicator';
import { AlertModal as Alert } from '../Shared/Alert';
import { SceneCard } from '../Scenes/SceneCard';
import Carousel from '../Shared/Carousel';

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
        return null; // Don't show if no similar scenes
    }

    return (
        <Box className="similar-scenes-panel similar-items-panel">
            <Typography variant="h5" className="similar-items-header">Similar Scenes</Typography>
            <Carousel>
                {recommendations.map((r) => {
                    if (r.scene) {
                        return (
                            <Box key={r.id} className="similar-items-card-wrapper">
                                <SceneCard scene={r.scene} />
                            </Box>
                        );
                    }
                    return null;
                })}
            </Carousel>
        </Box>
    );
};
