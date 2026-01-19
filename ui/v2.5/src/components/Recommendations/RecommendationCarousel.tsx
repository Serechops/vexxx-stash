import React from 'react';
import { Box, Typography } from '@mui/material';
import { useRecommendScenesQuery, RecommendationSource, ScrapedSceneDataFragment, SlimSceneDataFragment } from '../../core/generated-graphql';
import { LoadingIndicator } from '../Shared/LoadingIndicator';
import { AlertModal as Alert } from '../Shared/Alert';
import { SceneCard } from '../Scenes/SceneCard';
import Carousel from '../Shared/Carousel';

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

    if (loading) return <LoadingIndicator />;
    if (error) return <Alert text={error.message} show onConfirm={() => { }} onCancel={() => { }} />;

    const recommendations = data?.recommendScenes || [];

    if (recommendations.length === 0) {
        return null;
    }

    return (
        <Box className="recommendation-carousel" sx={{ mt: 4, mb: 4 }}>
            <Typography variant="h5" sx={{ mb: 2, ml: 2 }}>{title}</Typography>
            <Carousel>
                {recommendations.map((r, idx) => {
                    if (r.type === 'scene' && r.scene) {
                        return (
                            <Box key={r.id} sx={{ height: "100%" }}>
                                <SceneCard scene={r.scene} />
                            </Box>
                        );
                    }
                    if (r.type === 'stashdb_scene' && r.stash_db_scene) {
                        const scene = r.stash_db_scene;
                        const slimScene = scrapedToSlim(scene);

                        return (
                            <Box key={r.stash_db_id || r.id} sx={{ height: "100%" }}>
                                <SceneCard
                                    scene={slimScene}
                                    link={scene.urls?.[0] || undefined}
                                />
                            </Box>
                        );
                    }
                    return null;
                })}
            </Carousel>
        </Box>
    );
};
