import React, { useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useRecommendScenesQuery, useDismissRecommendationMutation, RecommendationSource, ScrapedSceneDataFragment, SlimSceneDataFragment } from '../../core/generated-graphql';
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
    excludeIds?: string[];
    onShownIds?: (ids: string[]) => void;
}

export const RecommendationCarousel: React.FC<RecommendationCarouselProps> = ({
    source = RecommendationSource.Both,
    limit = 20,
    title = "Recommended For You",
    excludeOwned = true,
    tagWeight,
    performerWeight,
    studioWeight,
    excludeIds,
    onShownIds,
}) => {
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    const [dismissMutation] = useDismissRecommendationMutation();

    const { data, loading, error } = useRecommendScenesQuery({
        variables: {
            options: {
                limit,
                source,
                exclude_owned: excludeOwned,
                tag_weight: tagWeight,
                performer_weight: performerWeight,
                studio_weight: studioWeight,
                exclude_ids: excludeIds,
            }
        }
    });

    // Must be before any early returns (Rules of Hooks)
    React.useEffect(() => {
        if (data?.recommendScenes && onShownIds) {
            const ids = data.recommendScenes.map(r =>
                r.stash_db_id ? `stashdb:${r.stash_db_id}` : `local:${r.id}`
            );
            onShownIds(ids);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    const handleDismiss = (entityKey: string, id: string) => {
        setDismissed(prev => new Set([...prev, id]));
        dismissMutation({ variables: { entity_type: 'scene', entity_key: entityKey } }).catch(() => {});
    };

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

    const recommendations = (data?.recommendScenes || []).filter(r => !dismissed.has(r.id));

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
                    const entityKey = r.stash_db_id ? `stashdb:${r.stash_db_id}` : `local:${r.id}`;

                    const Badge = () => (
                        <Box
                            sx={{
                                alignItems: 'center',
                                bgcolor: '#18181b',
                                borderLeft: '4px solid',
                                borderColor: badgeColor,
                                borderRadius: '4px',
                                boxShadow: 1,
                                display: 'flex',
                                justifyContent: 'space-between',
                                mb: '0.5rem',
                                p: '4px 8px',
                            }}
                        >
                            <Box sx={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', lineHeight: 1 }}>
                                    {scorePct}% Match
                                </Typography>
                                {r.reason && (
                                    <Typography variant="caption" sx={{ fontSize: '0.7rem', mt: '0.25rem', maxWidth: '100%', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {r.reason}
                                    </Typography>
                                )}
                            </Box>
                            <Tooltip title="Hide this">
                                <IconButton
                                    size="small"
                                    onClick={() => handleDismiss(entityKey, r.id)}
                                    sx={{ color: 'text.secondary', ml: 1, p: '2px', '&:hover': { color: 'error.main' } }}
                                >
                                    <CloseIcon sx={{ fontSize: '0.9rem' }} />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    );

                    if (r.type === 'scene' && r.scene) {
                        return (
                            <Box key={r.id} sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                <Badge />
                                <Box sx={{ flexGrow: 1, position: 'relative' }}>
                                    <SceneCard scene={r.scene} />
                                </Box>
                            </Box>
                        );
                    }
                    if (r.type === 'stashdb_scene' && r.stash_db_scene) {
                        const scene = r.stash_db_scene;
                        const slimScene = scrapedToSlim(scene);

                        return (
                            <Box key={r.stash_db_id || r.id} sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                <Badge />
                                <Box sx={{ flexGrow: 1, position: 'relative' }}>
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
