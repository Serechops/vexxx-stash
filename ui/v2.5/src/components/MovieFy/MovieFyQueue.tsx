import React from "react";
import { Modal, Button, Row, Col, Badge } from "react-bootstrap";
import { Icon } from "../Shared/Icon";
import { faTrash, faUser, faTag, faBuilding } from "@fortawesome/free-solid-svg-icons";

import * as GQL from "src/core/generated-graphql";

// Types for the queue
interface QueueSceneItem {
    id: string;
    title?: string | null;
    paths?: {
        screenshot?: string | null;
    };
    files?: Array<{
        path?: string;
        basename?: string;
    }>;
}

interface QueueMetadata {
    performers?: Record<string, unknown>;
    tags?: Record<string, unknown>;
    studio?: {
        name?: string;
    };
}

interface QueueItem {
    group: GQL.ScrapedGroup & { id?: string };
    scenes: QueueSceneItem[];
}

interface MovieFyQueueProps {
    open: boolean;
    onClose: () => void;
    queue: QueueItem[];
    onRemove: (index: number) => void;
    onProcess: () => void;
    processing?: boolean;
}

export const MovieFyQueue: React.FC<MovieFyQueueProps> = ({
    open,
    onClose,
    queue = [],
    onRemove,
    onProcess,
    processing = false,
}) => {
    const safeQueue = Array.isArray(queue) ? queue : [];

    return (
        <Modal show={open} onHide={onClose} size="lg" centered scrollable>
            <Modal.Header closeButton>
                <Modal.Title>
                    Review Queue{" "}
                    <Badge variant="secondary" className="ml-2">
                        {safeQueue.length} items
                    </Badge>
                </Modal.Title>
            </Modal.Header>
            <Modal.Body>
                {safeQueue.length === 0 ? (
                    <div className="text-center text-muted p-4">No items in queue</div>
                ) : (
                    <div className="moviefy-queue-list">
                        {safeQueue.map((item, index) => (
                            <div key={index} className="moviefy-queue-item mb-3 p-3 border rounded">
                                <Row>
                                    {/* Scene Previews */}
                                    <Col xs={12} sm={3}>
                                        <div className="scene-previews d-flex mb-2" style={{ gap: "0.25rem" }}>
                                            {(item.scenes || []).slice(0, 2).map((scene: QueueSceneItem, sceneIndex: number) => (
                                                <div
                                                    key={sceneIndex}
                                                    className="scene-preview position-relative"
                                                    style={{
                                                        flex: "1 1 50%",
                                                        aspectRatio: "16/9",
                                                        borderRadius: "4px",
                                                        overflow: "hidden",
                                                    }}
                                                >
                                                    <img
                                                        src={scene.paths?.screenshot || ""}
                                                        alt={scene.title || `Scene ${sceneIndex + 1}`}
                                                        className="w-100 h-100"
                                                        style={{ objectFit: "cover" }}
                                                    />
                                                    <span
                                                        className="position-absolute bg-dark text-white text-center small py-1"
                                                        style={{ bottom: 0, left: 0, right: 0, opacity: 0.75 }}
                                                    >
                                                        Scene {sceneIndex + 1}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                        <small className="text-muted">
                                            {(item.scenes || []).length} scene
                                            {(item.scenes || []).length !== 1 ? "s" : ""} to process
                                        </small>
                                    </Col>

                                    {/* Movie Details */}
                                    <Col xs={12} sm={9}>
                                        <div className="d-flex justify-content-between align-items-start mb-2">
                                            <div className="d-flex align-items-center">
                                                {item.group.front_image && (
                                                    <img
                                                        src={item.group.front_image}
                                                        alt=""
                                                        className="mr-3"
                                                        style={{
                                                            width: 40,
                                                            height: 60,
                                                            objectFit: "cover",
                                                            borderRadius: 4,
                                                        }}
                                                    />
                                                )}
                                                <div>
                                                    <h6 className="mb-0">{item.group.name}</h6>
                                                    {item.group.urls && item.group.urls.length > 0 && (
                                                        <a
                                                            href={item.group.urls[0]}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-muted small d-block"
                                                        >
                                                            {item.group.urls[0]}
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                            <Button
                                                variant="outline-danger"
                                                size="sm"
                                                onClick={() => onRemove(index)}
                                            >
                                                <Icon icon={faTrash} />
                                            </Button>
                                        </div>

                                        {/* Scene List */}
                                        <div>
                                            <small className="text-muted">Scenes:</small>
                                            <div className="d-flex flex-wrap mt-1" style={{ gap: "0.25rem" }}>
                                                {(item.scenes || []).map((scene: QueueSceneItem, sceneIndex: number) => (
                                                    <Badge
                                                        key={sceneIndex}
                                                        variant="outline-secondary"
                                                        className="border"
                                                    >
                                                        {scene.title || `Scene ${sceneIndex + 1}`}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    </Col>
                                </Row>
                            </div>
                        ))}
                    </div>
                )}
            </Modal.Body>
            <Modal.Footer>
                <Button variant="secondary" onClick={onClose}>
                    Close
                </Button>
                <Button
                    variant="primary"
                    onClick={onProcess}
                    disabled={safeQueue.length === 0 || processing}
                >
                    {processing ? (
                        <>
                            <span
                                className="spinner-border spinner-border-sm mr-2"
                                role="status"
                            />
                            Processing...
                        </>
                    ) : (
                        "Process All"
                    )}
                </Button>
            </Modal.Footer>
        </Modal>
    );
};

export default MovieFyQueue;
