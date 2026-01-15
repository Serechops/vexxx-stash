import React, { useState } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Grid,
    Box,
    FormControlLabel,
    Checkbox,
    Typography,
    List,
    ListItem,
    ListItemText,
} from "@mui/material";
import { useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { useToast } from "src/hooks/Toast";

import TextUtils from "src/utils/text";

interface IProps {
    fileId: string;
    fileDuration?: number;
    onClose: () => void;
    onSuccess: (sceneId: string) => void;
}

export const CreateSceneSegmentDialog: React.FC<IProps> = ({
    fileId,
    fileDuration,
    onClose,
    onSuccess,
}) => {
    const intl = useIntl();
    const Toast = useToast();
    const [title, setTitle] = useState("");
    const [startPointStr, setStartPointStr] = useState("");
    const [endPointStr, setEndPointStr] = useState(
        fileDuration ? TextUtils.secondsToTimestamp(fileDuration) : ""
    );

    const [createScene] = GQL.useSceneCreateMutation();
    const [generatePhash] = GQL.useGeneratePhashMutation();
    const [searchByPhash] = GQL.useStashDbSearchByPhashMutation();

    const [matches, setMatches] = useState<GQL.ScrapedSceneDataFragment[]>([]);
    const [checking, setChecking] = useState(false);
    const [showMatches, setShowMatches] = useState(false);

    // Batch scan state (existing)
    const [isBatchScan, setIsBatchScan] = useState(false);
    const [scanWindowStr, setScanWindowStr] = useState("30");
    const [scanIncrementStr, setScanIncrementStr] = useState("5");
    const [progress, setProgress] = useState(0);
    const [totalProgress, setTotalProgress] = useState(0);

    const handleCheckMatches = async () => {
        // ... (existing validation)
        const startPoint = TextUtils.timestampToSeconds(startPointStr);
        const endPoint = TextUtils.timestampToSeconds(endPointStr);

        if ((startPointStr && startPoint === null) || (endPointStr && endPoint === null)) {
            Toast.error("Invalid duration format");
            return;
        }

        if (startPoint === null || endPoint === null) {
            Toast.error("Please define start and end points first");
            return;
        }

        const duration = endPoint - startPoint;
        if (duration <= 0) {
            Toast.error("End point must be after start point");
            return;
        }

        setChecking(true);
        setMatches([]);
        setProgress(0);

        try {
            const phashes: string[] = [];
            // ... (batch generation logic)
            if (isBatchScan) {
                const window = parseInt(scanWindowStr, 10);
                const increment = parseInt(scanIncrementStr, 10);

                if (isNaN(window) || isNaN(increment) || increment <= 0) {
                    Toast.error("Invalid batch scan parameters");
                    setChecking(false);
                    return;
                }

                const starts: number[] = [];
                let currentStart = startPoint - window;
                const limitStr = startPoint + window;

                if (currentStart < 0) currentStart = 0;

                while (currentStart <= limitStr) {
                    starts.push(currentStart);
                    currentStart += increment;
                }

                if (!starts.includes(startPoint)) {
                    starts.push(startPoint);
                    starts.sort((a, b) => a - b);
                }

                setTotalProgress(starts.length);

                for (const s of starts) {
                    try {
                        const res = await generatePhash({
                            variables: {
                                file_id: fileId,
                                start: s,
                                duration: duration
                            }
                        });
                        if (res.data?.generatePhash) {
                            phashes.push(res.data.generatePhash);
                        }
                    } catch (err) {
                        console.error("Failed to generate phash for start", s, err);
                    }
                    setProgress(prev => prev + 1);
                }
            } else {
                setTotalProgress(1);
                const phashRes = await generatePhash({
                    variables: {
                        file_id: fileId,
                        start: startPoint,
                        duration: duration
                    }
                });
                if (phashRes.data?.generatePhash) {
                    phashes.push(phashRes.data.generatePhash);
                }
                setProgress(1);
            }

            if (phashes.length === 0) {
                Toast.error("Could not generate any phashes");
                setChecking(false);
                return;
            }

            const searchRes = await searchByPhash({
                variables: { phashes }
            });

            if (searchRes.data?.stashDbSearchByPhash) {
                setMatches(searchRes.data.stashDbSearchByPhash);
                setShowMatches(true);
                if (searchRes.data.stashDbSearchByPhash.length === 0) {
                    Toast.success("No StashDB matches found");
                }
            }
        } catch (e) {
            Toast.error(e);
        } finally {
            setChecking(false);
        }
    };


    const handleSave = async () => {
        if (!title) {
            Toast.error("Title is required");
            return;
        }

        const startPoint = TextUtils.timestampToSeconds(startPointStr);
        const endPoint = TextUtils.timestampToSeconds(endPointStr);

        if ((startPointStr && startPoint === null) || (endPointStr && endPoint === null)) {
            Toast.error("Invalid duration format");
            return;
        }

        try {
            const input: GQL.SceneCreateInput = {
                title,
                file_ids: [fileId],
                start_point: startPoint,
                end_point: endPoint,
            };

            const result = await createScene({ variables: { input } });
            if (result.data?.sceneCreate?.id) {
                Toast.success("Scene segment created");
                onSuccess(result.data.sceneCreate.id);
            }
        } catch (e) {
            Toast.error(e);
        }
    };


    return (
        <>
            <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
                <DialogTitle>Create Scene Segment</DialogTitle>
                <DialogContent>
                    <Box component="form" sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                        <TextField
                            label="Title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Enter title"
                            fullWidth
                        />
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 6 }}>
                                <TextField
                                    label="Start Point (MM:SS)"
                                    value={startPointStr}
                                    onChange={(e) => setStartPointStr(e.target.value)}
                                    placeholder="0"
                                    fullWidth
                                />
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <TextField
                                    label="End Point (MM:SS)"
                                    value={endPointStr}
                                    onChange={(e) => setEndPointStr(e.target.value)}
                                    placeholder="MM:SS"
                                    fullWidth
                                />
                            </Grid>
                        </Grid>

                        <Box display="flex" alignItems="center">
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={isBatchScan}
                                        onChange={(e) => setIsBatchScan(e.target.checked)}
                                        id="batch-scan-toggle"
                                    />
                                }
                                label="Fuzzy Scan"
                            />
                        </Box>

                        {isBatchScan && (
                            <Grid container spacing={2}>
                                <Grid size={{ xs: 6 }}>
                                    <TextField
                                        label="Window (+/- sec)"
                                        type="number"
                                        value={scanWindowStr}
                                        onChange={(e) => setScanWindowStr(e.target.value)}
                                        fullWidth
                                    />
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <TextField
                                        label="Increment (sec)"
                                        type="number"
                                        value={scanIncrementStr}
                                        onChange={(e) => setScanIncrementStr(e.target.value)}
                                        fullWidth
                                    />
                                </Grid>
                            </Grid>
                        )}

                        <Button
                            variant="outlined"
                            size="small"
                            onClick={handleCheckMatches}
                            disabled={checking}
                            sx={{ alignSelf: 'flex-start' }}
                        >
                            {checking ? `Scanning ${progress}/${totalProgress}...` : "Check Matches"}
                        </Button>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} color="inherit">
                        Cancel
                    </Button>
                    <Button onClick={handleSave} variant="contained" color="primary">
                        Create
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={showMatches} onClose={() => setShowMatches(false)} maxWidth="lg" fullWidth>
                <DialogTitle>Potential Matches</DialogTitle>
                <DialogContent>
                    {matches.length === 0 ? (
                        <Typography>No matches found.</Typography>
                    ) : (
                        <List>
                            {matches.map((m, idx) => (
                                <ListItem key={idx} divider alignItems="flex-start">
                                    <ListItemText
                                        primary={
                                            <Box display="flex" justifyContent="space-between">
                                                <Typography variant="h6">{m.title}</Typography>
                                                {m.image && <img src={m.image} alt="thumb" style={{ height: 60 }} />}
                                            </Box>
                                        }
                                        secondary={
                                            <React.Fragment>
                                                <Typography variant="body2" color="textPrimary" display="block">
                                                    {m.details?.substring(0, 100)}...
                                                </Typography>
                                                <Typography variant="caption" display="block">
                                                    {m.date} - {m.studio?.name}
                                                </Typography>
                                                <Button size="small" onClick={() => setTitle(m.title || "")}>
                                                    Use Title
                                                </Button>
                                            </React.Fragment>
                                        }
                                    />
                                </ListItem>
                            ))}
                        </List>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowMatches(false)}>Close</Button>
                </DialogActions>
            </Dialog>
        </>
    );

};
