import React from 'react';
import { Box, Typography } from '@mui/material';
import { useRecommendScenesQuery, RecommendationSource, ScrapedSceneDataFragment, SlimSceneDataFragment } from '../../core/generated-graphql';
import { LoadingIndicator } from '../Shared/LoadingIndicator';
import { SceneCardSkeleton } from '../Shared/Skeletons/SceneCardSkeleton';
import { AlertModal as Alert } from '../Shared/Alert';
import { SceneCard } from '../Scenes/SceneCard';
import Carousel from '../Shared/Carousel';
import { RecommendationRow } from '../FrontPage/RecommendationRow';

function scrapedToSlim(scraped: ScrapedSceneDataFragment, trailerUrl?: string): SlimSceneDataFragment {
    return {
        id: scraped.remote_site_id || scraped.title || "temp-id",
        title: scraped.title,
        details: scraped.details,
        url: scraped.urls?.[0],
        date: scraped.date,
        rating100: null,
        o_counter: null,
        organized: false,
        interactive: false,
        interactive_speed: null,
        resume_time: null,
        play_duration: null,
        files: [],
        paths: {
            screenshot: scraped.image,
            preview: trailerUrl || null,
            stream: null,
            vtt: null,
            chapters_vtt: null,
            sprite: null,
            funscript: null,
            interactive_heatmap: null,
            caption: null,
        },
        scene_markers: [],
        galleries: [],
        studio: scraped.studio ? {
            id: scraped.studio.stored_id || scraped.studio.remote_site_id || "studio-id",
            name: scraped.studio.name,
            image_path: scraped.studio.image,
            parent_studio: null,
        } : null,
        movies: [],
        performers: scraped.performers ? scraped.performers.map(p => ({
            id: p.stored_id || p.name,
            name: p.name,
            gender: p.gender,
            image_path: p.images?.[0] || null,
            favorite: false,
        })) : [],
        tags: scraped.tags ? scraped.tags.map(t => ({
            id: t.stored_id || t.name,
            name: t.name,
        })) : [],
        stash_ids: [],
    } as unknown as SlimSceneDataFragment;
}

interface RecommendationCarouselProps {
    source?: RecommendationSource;
    limit?: number;
    title?: string;
    excludeOwned?: boolean;
    tagWeight?: number;
    performerWeight?: number;
    studioWeight?: number;
}

export const RecommendationCarousel: React.FC<RecommendationCarouselProps> = ({
    source = RecommendationSource.Both,
    limit = 20,
    title = "Recommended For You",
    excludeOwned = true,
    tagWeight,
    performerWeight,
    studioWeight,
}) => {
    const { data, loading, error } = useRecommendScenesQuery({
        variables: {
            options: {
                limit,
                source,
                exclude_owned: excludeOwned,
                tag_weight: tagWeight,
                performer_weight: performerWeight,
                studio_weight: studioWeight,
            }
        }
    });

    if (loading) {
        return (
            <RecommendationRow
                header={title}
                link={<></>}
                className="scene-recommendations"
            >
                <Carousel itemWidth={320} gap={16}>
                    {[...Array(4)].map((_, i) => (
                        <SceneCardSkeleton key={i} />
                    ))}
                </Carousel>
            </RecommendationRow>
        );
    }
    if (error) return <Alert text={error.message} show onConfirm={() => { }} onCancel={() => { }} />;

    const recommendations = data?.recommendScenes || [];

    if (recommendations.length === 0) {
        return null;
    }

    return (
        <RecommendationRow
            header={title}
            link={<></>}
            className="scene-recommendations"
        >
            <Carousel itemWidth={320} gap={16}>
                {recommendations.map((r, idx) => {
                    // Calculate Score Badge Color
                    const scorePct = Math.round(r.score * 100);
                    const badgeColor = scorePct > 80 ? "success.main" : scorePct > 50 ? "warning.main" : "info.main";

                    const Badge = () => (
                        <Box
                            className="recommendation-badge-container"
                            sx={{ borderColor: badgeColor }}
                        >
                            <Box className="recommendation-badge-header">
                                <Typography variant="subtitle2" className="recommendation-badge-score">
                                    {scorePct}% Match
                                </Typography>
                            </Box>
                            {r.reason && (
                                <Typography variant="caption" className="recommendation-badge-reason">
                                    {r.reason}
                                </Typography>
                            )}
                        </Box>
                    );

                    if (r.type === 'scene' && r.scene) {
                        return (
                            <Box key={r.id} className="recommendation-item-wrapper">
                                <Badge />
                                <Box className="recommendation-item-content">
                                    <SceneCard scene={r.scene} />
                                </Box>
                            </Box>
                        );
                    }
                    if (r.type === 'stashdb_scene' && r.stash_db_scene) {
                        const scene = r.stash_db_scene;
                        const slimScene = scrapedToSlim(scene);

                        return (
                            <Box key={r.stash_db_id || r.id} className="recommendation-item-wrapper">
                                <Badge />
                                <Box className="recommendation-item-content">
                                    <SceneCard
                                        scene={slimScene}
                                        link={scene.urls?.[0] || undefined}
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
