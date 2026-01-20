import React, { useContext, useMemo, useState } from "react";
import {
    Button,
    Paper,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Chip,
    Typography,
    Box,
    Stack,
} from "@mui/material";
import { Link } from "react-router-dom";
import { FormattedMessage } from "react-intl";
import { TaggerStateContext, ITaggerHistoryEntry } from "../context";
import { Icon } from "src/components/Shared/Icon";
import { faTag, faUser, faBuilding, faFilm, faTrash, faChevronDown } from "@fortawesome/free-solid-svg-icons";

interface ITaggerReviewProps {
    show: boolean;
    onClose: () => void;
}

interface ISceneGroup {
    sceneId: string;
    sceneTitle: string;
    timestamp: Date;
    tags: { name: string; id: string; isNew: boolean }[];
    performers: { name: string; id: string; isNew: boolean }[];
    studio?: { name: string; id: string; isNew: boolean };
}

const EntityBadge: React.FC<{ isNew: boolean }> = ({ isNew }) => (
    <Chip
        size="small"
        color={isNew ? "success" : "info"}
        label={isNew ? "new" : "updated"}
        className="review-badge"
    />
);

const SceneCard: React.FC<{ group: ISceneGroup; defaultExpanded?: boolean }> = ({ group, defaultExpanded }) => {
    const formatTime = (date: Date) => {
        return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const hasMetadata = group.tags.length > 0 || group.performers.length > 0 || group.studio;

    return (
        <Accordion defaultExpanded={defaultExpanded} className="tagger-review-section">
            <AccordionSummary
                expandIcon={<Icon icon={faChevronDown} />}
                className="review-summary"
            >
                <Stack direction="row" alignItems="center" spacing={1} className="review-header-stack">
                    <Icon icon={faFilm} />
                    <Link to={`/scenes/${group.sceneId}`} className="tagger-review-entry-name" onClick={(e) => e.stopPropagation()}>
                        {group.sceneTitle}
                    </Link>
                    <Typography variant="caption" color="textSecondary" className="review-timestamp">
                        {formatTime(group.timestamp)}
                    </Typography>
                </Stack>
            </AccordionSummary>
            <AccordionDetails className="tagger-review-scene-body">
                {!hasMetadata ? (
                    <Typography variant="body2" color="textSecondary">Scene saved with no new metadata</Typography>
                ) : (
                    <Stack spacing={1}>
                        {/* Studio */}
                        {group.studio && (
                            <Stack direction="row" alignItems="center" spacing={1} className="tagger-review-metadata-row">
                                <Icon icon={faBuilding} />
                                <Typography variant="body2" color="textSecondary">Studio:</Typography>
                                <Link to={`/studios/${group.studio.id}`} className="tagger-review-entity-link">
                                    {group.studio.name}
                                </Link>
                                <EntityBadge isNew={group.studio.isNew} />
                            </Stack>
                        )}

                        {/* Performers */}
                        {group.performers.length > 0 && (
                            <Stack direction="row" alignItems="flex-start" spacing={1} className="tagger-review-metadata-row">
                                <Icon icon={faUser} />
                                <Typography variant="body2" color="textSecondary">Performers:</Typography>
                                <Box className="tagger-review-entity-list">
                                    {group.performers.map((p, i) => (
                                        <span key={p.id} className="tagger-review-entity-item">
                                            <Link to={`/performers/${p.id}`} className="tagger-review-entity-link">
                                                {p.name}
                                            </Link>
                                            <EntityBadge isNew={p.isNew} />
                                            {i < group.performers.length - 1 && <span className="mx-1">,</span>}
                                        </span>
                                    ))}
                                </Box>
                            </Stack>
                        )}

                        {/* Tags */}
                        {group.tags.length > 0 && (
                            <Stack direction="row" alignItems="flex-start" spacing={1} className="tagger-review-metadata-row">
                                <Icon icon={faTag} />
                                <Typography variant="body2" color="textSecondary">Tags:</Typography>
                                <Box className="tagger-review-entity-list">
                                    {group.tags.map((t, i) => (
                                        <span key={t.id} className="tagger-review-entity-item">
                                            <Link to={`/tags/${t.id}`} className="tagger-review-entity-link">
                                                {t.name}
                                            </Link>
                                            <EntityBadge isNew={t.isNew} />
                                            {i < group.tags.length - 1 && <span className="mx-1">,</span>}
                                        </span>
                                    ))}
                                </Box>
                            </Stack>
                        )}
                    </Stack>
                )}
            </AccordionDetails>
        </Accordion>
    );
};

export const TaggerReview: React.FC<ITaggerReviewProps> = ({ show, onClose }) => {
    const { taggerHistory, clearTaggerHistory } = useContext(TaggerStateContext);

    // Group history by scene
    const sceneGroups = useMemo(() => {
        const groups = new Map<string, ISceneGroup>();

        // First, create groups for all saved scenes
        taggerHistory
            .filter(e => e.type === 'scene')
            .forEach(entry => {
                groups.set(entry.entityId, {
                    sceneId: entry.entityId,
                    sceneTitle: entry.name,
                    timestamp: entry.timestamp,
                    tags: [],
                    performers: [],
                    studio: undefined,
                });
            });

        // Then, add metadata to the scenes
        taggerHistory.forEach(entry => {
            if (entry.type === 'scene') return;

            const isNew = entry.action === 'created';

            // Add to all associated scenes
            entry.associatedSceneIds?.forEach((sceneId, index) => {
                let group = groups.get(sceneId);

                // If scene wasn't explicitly saved but has metadata, create a group
                if (!group) {
                    group = {
                        sceneId,
                        sceneTitle: entry.associatedSceneTitles?.[index] ?? `Scene ${sceneId}`,
                        timestamp: entry.timestamp,
                        tags: [],
                        performers: [],
                        studio: undefined,
                    };
                    groups.set(sceneId, group);
                }

                switch (entry.type) {
                    case 'tag':
                        if (!group.tags.some(t => t.id === entry.entityId)) {
                            group.tags.push({ name: entry.name, id: entry.entityId, isNew });
                        }
                        break;
                    case 'performer':
                        if (!group.performers.some(p => p.id === entry.entityId)) {
                            group.performers.push({ name: entry.name, id: entry.entityId, isNew });
                        }
                        break;
                    case 'studio':
                        if (!group.studio) {
                            group.studio = { name: entry.name, id: entry.entityId, isNew };
                        }
                        break;
                }
            });
        });

        // Sort by timestamp (newest first)
        return Array.from(groups.values()).sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
    }, [taggerHistory]);

    if (!show) return null;

    const hasHistory = sceneGroups.length > 0;

    // Count totals
    const totalTags = new Set(taggerHistory.filter(e => e.type === 'tag').map(e => e.entityId)).size;
    const totalPerformers = new Set(taggerHistory.filter(e => e.type === 'performer').map(e => e.entityId)).size;
    const totalStudios = new Set(taggerHistory.filter(e => e.type === 'studio').map(e => e.entityId)).size;

    return (
        <Box className="tagger-review">
            <Stack direction="row" justifyContent="space-between" alignItems="center" className="tagger-review-header" mb={2}>
                <Typography variant="h6">
                    <Icon icon={faFilm} className="mr-2" />
                    Scenes Saved
                    <Chip size="small" label={sceneGroups.length} sx={{ ml: 1 }} />
                </Typography>
                <Stack direction="row" spacing={1} className="tagger-review-actions">
                    {hasHistory && (
                        <Button
                            variant="outlined"
                            color="error"
                            size="small"
                            onClick={clearTaggerHistory}
                            startIcon={<Icon icon={faTrash} />}
                        >
                            Clear
                        </Button>
                    )}
                    <Button variant="outlined" size="small" onClick={onClose}>
                        Close
                    </Button>
                </Stack>
            </Stack>

            {!hasHistory ? (
                <Box className="tagger-review-empty">
                    <Typography variant="body2" color="textSecondary" textAlign="center" py={4}>
                        No tagging operations recorded yet. Use the bulk operations to save scenes.
                    </Typography>
                </Box>
            ) : (
                <Box className="tagger-review-accordion">
                    {sceneGroups.map((group, index) => (
                        <SceneCard key={group.sceneId} group={group} defaultExpanded={index === 0} />
                    ))}
                </Box>
            )}

            {hasHistory && (
                <Box className="tagger-review-summary" mt={3}>
                    <Typography variant="caption" color="textSecondary">
                        {sceneGroups.length} scene{sceneGroups.length !== 1 ? 's' : ''} |
                        {totalTags} tag{totalTags !== 1 ? 's' : ''} |
                        {totalPerformers} performer{totalPerformers !== 1 ? 's' : ''} |
                        {totalStudios} studio{totalStudios !== 1 ? 's' : ''}
                    </Typography>
                </Box>
            )}
        </Box>
    );
};

export default TaggerReview;
