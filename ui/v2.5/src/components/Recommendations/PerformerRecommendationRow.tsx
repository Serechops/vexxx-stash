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
    source?: RecommendationSource;
}

export const PerformerRecommendationRow: React.FC<PerformerRecommendationRowProps> = ({
    limit = 20,
    title = "Top Performers For You",
    tagWeight,
    performerWeight,
    studioWeight,
    source = RecommendationSource.Both,
}) => {
    const { data, loading, error } = useRecommendPerformersQuery({
        variables: {
            options: {
                limit,
                source,
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

    const recommendations = data?.recommendPerformers || [];

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
                        // Badge Styling (Copied from RecommendationCarousel)
                        const scorePct = Math.round(r.score * 100);
                        const badgeColor = scorePct > 80 ? "success.main" : scorePct > 50 ? "warning.main" : "info.main";

                        return (
                            <Box key={r.id} sx={{ height: "100%", p: 1, display: "flex", flexDirection: "column" }}>
                                <Box
                                    sx={{
                                        mb: 1,
                                        padding: "4px 8px",
                                        borderRadius: "4px",
                                        backgroundColor: "background.paper",
                                        borderLeft: "4px solid",
                                        borderColor: badgeColor,
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "flex-start",
                                        boxShadow: 1
                                    }}
                                >
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                        <Typography variant="subtitle2" sx={{ fontWeight: "bold", lineHeight: 1 }}>
                                            {scorePct}% Match
                                        </Typography>
                                    </Box>
                                    <Typography variant="caption" sx={{ fontSize: "0.7rem", opacity: 0.7, mt: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                                        {r.reason}
                                    </Typography>
                                </Box>


                                <Box sx={{ flexGrow: 1 }}>
                                    <PerformerCard
                                        performer={perf}
                                        link={r.stash_db_performer ? `https://stashdb.org/performers/${r.id}` : undefined}
                                    />
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
