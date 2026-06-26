import React from "react";
import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    Switch,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import { Icon } from "../Shared/Icon";
import { faTrash, faLink } from "@fortawesome/free-solid-svg-icons";
import * as GQL from "src/core/generated-graphql";

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

interface QueueItem {
    group: GQL.ScrapedGroup & { id?: string };
    scenes: QueueSceneItem[];
    propagateToScenes: boolean;
    sceneURLMap?: Record<string, string>;
    sceneClipData?: Record<string, GQL.ScrapedScene>;
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
            new_scene_index: val ? parseInt(val, 10) : undefined,
        };
        item.scenes = scenes;
        newQueue[itemIndex] = item;
        onUpdateQueue(newQueue);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
            <DialogTitle>
                <Box display="flex" alignItems="center" gap={1}>
                    Review Queue
                    <Chip label={`${safeQueue.length} movie${safeQueue.length !== 1 ? "s" : ""}`} size="small" />
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Review each movie and its scene assignments before processing.
                </Typography>
            </DialogTitle>

            <DialogContent dividers sx={{ p: 0 }}>
                {safeQueue.length === 0 ? (
                    <Box p={4} textAlign="center" color="text.secondary">
                        No items in queue
                    </Box>
                ) : (
                    <Box sx={{ display: "flex", flexDirection: "column" }}>
                        {safeQueue.map((item, itemIndex) => {
                            const matchedCount = Object.keys(item.sceneURLMap ?? {}).length;

                            return (
                                <Box
                                    key={itemIndex}
                                    sx={{
                                        borderBottom: "1px solid",
                                        borderColor: "divider",
                                        "&:last-child": { borderBottom: 0 },
                                    }}
                                >
                                    {/* ── Movie header row ── */}
                                    <Box
                                        sx={{
                                            display: "flex",
                                            alignItems: "flex-start",
                                            gap: 2,
                                            p: 2,
                                            bgcolor: "action.hover",
                                        }}
                                    >
                                        {/* Cover */}
                                        {item.group.front_image && (
                                            <Box
                                                component="img"
                                                src={item.group.front_image}
                                                alt=""
                                                sx={{
                                                    width: 56,
                                                    height: 80,
                                                    objectFit: "cover",
                                                    borderRadius: 1,
                                                    flexShrink: 0,
                                                }}
                                            />
                                        )}

                                        {/* Title + meta */}
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                            <Typography variant="subtitle1" fontWeight="bold" noWrap>
                                                {item.group.name}
                                            </Typography>
                                            {item.group.urls && item.group.urls.length > 0 && (
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    component="a"
                                                    href={item.group.urls[0]}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                                >
                                                    {item.group.urls[0]}
                                                </Typography>
                                            )}
                                            <Box display="flex" alignItems="center" gap={1} mt={0.75} flexWrap="wrap">
                                                {item.group.date && (
                                                    <Typography variant="caption" color="text.secondary">
                                                        {item.group.date}
                                                    </Typography>
                                                )}
                                                {item.group.studio?.name && (
                                                    <Typography variant="caption" color="text.secondary">
                                                        · {item.group.studio.name}
                                                    </Typography>
                                                )}
                                                <Chip
                                                    size="small"
                                                    label={`${item.scenes.length} scene${item.scenes.length !== 1 ? "s" : ""}`}
                                                    variant="outlined"
                                                />
                                                {matchedCount > 0 && (
                                                    <Chip
                                                        size="small"
                                                        icon={<Icon icon={faLink} />}
                                                        label={`${matchedCount} clip${matchedCount !== 1 ? "s" : ""} matched`}
                                                        color="success"
                                                        variant="outlined"
                                                    />
                                                )}
                                            </Box>
                                            <FormControlLabel
                                                sx={{ mt: 0.5 }}
                                                control={
                                                    <Switch
                                                        size="small"
                                                        checked={item.propagateToScenes}
                                                        onChange={(e) => {
                                                            const newQueue = [...safeQueue];
                                                            newQueue[itemIndex] = { ...newQueue[itemIndex], propagateToScenes: e.target.checked };
                                                            onUpdateQueue(newQueue);
                                                        }}
                                                    />
                                                }
                                                label={
                                                    <Typography variant="caption" color="text.secondary">
                                                        Copy movie studio &amp; tags to scenes
                                                    </Typography>
                                                }
                                            />
                                        </Box>

                                        {/* Remove */}
                                        <Tooltip title="Remove from queue">
                                            <Button
                                                variant="outlined"
                                                color="error"
                                                size="small"
                                                onClick={() => onRemove(itemIndex)}
                                                sx={{ flexShrink: 0 }}
                                            >
                                                <Icon icon={faTrash} />
                                            </Button>
                                        </Tooltip>
                                    </Box>

                                    {/* ── Scene rows ── */}
                                    <Box sx={{ px: 2, pb: 1.5, pt: 1 }}>
                                        {/* Column headers */}
                                        <Box
                                            sx={{
                                                display: "grid",
                                                gridTemplateColumns: "80px 1fr 220px 72px",
                                                gap: 1.5,
                                                px: 1,
                                                pb: 0.5,
                                                borderBottom: "1px solid",
                                                borderColor: "divider",
                                                mb: 0.5,
                                            }}
                                        >
                                            <Typography variant="caption" color="text.disabled">Preview</Typography>
                                            <Typography variant="caption" color="text.disabled">Scene</Typography>
                                            <Typography variant="caption" color="text.disabled">Clip match</Typography>
                                            <Typography variant="caption" color="text.disabled">Index #</Typography>
                                        </Box>

                                        {item.scenes.map((scene, sceneIndex) => {
                                            const clipURL = item.sceneURLMap?.[scene.id];
                                            const clipData = item.sceneClipData?.[scene.id];
                                            const clipLabel = clipData?.title ?? (clipURL ? `Clip #${clipURL.match(/\/clip\/(\d+)/)?.[1] ?? "?"}` : null);

                                            return (
                                                <Box
                                                    key={scene.id}
                                                    sx={{
                                                        display: "grid",
                                                        gridTemplateColumns: "80px 1fr 220px 72px",
                                                        gap: 1.5,
                                                        alignItems: "center",
                                                        px: 1,
                                                        py: 0.75,
                                                        borderRadius: 1,
                                                        "&:hover": { bgcolor: "action.hover" },
                                                    }}
                                                >
                                                    {/* Screenshot */}
                                                    <Box
                                                        sx={{
                                                            aspectRatio: "16/9",
                                                            borderRadius: 0.5,
                                                            overflow: "hidden",
                                                            bgcolor: "action.disabledBackground",
                                                            flexShrink: 0,
                                                        }}
                                                    >
                                                        {scene.paths?.screenshot && (
                                                            <Box
                                                                component="img"
                                                                src={scene.paths.screenshot}
                                                                alt=""
                                                                sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                                            />
                                                        )}
                                                    </Box>

                                                    {/* Scene title + file */}
                                                    <Box sx={{ minWidth: 0 }}>
                                                        <Typography variant="body2" noWrap fontWeight={scene.title ? "medium" : "normal"} color={scene.title ? "text.primary" : "text.secondary"}>
                                                            {scene.title || `Scene ${sceneIndex + 1}`}
                                                        </Typography>
                                                        {scene.files[0]?.basename && (
                                                            <Typography variant="caption" color="text.disabled" noWrap display="block" title={scene.files[0].path}>
                                                                {scene.files[0].basename}
                                                            </Typography>
                                                        )}
                                                    </Box>

                                                    {/* Clip match */}
                                                    <Box>
                                                        {clipLabel ? (
                                                            clipURL ? (
                                                                <Chip
                                                                    size="small"
                                                                    label={clipLabel}
                                                                    color="success"
                                                                    variant="outlined"
                                                                    component="a"
                                                                    href={clipURL}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    clickable
                                                                    sx={{ maxWidth: "100%", "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" } }}
                                                                />
                                                            ) : (
                                                                <Chip size="small" label={clipLabel} color="success" variant="outlined" sx={{ maxWidth: "100%" }} />
                                                            )
                                                        ) : (
                                                            <Typography variant="caption" color="text.disabled">—</Typography>
                                                        )}
                                                    </Box>

                                                    {/* Index input */}
                                                    <TextField
                                                        type="number"
                                                        size="small"
                                                        placeholder="#"
                                                        value={scene.new_scene_index?.toString() ?? ""}
                                                        onChange={(e) => handleSceneIndexChange(itemIndex, sceneIndex, e.target.value)}
                                                        inputProps={{ style: { padding: "4px 8px" }, min: 1 }}
                                                        sx={{ width: 68 }}
                                                    />
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                )}
            </DialogContent>

            <DialogActions sx={{ justifyContent: "space-between" }}>
                <Typography variant="caption" color="text.secondary">
                    {safeQueue.reduce((n, i) => n + i.scenes.length, 0)} scenes across {safeQueue.length} movie{safeQueue.length !== 1 ? "s" : ""}
                </Typography>
                <Box display="flex" gap={1}>
                    <Button variant="outlined" onClick={onClose}>
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
                                <CircularProgress size={16} sx={{ mr: 1 }} color="inherit" />
                                Processing…
                            </>
                        ) : (
                            "Process All"
                        )}
                    </Button>
                </Box>
            </DialogActions>
        </Dialog>
    );
};

export default MovieFyQueue;
