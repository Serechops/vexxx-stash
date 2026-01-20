import React from 'react';
import { Box, Typography } from '@mui/material';
import { useRecommendPerformersQuery, RecommendationSource, PerformerDataFragment } from '../../core/generated-graphql';
import { LoadingIndicator } from '../Shared/LoadingIndicator';
import { AlertModal as Alert } from '../Shared/Alert';
import { PerformerCard } from '../Performers/PerformerCard';
import Carousel from '../Shared/Carousel';
import { RecommendationRow } from '../FrontPage/RecommendationRow';

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
            <Box className="performer-recommendation-row performer-recommendation-empty-container">
                <Typography variant="h5" className="performer-recommendation-empty-title">{title}</Typography>
                <Box className="performer-recommendation-empty-message">
                    <Typography color="text.secondary">
                        No top performers found based on your history. Try rating more content or rebuilding your profile!
                    </Typography>
                </Box>
            </Box>
        );
    }

    return (
        <RecommendationRow
            header={title}
            link={<></>}
            className="performer-recommendations"
        >
            <Carousel itemWidth={280} gap={16}>
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
                            <Box key={r.id} className="recommendation-item-wrapper">
                                <Box
                                    className="recommendation-badge-container"
                                    style={{ borderColor: badgeColor }}
                                >
                                    <Box className="recommendation-badge-header">
                                        <Typography variant="subtitle2" className="recommendation-badge-score">
                                            {scorePct}% Match
                                        </Typography>
                                    </Box>
                                    <Typography variant="caption" className="recommendation-badge-reason">
                                        {r.reason}
                                    </Typography>
                                </Box>


                                <Box className="recommendation-item-content">
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
        </RecommendationRow>
    );
};
