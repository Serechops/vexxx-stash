import React, { useContext, useMemo, useState } from "react";
import {
    Button,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Chip,
    Typography,
    Box,
    Stack,
} from "@mui/material";
import { Link } from "react-router-dom";
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

const entityLinkSx = {
    color: "text.primary",
    fontWeight: 500,
    textDecoration: "none",
    "&:hover": { color: "primary.light" },
} as const;

const metadataRowSx = {
    alignItems: "flex-start",
    mb: 1,
    py: 0.5,
    "&:last-child": { mb: 0 },
} as const;

const EntityBadge: React.FC<{ isNew: boolean }> = ({ isNew }) => (
    <Chip
        size="small"
        color={isNew ? "success" : "info"}
        label={isNew ? "new" : "updated"}
        sx={{ ml: 0.5 }}
    />
);

const SceneCard: React.FC<{ group: ISceneGroup; defaultExpanded?: boolean }> = ({ group, defaultExpanded }) => {
    const formatTime = (date: Date) => {
        return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const hasMetadata = group.tags.length > 0 || group.performers.length > 0 || group.studio;

    return (
        <Accordion
            defaultExpanded={defaultExpanded}
            sx={{ borderRadius: 1, overflow: "hidden" }}
        >
            <AccordionSummary
                expandIcon={<Icon icon={faChevronDown} />}
                sx={{ display: "flex", alignItems: "center" }}
            >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ flex: 1 }}>
                    <Icon icon={faFilm} />
                    <Box
                        component={Link}
                        to={`/scenes/${group.sceneId}`}
                        sx={entityLinkSx}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                        {group.sceneTitle}
                    </Box>
                    <Typography variant="caption" color="textSecondary" sx={{ ml: "auto", mr: 1 }}>
                        {formatTime(group.timestamp)}
                    </Typography>
                </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 1.5 }}>
                {!hasMetadata ? (
                    <Typography variant="body2" color="textSecondary">Scene saved with no new metadata</Typography>
                ) : (
                    <Stack spacing={1}>
                        {/* Studio */}
                        {group.studio && (
                            <Stack direction="row" spacing={1} sx={metadataRowSx}>
                                <Icon icon={faBuilding} />
                                <Typography variant="body2" color="textSecondary">Studio:</Typography>
                                <Box component={Link} to={`/studios/${group.studio.id}`} sx={entityLinkSx}>
                                    {group.studio.name}
                                </Box>
                                <EntityBadge isNew={group.studio.isNew} />
                            </Stack>
                        )}

                        {/* Performers */}
                        {group.performers.length > 0 && (
                            <Stack direction="row" spacing={1} sx={metadataRowSx}>
                                <Icon icon={faUser} />
                                <Typography variant="body2" color="textSecondary">Performers:</Typography>
                                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                                    {group.performers.map((p, i) => (
                                        <Box component="span" key={p.id} sx={{ display: "inline-flex", alignItems: "center" }}>
                                            <Box component={Link} to={`/performers/${p.id}`} sx={entityLinkSx}>
                                                {p.name}
                                            </Box>
                                            <EntityBadge isNew={p.isNew} />
                                            {i < group.performers.length - 1 && <Box component="span" sx={{ mx: 0.5 }}>,</Box>}
                                        </Box>
                                    ))}
                                </Box>
                            </Stack>
                        )}

                        {/* Tags */}
                        {group.tags.length > 0 && (
                            <Stack direction="row" spacing={1} sx={metadataRowSx}>
                                <Icon icon={faTag} />
                                <Typography variant="body2" color="textSecondary">Tags:</Typography>
                                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                                    {group.tags.map((t, i) => (
                                        <Box component="span" key={t.id} sx={{ display: "inline-flex", alignItems: "center" }}>
                                            <Box component={Link} to={`/tags/${t.id}`} sx={entityLinkSx}>
                                                {t.name}
                                            </Box>
                                            <EntityBadge isNew={t.isNew} />
                                            {i < group.tags.length - 1 && <Box component="span" sx={{ mx: 0.5 }}>,</Box>}
                                        </Box>
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
        <Box sx={{ bgcolor: "rgba(0,0,0,0.2)", borderRadius: 2, mb: 2, p: 2 }}>
            <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{
                    borderBottom: "1px solid rgba(255,255,255,0.1)",
                    mb: 2,
                    pb: 1.5,
                }}
            >
                <Typography variant="h6">
                    <Icon icon={faFilm} />
                    <Box component="span" sx={{ ml: 1 }}>Scenes Saved</Box>
                    <Chip size="small" label={sceneGroups.length} sx={{ ml: 1 }} />
                </Typography>
                <Stack direction="row" spacing={1}>
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
                <Box sx={{ border: "1px dashed rgba(255,255,255,0.2)", borderRadius: 1 }}>
                    <Typography variant="body2" color="textSecondary" textAlign="center" py={4}>
                        No tagging operations recorded yet. Use the bulk operations to save scenes.
                    </Typography>
                </Box>
            ) : (
                <Box sx={{ maxHeight: "60vh", overflowY: "auto" }}>
                    {sceneGroups.map((group, index) => (
                        <SceneCard key={group.sceneId} group={group} defaultExpanded={index === 0} />
                    ))}
                </Box>
            )}

            {hasHistory && (
                <Box sx={{ borderTop: "1px solid rgba(255,255,255,0.1)", pt: 1.5, mt: 3 }}>
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
