
import React, { useEffect, useState, useRef } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Box,
    Typography,
    InputAdornment,
    IconButton,
    LinearProgress,
} from "@mui/material";
import { useIntl } from "react-intl";
import { SceneDataFragment } from "src/core/generated-graphql";
import * as GQL from "src/core/generated-graphql";
import cx from "classnames";
import { Icon } from "src/components/Shared/Icon";
import { faCheckCircle, faCircle } from "@fortawesome/free-solid-svg-icons";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";

interface SceneGalleryDialogProps {
    scene: SceneDataFragment;
    show: boolean;
    onHide: () => void;
    videoElement: HTMLVideoElement | null;
}

interface PreviewImage {
    timestamp: number;
    dataUrl: string;
    selected: boolean;
}

export const SceneGalleryDialog: React.FC<SceneGalleryDialogProps> = ({
    scene,
    show,
    onHide,
    videoElement,
}) => {
    const intl = useIntl();
    const [imageCount, setImageCount] = useState<number>(20);
    const [previews, setPreviews] = useState<PreviewImage[]>([]);
    const [generating, setGenerating] = useState<boolean>(false);
    const [creating, setCreating] = useState<boolean>(false);
    const [progress, setProgress] = useState<number>(0);

    const [sceneGenerateGallery] = GQL.useSceneGenerateGalleryMutation();

    const handleGeneratePreviews = async () => {
        if (!videoElement) return;

        setGenerating(true);
        setPreviews([]);
        setProgress(0);

        const duration = videoElement.duration;
        if (!duration || duration === Infinity) {
            setGenerating(false);
            return;
        }

        const timestamps: number[] = [];
        // Generate evenly spaced timestamps avoiding start/end extremas
        const step = duration / (imageCount + 1);
        for (let i = 1; i <= imageCount; i++) {
            timestamps.push(step * i);
        }

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            setGenerating(false);
            return;
        }

        // Save current state
        const originalTime = videoElement.currentTime;
        const wasPaused = videoElement.paused;
        if (!wasPaused) videoElement.pause();

        // Use a cloned video element if possible, or just hijack the main one?
        // Hijacking main one is visible to user.
        // Let's assume we hijack it but try to be quick.
        // Or better: Use a hidden off-screen video element source from the same Blob/URL?
        // Stash uses 'src' attribute. 

        // Actually, capturing form the main video element requires seeking it.
        // Let's try seeking the main element. It might be jarring.
        // User experience: The video will jump around. 
        // Maybe show an overlay "Generating Previews..." so they don't see the jumping?

        const newPreviews: PreviewImage[] = [];

        // Store original volume/muted state
        const originalVolume = videoElement.volume;
        const originalMuted = videoElement.muted;
        videoElement.muted = true;

        try {
            for (let i = 0; i < timestamps.length; i++) {
                const t = timestamps[i];

                // Seek
                videoElement.currentTime = t;

                // Wait for seek
                await new Promise<void>((resolve) => {
                    const onSeeked = () => {
                        videoElement.removeEventListener("seeked", onSeeked);
                        resolve();
                    };
                    videoElement.addEventListener("seeked", onSeeked, { once: true });
                });

                // Draw
                canvas.width = videoElement.videoWidth / 4; // 1/4th resolution for preview
                canvas.height = videoElement.videoHeight / 4;
                ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

                newPreviews.push({
                    timestamp: t,
                    dataUrl: canvas.toDataURL("image/jpeg", 0.7),
                    selected: true,
                });

                setProgress(Math.round(((i + 1) / timestamps.length) * 100));
            }
        } finally {
            // Restore
            videoElement.currentTime = originalTime;
            videoElement.muted = originalMuted;
            videoElement.volume = originalVolume;
            // if (!wasPaused) videoElement.play(); // Don't auto play, stay paused is safer

            setPreviews(newPreviews);
            setGenerating(false);
        }
    };

    const handleCreate = async () => {
        const selected = previews.filter(p => p.selected);
        if (selected.length === 0) return;

        setCreating(true);
        try {
            const timestamps = selected.map(p => p.timestamp);
            const result = await sceneGenerateGallery({
                variables: {
                    scene_id: scene.id,
                    timestamps: timestamps,
                    create_input: {
                        title: `${scene.title ?? scene.id} Gallery`,
                    }
                }
            });

            if (result.data?.sceneGenerateGallery) {
                onHide();
                // TODO: Toast notification or navigation?
                // window.location.href = `/galleries/${result.data.sceneGenerateGallery.id}`;
            }
        } catch (e) {
            console.error(e);
        } finally {
            setCreating(false);
        }
    };

    const toggleSelect = (index: number) => {
        setPreviews(prev => {
            const next = [...prev];
            next[index].selected = !next[index].selected;
            return next;
        });
    };

    return (
        <Dialog open={show} onClose={onHide} maxWidth="lg" fullWidth>
            <DialogTitle>Create Gallery from Scene</DialogTitle>
            <DialogContent>
                <Box sx={{ mb: 3, mt: 1 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}>Number of Images</Typography>
                    <Box sx={{ display: "flex", gap: 1 }}>
                        <TextField
                            type="number"
                            size="small"
                            value={imageCount}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setImageCount(parseInt(e.target.value) || 0)}
                            disabled={generating}
                            sx={{ width: 120 }}
                        />
                        <Button
                            variant="contained"
                            onClick={handleGeneratePreviews}
                            disabled={generating || !videoElement}
                        >
                            {generating ? "Scanning..." : "Generate Previews"}
                        </Button>
                    </Box>
                    {generating && (
                        <Box sx={{ mt: 2 }}>
                            <Typography variant="body2">Progress: {progress}%</Typography>
                            <LinearProgress variant="determinate" value={progress} sx={{ mt: 1 }} />
                        </Box>
                    )}
                </Box>

                <Box
                    sx={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 1,
                        justifyContent: "center",
                        maxHeight: "60vh",
                        overflowY: "auto",
                    }}
                >
                    {previews.map((p, i) => (
                        <Box
                            key={i}
                            onClick={() => toggleSelect(i)}
                            sx={{
                                position: "relative",
                                cursor: "pointer",
                                width: 160,
                                opacity: p.selected ? 1 : 0.5,
                                border: p.selected ? "2px solid #28a745" : "2px solid transparent",
                                transition: "opacity 0.2s",
                            }}
                        >
                            <img src={p.dataUrl} style={{ width: "100%" }} />
                            <Box sx={{ position: "absolute", top: 4, right: 4, color: "white" }}>
                                <Icon icon={p.selected ? faCheckCircle : faCircle} color={p.selected ? "green" : "gray"} />
                            </Box>
                            <Box
                                sx={{
                                    position: "absolute",
                                    bottom: 0,
                                    left: 0,
                                    p: 0.5,
                                    color: "white",
                                    backgroundColor: "rgba(0,0,0,0.75)",
                                    fontSize: "0.75rem",
                                }}
                            >
                                {new Date(p.timestamp * 1000).toISOString().substr(11, 8)}
                            </Box>
                        </Box>
                    ))}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onHide}>Cancel</Button>
                <Button
                    variant="contained"
                    onClick={handleCreate}
                    disabled={generating || creating || previews.filter(p => p.selected).length === 0}
                >
                    {creating ? <LoadingIndicator inline message="Creating..." /> : `Create Gallery (${previews.filter(p => p.selected).length})`}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
