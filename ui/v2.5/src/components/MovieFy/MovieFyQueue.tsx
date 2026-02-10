import React from "react";
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, Chip, Box, Grid, TextField, CircularProgress } from "@mui/material";
import { Icon } from "../Shared/Icon";
import { faTrash, faUser, faTag, faBuilding } from "@fortawesome/free-solid-svg-icons";

import * as GQL from "src/core/generated-graphql";

// Types for the queue
interface QueueSceneItem {
    id: string;
    title?: string | null;
    paths: {
        screenshot?: string | null;
    };
    files: Array<{
        path: string;
        basename?: string;
    }>;
    new_scene_index?: number;
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
    onUpdateQueue: (queue: QueueItem[]) => void;
    processing?: boolean;
}

export const MovieFyQueue: React.FC<MovieFyQueueProps> = ({
    open,
    onClose,
    queue = [],
    onRemove,
    onProcess,
    onUpdateQueue,
    processing = false,
}) => {
    const safeQueue = Array.isArray(queue) ? queue : [];

    const handleSceneIndexChange = (itemIndex: number, sceneIndex: number, val: string) => {
        const newQueue = [...safeQueue];
        const item = { ...newQueue[itemIndex] };
        const scenes = [...(item.scenes || [])];
        scenes[sceneIndex] = {
            ...scenes[sceneIndex],
            new_scene_index: val ? parseInt(val, 10) : undefined
        };
        item.scenes = scenes;
        newQueue[itemIndex] = item;
        onUpdateQueue(newQueue);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
            <DialogTitle>
                Review Queue{" "}
                <Chip label={`${safeQueue.length} items`} className="ml-2" />
            </DialogTitle>
            <DialogContent dividers>
                {safeQueue.length === 0 ? (
                    <div className="text-center p-4" style={{ color: '#a1a1aa' }}>No items in queue</div>
                ) : (
                    <div className="moviefy-queue-list">
                        {safeQueue.map((item, index) => (
                            <Box key={index} className="moviefy-queue-item mb-3 p-3 border rounded">
                                <Grid container spacing={2}>
                                    {/* Scene Previews */}
                                    <Grid size={{ xs: 12, sm: 3 }}>
                                        <div className="scene-previews flex mb-2" style={{ gap: "0.25rem" }}>
                                            {(item.scenes || []).slice(0, 2).map((scene: QueueSceneItem, sceneIndex: number) => (
                                                <div
                                                    key={sceneIndex}
                                                    className="scene-preview relative"
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
                                                        className="w-full h-full"
                                                        style={{ objectFit: "cover" }}
                                                    />
                                                    <span
                                                        className="absolute text-white text-center small py-1"
                                                        style={{ backgroundColor: '#343a40', bottom: 0, left: 0, right: 0, opacity: 0.75 }}
                                                    >
                                                        Scene {sceneIndex + 1}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                        <small style={{ color: '#a1a1aa' }}>
                                            {(item.scenes || []).length} scene
                                            {(item.scenes || []).length !== 1 ? "s" : ""} to process
                                        </small>
                                    </Grid>

                                    {/* Movie Details */}
                                    <Grid size={{ xs: 12, sm: 9 }}>
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center">
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
                                                    <h6 className="mb-0 text-body">{item.group.name}</h6>
                                                    {item.group.urls && item.group.urls.length > 0 && (
                                                        <a
                                                            href={item.group.urls[0]}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="small block"
                                                            style={{ color: '#a1a1aa' }}
                                                        >
                                                            {item.group.urls[0]}
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                            <Button
                                                variant="outlined"
                                                color="error"
                                                size="small"
                                                onClick={() => onRemove(index)}
                                            >
                                                <Icon icon={faTrash} />
                                            </Button>
                                        </div>

                                        {/* Scene List with Indexes */}
                                        <div className="mt-2">
                                            <small style={{ color: '#a1a1aa' }}>Scenes & Indexes:</small>
                                            <div className="mt-1">
                                                {(item.scenes || []).map((scene: QueueSceneItem, sceneIndex: number) => (
                                                    <div key={sceneIndex} className="flex items-center mb-1">
                                                        <TextField
                                                            type="number"
                                                            size="small"
                                                            placeholder="#"
                                                            style={{ width: "60px" }}
                                                            className="mr-2"
                                                            value={scene.new_scene_index?.toString() ?? ""}
                                                            onChange={(e) => handleSceneIndexChange(index, sceneIndex, e.target.value)}
                                                            inputProps={{ style: { padding: '4px 8px' } }}
                                                        />
                                                        <span className="text-truncate text-body" title={scene.title || ""}>
                                                            {scene.title || `Scene ${sceneIndex + 1}`}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </Grid>
                                </Grid>
                            </Box>
                        ))}
                    </div>
                )}
            </DialogContent>
            <DialogActions className="justify-between">
                <div />
                <div>
                    <Button variant="outlined" onClick={onClose} className="mr-2">
                        Close
                    </Button>
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={onProcess}
                        disabled={safeQueue.length === 0 || processing}
                    >
                        {processing ? (
                            <>
                                <CircularProgress size={20} className="mr-2" color="inherit" />
                                Processing...
                            </>
                        ) : (
                            "Process All"
                        )}
                    </Button>
                </div>
            </DialogActions>
        </Dialog>
    );
};

export default MovieFyQueue;
