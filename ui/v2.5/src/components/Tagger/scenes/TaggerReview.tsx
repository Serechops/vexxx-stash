import React, { useContext, useMemo } from "react";
import { Button, Card, Accordion, Badge } from "react-bootstrap";
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
    <Badge variant={isNew ? "success" : "info"} className="ml-1">
        {isNew ? "new" : "updated"}
    </Badge>
);

const SceneCard: React.FC<{ group: ISceneGroup; eventKey: string }> = ({ group, eventKey }) => {
    const formatTime = (date: Date) => {
        return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const hasMetadata = group.tags.length > 0 || group.performers.length > 0 || group.studio;

    return (
        <Card className="tagger-review-section">
            <Accordion.Toggle as={Card.Header} eventKey={eventKey} className="d-flex align-items-center">
                <Icon icon={faFilm} className="mr-2" />
                <Link to={`/scenes/${group.sceneId}`} className="tagger-review-entry-name" onClick={(e) => e.stopPropagation()}>
                    {group.sceneTitle}
                </Link>
                <span className="tagger-review-entry-time ml-auto mr-2">
                    {formatTime(group.timestamp)}
                </span>
                <Icon icon={faChevronDown} />
            </Accordion.Toggle>
            <Accordion.Collapse eventKey={eventKey}>
                <Card.Body className="tagger-review-scene-body">
                    {!hasMetadata ? (
                        <div className="text-muted small">Scene saved with no new metadata</div>
                    ) : (
                        <>
                            {/* Studio */}
                            {group.studio && (
                                <div className="tagger-review-metadata-row">
                                    <Icon icon={faBuilding} className="mr-2 text-muted" />
                                    <span className="tagger-review-label">Studio:</span>
                                    <Link to={`/studios/${group.studio.id}`} className="tagger-review-entity-link">
                                        {group.studio.name}
                                    </Link>
                                    <EntityBadge isNew={group.studio.isNew} />
                                </div>
                            )}

                            {/* Performers */}
                            {group.performers.length > 0 && (
                                <div className="tagger-review-metadata-row">
                                    <Icon icon={faUser} className="mr-2 text-muted" />
                                    <span className="tagger-review-label">Performers:</span>
                                    <div className="tagger-review-entity-list">
                                        {group.performers.map((p, i) => (
                                            <span key={p.id} className="tagger-review-entity-item">
                                                <Link to={`/performers/${p.id}`} className="tagger-review-entity-link">
                                                    {p.name}
                                                </Link>
                                                <EntityBadge isNew={p.isNew} />
                                                {i < group.performers.length - 1 && <span className="mx-1">,</span>}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Tags */}
                            {group.tags.length > 0 && (
                                <div className="tagger-review-metadata-row">
                                    <Icon icon={faTag} className="mr-2 text-muted" />
                                    <span className="tagger-review-label">Tags:</span>
                                    <div className="tagger-review-entity-list">
                                        {group.tags.map((t, i) => (
                                            <span key={t.id} className="tagger-review-entity-item">
                                                <Link to={`/tags/${t.id}`} className="tagger-review-entity-link">
                                                    {t.name}
                                                </Link>
                                                <EntityBadge isNew={t.isNew} />
                                                {i < group.tags.length - 1 && <span className="mx-1">,</span>}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </Card.Body>
            </Accordion.Collapse>
        </Card>
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
        <div className="tagger-review">
            <div className="tagger-review-header">
                <h5>
                    <Icon icon={faFilm} className="mr-2" />
                    Scenes Saved
                    <Badge variant="secondary" className="ml-2">{sceneGroups.length}</Badge>
                </h5>
                <div className="tagger-review-actions">
                    {hasHistory && (
                        <Button
                            variant="outline-danger"
                            size="sm"
                            onClick={clearTaggerHistory}
                            className="mr-2"
                        >
                            <Icon icon={faTrash} className="mr-1" />
                            Clear
                        </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>

            {!hasHistory ? (
                <div className="tagger-review-empty">
                    <p className="text-muted text-center py-4">
                        No tagging operations recorded yet. Use the bulk operations to save scenes.
                    </p>
                </div>
            ) : (
                <Accordion defaultActiveKey="0" className="tagger-review-accordion">
                    {sceneGroups.map((group, index) => (
                        <SceneCard key={group.sceneId} group={group} eventKey={String(index)} />
                    ))}
                </Accordion>
            )}

            {hasHistory && (
                <div className="tagger-review-summary mt-3">
                    <small className="text-muted">
                        {sceneGroups.length} scene{sceneGroups.length !== 1 ? 's' : ''} |
                        {totalTags} tag{totalTags !== 1 ? 's' : ''} |
                        {totalPerformers} performer{totalPerformers !== 1 ? 's' : ''} |
                        {totalStudios} studio{totalStudios !== 1 ? 's' : ''}
                    </small>
                </div>
            )}
        </div>
    );
};

export default TaggerReview;
