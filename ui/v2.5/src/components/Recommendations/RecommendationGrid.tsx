import React, { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { useRecommendScenesQuery, RecommendationSource, ScrapedSceneDataFragment, SlimSceneDataFragment } from '../../core/generated-graphql';
import { LoadingIndicator } from '../Shared/LoadingIndicator';
import { AlertModal as Alert } from '../Shared/Alert';
import { SceneCardsGrid } from '../Scenes/SceneCardsGrid';
import { SceneQueue } from 'src/models/sceneQueue';

// Duplicated helper to convert StashDB scene to SlimScene format
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

interface RecommendationGridProps {
    source?: RecommendationSource;
    limit?: number;
    title?: string;
    excludeOwned?: boolean;
    tagWeight?: number;
    performerWeight?: number;
    studioWeight?: number;
}

export const RecommendationGrid: React.FC<RecommendationGridProps> = ({
    source = RecommendationSource.Both,
    limit = 60, // Higher default limit for grid
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
        },
        fetchPolicy: "network-only" // Ensure fresh variety on mount/update
    });

    const scenes = useMemo(() => {
        if (!data?.recommendScenes) return [];
        return data.recommendScenes.map(r => {
            if (r.type === 'scene' && r.scene) {
                return r.scene;
            }
            if (r.type === 'stashdb_scene' && r.stash_db_scene) {
                const s = scrapedToSlim(r.stash_db_scene);
                if (!s.id || s.id === "temp-id") {
                    s.id = r.id || `stashdb-${Math.random()}`;
                }
                return s;
            }
            return null;
        }).filter((s): s is SlimSceneDataFragment => s !== null);
    }, [data]);

    // Mock selection props since this is a read-only recommendation grid for now
    // Future: Allow selecting to add to queue/download
    const selectedIds = useMemo(() => new Set<string>(), []);
    const onSelectChange = () => { };

    // Create a queue for playback
    const queue = useMemo(() => {
        // Construct a queue from these scenes
        const q = new SceneQueue();
        // Manually populating might require full Scene data, but minimal works for simple nav
        return q;
    }, []);

    if (loading) return <LoadingIndicator />;
    if (error) return <Alert text={error.message} show onConfirm={() => { }} onCancel={() => { }} />;

    if (scenes.length === 0) {
        return (
            <Box sx={{ p: 3, textAlign: 'center', opacity: 0.6 }}>
                <Typography variant="body1">No recommendations found. Try adjusting the tuning.</Typography>
            </Box>
        );
    }

    return (
        <Box className="recommendation-grid" sx={{ mt: 4, mb: 4 }}>
            <Typography variant="h4" sx={{ mb: 3, ml: 2, fontWeight: 'bold' }}>{title}</Typography>
            <SceneCardsGrid
                scenes={scenes}
                queue={queue}
                selectedIds={selectedIds}
                onSelectChange={onSelectChange}
                zoomIndex={0} // Default zoom
                itemsPerPage={limit}
            />
        </Box>
    );
};
