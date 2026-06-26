import React, { useState, useEffect } from "react";
import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    MenuItem,
    Select,
    Skeleton,
    Typography,
} from "@mui/material";
import type { SceneItem } from "./MovieFyFileBrowser";
import * as GQL from "src/core/generated-graphql";

interface ClipEntry {
    url: string;
    scraped?: GQL.ScrapedScene | null;
}

interface Props {
    open: boolean;
    clipData: ClipEntry[];
    clipsFetching: boolean;
    scenes: SceneItem[];
    onConfirm: (sceneURLMap: Record<string, string>, sceneClipData: Record<string, GQL.ScrapedScene>) => void;
    onSkip: () => void;
    onClose: () => void;
}

function clipLabel(url: string, scraped?: GQL.ScrapedScene | null): string {
    if (scraped?.title) return scraped.title;
    const m = url.match(/\/clip\/(\d+)/);
    return m ? `Clip #${m[1]}` : url.replace(/^https?:\/\/[^/]+/, "").slice(0, 50);
}

export const MovieFySceneURLMatcher: React.FC<Props> = ({
    open,
    clipData,
    clipsFetching,
    scenes,
    onConfirm,
    onSkip,
    onClose,
}) => {
    // url → assigned sceneId (or "" for none)
    const [assignments, setAssignments] = useState<Record<string, string>>({});

    useEffect(() => {
        if (open) {
            const initial: Record<string, string> = {};
            clipData.forEach((clip, i) => {
                initial[clip.url] = scenes[i]?.id ?? "";
            });
            setAssignments(initial);
        }
    }, [open, clipData, scenes]);

    const handleConfirm = () => {
        const sceneURLMap: Record<string, string> = {};
        const sceneClipData: Record<string, GQL.ScrapedScene> = {};
        for (const [url, sceneId] of Object.entries(assignments)) {
            if (sceneId) {
                sceneURLMap[sceneId] = url;
                const clip = clipData.find(c => c.url === url);
                if (clip?.scraped) {
                    sceneClipData[sceneId] = clip.scraped;
                }
            }
        }
        onConfirm(sceneURLMap, sceneClipData);
    };

    const assignedCount = Object.values(assignments).filter(Boolean).length;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
            <DialogTitle>
                <Box display="flex" alignItems="center" gap={1}>
                    Match Scene Clips to Local Scenes
                    {clipsFetching && <CircularProgress size={16} />}
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {clipData.length} clip{clipData.length !== 1 ? "s" : ""} found on the movie page.
                    Match them to your local scenes — metadata (performers, tags, image, date) will be applied on process.
                    {clipsFetching && " Fetching scene details…"}
                </Typography>
            </DialogTitle>
            <DialogContent dividers>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
                    {clipData.map((clip, i) => {
                        const isLoading = clip.scraped === undefined;
                        const performers = clip.scraped?.performers
                            ?.map(p => p.name)
                            .filter(Boolean)
                            .join(", ");

                        return (
                            <Box key={clip.url} sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
                                {/* Clip info column */}
                                <Box sx={{ flex: "0 0 240px", minWidth: 0 }}>
                                    {isLoading ? (
                                        <>
                                            <Skeleton variant="rounded" width={180} height={24} />
                                            <Skeleton variant="text" width={120} sx={{ mt: 0.5 }} />
                                        </>
                                    ) : (
                                        <>
                                            <Chip
                                                label={clipLabel(clip.url, clip.scraped)}
                                                size="small"
                                                component="a"
                                                href={clip.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                clickable
                                                color={assignments[clip.url] ? "primary" : "default"}
                                                sx={{ maxWidth: "100%", height: "auto", "& .MuiChip-label": { whiteSpace: "normal" } }}
                                            />
                                            {performers && (
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    display="block"
                                                    noWrap
                                                    sx={{ mt: 0.5 }}
                                                    title={performers}
                                                >
                                                    {performers}
                                                </Typography>
                                            )}
                                            <Typography
                                                variant="caption"
                                                color="text.disabled"
                                                display="block"
                                                sx={{ mt: 0.25 }}
                                            >
                                                Clip {i + 1}
                                            </Typography>
                                        </>
                                    )}
                                </Box>

                                <Typography sx={{ flex: "0 0 auto", color: "text.secondary", pt: 0.75 }}>→</Typography>

                                {/* Scene selector */}
                                <FormControl size="small" sx={{ flex: 1 }}>
                                    <Select
                                        value={assignments[clip.url] ?? ""}
                                        onChange={(e) =>
                                            setAssignments(prev => ({ ...prev, [clip.url]: e.target.value }))
                                        }
                                        displayEmpty
                                        MenuProps={{
                                            disableScrollLock: true,
                                            slotProps: {
                                                backdrop: {
                                                    sx: { backgroundColor: "transparent", backdropFilter: "none" },
                                                },
                                            },
                                        }}
                                    >
                                        <MenuItem value="">
                                            <em>No match</em>
                                        </MenuItem>
                                        {scenes.map((scene) => (
                                            <MenuItem key={scene.id} value={scene.id}>
                                                {scene.title ||
                                                    scene.files[0]?.basename ||
                                                    `Scene ${scene.id}`}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Box>
                        );
                    })}
                </Box>
            </DialogContent>
            <DialogActions sx={{ justifyContent: "space-between" }}>
                <Button variant="text" color="inherit" onClick={onSkip}>
                    Skip — add to queue without scene scraping
                </Button>
                <Box sx={{ display: "flex", gap: 1 }}>
                    <Button variant="outlined" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        onClick={handleConfirm}
                        disabled={assignedCount === 0}
                    >
                        Confirm{assignedCount > 0 ? ` (${assignedCount} matched)` : ""}
                    </Button>
                </Box>
            </DialogActions>
        </Dialog>
    );
};

export default MovieFySceneURLMatcher;
