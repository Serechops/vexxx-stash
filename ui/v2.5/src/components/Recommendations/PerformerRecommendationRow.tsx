import React, { useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined';
import { useRecommendPerformersQuery, useDismissRecommendationMutation, useLikeRecommendationMutation, useUnlikeRecommendationMutation, RecommendationSource, PerformerDataFragment } from '../../core/generated-graphql';
import { LoadingIndicator } from '../Shared/LoadingIndicator';
import { PerformerCardSkeleton } from '../Shared/Skeletons/PerformerCardSkeleton';
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
    excludeIds?: string[];
    onShownIds?: (ids: string[]) => void;
}

export const PerformerRecommendationRow: React.FC<PerformerRecommendationRowProps> = ({
    limit = 20,
    title = "Top Performers For You",
    tagWeight,
    performerWeight,
    studioWeight,
    source = RecommendationSource.Both,
    excludeIds,
    onShownIds,
}) => {
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    const [liked, setLiked] = useState<Set<string>>(new Set());
    const [dismissMutation] = useDismissRecommendationMutation();
    const [likeMutation] = useLikeRecommendationMutation();
    const [unlikeMutation] = useUnlikeRecommendationMutation();

    const { data, loading, error } = useRecommendPerformersQuery({
        variables: {
            options: {
                limit,
                source,
                tag_weight: tagWeight,
                performer_weight: performerWeight,
                studio_weight: studioWeight,
                exclude_ids: excludeIds,
            }
        },
        fetchPolicy: "network-only"
    });

    const allRecommendations = data?.recommendPerformers || [];

    // Must be before any early returns (Rules of Hooks)
    React.useEffect(() => {
        if (allRecommendations.length > 0 && onShownIds) {
            const ids = allRecommendations.map(r =>
                r.stash_db_performer ? `stashdb:${r.id}` : `local:${r.id}`
            );
            onShownIds(ids);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    const handleDismiss = (entityKey: string, id: string) => {
        setDismissed(prev => new Set([...prev, id]));
        dismissMutation({ variables: { entity_type: 'performer', entity_key: entityKey } }).catch(() => {});
    };

    const handleLike = (entityKey: string, id: string) => {
        const isLiked = liked.has(id);
        setLiked(prev => {
            const next = new Set(prev);
            if (isLiked) next.delete(id); else next.add(id);
            return next;
        });
        if (isLiked) {
            unlikeMutation({ variables: { entity_type: 'performer', entity_key: entityKey } }).catch(() => {});
        } else {
            likeMutation({ variables: { entity_type: 'performer', entity_key: entityKey } }).catch(() => {});
        }
    };

    if (loading) {
        return (
            <RecommendationRow
                header={title}
                link={<></>}
                className="performer-recommendations"
            >
                <Carousel itemWidth={280} gap={16}>
                    {[...Array(6)].map((_, i) => (
                        <PerformerCardSkeleton key={i} />
                    ))}
                </Carousel>
            </RecommendationRow>
        );
    }
    if (error) {
        console.error("PerformerRecommendationRow Error:", error);
        return <Alert text={error.message} show onConfirm={() => { }} onCancel={() => { }} />;
    }

    const recommendations = allRecommendations.filter(r => !dismissed.has(r.id));

    if (recommendations.length === 0) {
        return (
            <Box className="performer-recommendation-row" sx={{ mb: '3rem', mt: '2rem' }}>
                <Typography variant="h5" sx={{ fontWeight: 'bold', mb: '1rem', ml: '1rem' }}>{title}</Typography>
                <Box sx={{ bgcolor: '#18181b', borderRadius: '8px', m: '1rem', p: '2rem', textAlign: 'center' }}>
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
                        const entityKey = r.stash_db_performer ? `stashdb:${r.id}` : `local:${r.id}`;

                        const isLiked = liked.has(r.id);
                        return (
                            <Box key={r.id} sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                                            <Tooltip title={r.reason} placement="top">
                                                <Typography variant="caption" sx={{ fontSize: '0.7rem', mt: '0.25rem', maxWidth: '100%', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {r.reason}
                                                </Typography>
                                            </Tooltip>
                                        )}
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                        <Tooltip title={isLiked ? "Unlike" : "Like this"}>
                                            <IconButton
                                                size="small"
                                                onClick={() => handleLike(entityKey, r.id)}
                                                sx={{ color: isLiked ? 'success.main' : 'text.secondary', p: '2px', '&:hover': { color: 'success.main' } }}
                                            >
                                                {isLiked
                                                    ? <ThumbUpIcon sx={{ fontSize: '0.9rem' }} />
                                                    : <ThumbUpOutlinedIcon sx={{ fontSize: '0.9rem' }} />}
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Hide this">
                                            <IconButton
                                                size="small"
                                                onClick={() => handleDismiss(entityKey, r.id)}
                                                sx={{ color: 'text.secondary', ml: 0.5, p: '2px', '&:hover': { color: 'error.main' } }}
                                            >
                                                <CloseIcon sx={{ fontSize: '0.9rem' }} />
                                            </IconButton>
                                        </Tooltip>
                                    </Box>
                                </Box>

                                <Box sx={{ flexGrow: 1, position: 'relative' }}>
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
