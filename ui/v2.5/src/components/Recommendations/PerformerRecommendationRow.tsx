import React from 'react';
import { Box, Typography } from '@mui/material';
import { useRecommendPerformersQuery, RecommendationSource, PerformerDataFragment } from '../../core/generated-graphql';
import { LoadingIndicator } from '../Shared/LoadingIndicator';
import { AlertModal as Alert } from '../Shared/Alert';
import { PerformerCard } from '../Performers/PerformerCard';
import Carousel from '../Shared/Carousel';

interface PerformerRecommendationRowProps {
    limit?: number;
    title?: string;
    tagWeight?: number;
    performerWeight?: number;
    studioWeight?: number;
}

export const PerformerRecommendationRow: React.FC<PerformerRecommendationRowProps> = ({
    limit = 20,
    title = "Top Performers For You",
    tagWeight,
    performerWeight,
    studioWeight,
}) => {
    const { data, loading, error } = useRecommendPerformersQuery({
        variables: {
            options: {
                limit,
                // Default to BOTH to include StashDB discovery
                source: RecommendationSource.Both,
                tag_weight: tagWeight,
                performer_weight: performerWeight,
                studio_weight: studioWeight,
            }
        },
        fetchPolicy: "network-only"
    });

    if (loading) return <LoadingIndicator />;
    if (error) {
        console.error("PerformerRecommendationRow Error:", error);
        return <Alert text={error.message} show onConfirm={() => { }} onCancel={() => { }} />;
    }

    console.log("PerformerRecommendationRow Data:", data);
    const recommendations = data?.recommendPerformers || [];
    console.log("Performer Recommendations Array:", recommendations);

    if (recommendations.length === 0) {
        return (
            <Box className="performer-recommendation-row" sx={{ mt: 4, mb: 6 }}>
                <Typography variant="h5" sx={{ mb: 2, ml: 2, fontWeight: 'bold' }}>{title}</Typography>
                <Box sx={{ p: 4, textAlign: "center", bgcolor: "background.paper", borderRadius: 2, m: 2 }}>
                    <Typography color="text.secondary">
                        No top performers found based on your history. Try rating more content or rebuilding your profile!
                    </Typography>
                </Box>
            </Box>
        );
    }

    return (
        <Box className="performer-recommendation-row" sx={{ mt: 4, mb: 6 }}>
            <Typography variant="h5" sx={{ mb: 2, ml: 2, fontWeight: 'bold' }}>{title}</Typography>
            <Carousel>
                {recommendations.map((r, idx) => {
                    let perf: PerformerDataFragment | undefined;

                    if (r.performer) {
                        perf = r.performer as unknown as PerformerDataFragment;
                    } else if (r.stash_db_performer) {
                        // Map StashDB performer to PerformerDataFragment shape
                        const s = r.stash_db_performer;
                        perf = {
                            id: r.id, // Use the recommendation UUID
                            name: s.name || r.name,
                            image_path: s.images && s.images.length > 0 ? s.images[0] : undefined,
                            // Map other fields if needed for card display
                            gender: s.gender,
                            birthdate: s.birthdate,
                            ethnicity: s.ethnicity,
                            country: s.country,
                            eye_color: s.eye_color,
                            hair_color: s.hair_color,
                            height_cm: s.height,
                            // Defaults/Nulls for irrelevant fields
                            scene_count: 0,
                            image_count: 0,
                            gallery_count: 0,
                            favorite: false,
                            is_favorite: false,
                        } as unknown as PerformerDataFragment;
                    }

                    if (perf) {
                        return (
                            <Box key={r.id} sx={{ height: "100%", p: 1 }}>
                                <PerformerCard performer={perf} />
                                {/* Overlay Reason/Score if desired, layout similar to scenes? 
                                    For now just listing them is a huge win. */}
                                <Box sx={{ mt: 1, textAlign: 'center' }}>
                                    <Typography variant="caption" display="block" color="primary.main" fontWeight="bold">
                                        {(r.score * 100).toFixed(0)}% Match
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                        {r.reason}
                                    </Typography>
                                </Box>
                            </Box>
                        );
                    }
                    return null;
                })}
            </Carousel>
        </Box>
    );
};
