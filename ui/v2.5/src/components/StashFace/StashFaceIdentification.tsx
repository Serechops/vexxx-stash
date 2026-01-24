import React, { useState, useEffect } from "react";
import {
    Box,
    Card,
    CardContent,
    Typography,
    Button,
    Chip,
    Avatar,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    CircularProgress,
    Alert,
    Tooltip,
    IconButton,
    Badge,
    Link,
    LinearProgress,
    Tabs,
    Tab,
} from "@mui/material";
import {
    Face as FaceIcon,
    Visibility as VisibilityIcon,
    Close as CloseIcon,
    OpenInNew as OpenInNewIcon,
    Person as PersonIcon,
    Search as SearchIcon,
    CheckCircle as CheckCircleIcon,
    Info as InfoIcon,
    Psychology as PsychologyIcon,
} from "@mui/icons-material";
import { useTheme } from "@mui/material/styles";
import * as GQL from "src/core/generated-graphql";

// Types
interface StashFaceServiceStatus {
    status: "available" | "unavailable" | "error";
    message?: string;
    error?: string;
}

interface PerformerMatch {
    id?: string;
    name: string;
    image?: string;
    country?: string;
    performer_url?: string;
    stashdb_id?: string;
    confidence: number;
}

interface FaceResult {
    timestamp: string;
    confidence: number;
    bbox?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    performer_match?: string;
    stashdb_id?: string;
    performers?: PerformerMatch[];
}

interface IdentificationResult {
    faces?: FaceResult[];
    faces_found?: number;
    error?: string;
    processing_info?: {
        sprite_dimensions?: {
            width: number;
            height: number;
        };
        vtt_entries_processed?: number;
    };
}

/**
 * StashFace API Service
 */
class StashFaceService {
    static async checkStatus(): Promise<StashFaceServiceStatus> {
        try {
            const response = await fetch("/stashface/status");
            return await response.json();
        } catch (error: any) {
            console.error("StashFace status check failed:", error);
            return { status: "error", error: error.message };
        }
    }

    static async identifyPerformersInSprite(spriteUrl: string, vttUrl: string) {
        try {
            const formData = new FormData();

            // Fetch sprite image as blob
            const spriteResponse = await fetch(spriteUrl);
            if (!spriteResponse.ok) {
                throw new Error(`Failed to fetch sprite: ${spriteResponse.statusText}`);
            }
            const spriteBlob = await spriteResponse.blob();
            formData.append("image", spriteBlob, "sprite.jpg");

            // Fetch VTT file as blob
            const vttResponse = await fetch(vttUrl);
            if (!vttResponse.ok) {
                throw new Error(`Failed to fetch VTT: ${vttResponse.statusText}`);
            }
            const vttBlob = await vttResponse.blob();
            formData.append("vtt_file", vttBlob, "sprite.vtt");

            const response = await fetch("/stashface/identify", { // Updated endpoint to match backend
                method: "POST",
                body: formData,
            });

            return await response.json();
        } catch (error: any) {
            console.error("StashFace sprite identification failed:", error);
            return { success: false, error: error.message };
        }
    }

    static async generateCandidates(sceneId: string, numFrames: number = 20) {
        try {
            const response = await fetch("/stashface/candidates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scene_id: sceneId, num_frames: numFrames }),
            });
            return await response.json();
        } catch (error: any) {
            console.error("Failed to generate candidates:", error);
            throw error;
        }
    }

    static async generateSprite(filenames: string[]) {
        try {
            const response = await fetch("/stashface/generate_sprite", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filenames }),
            });
            return await response.json();
        } catch (error: any) {
            console.error("Failed to generate sprite:", error);
            throw error;
        }
    }

    static async identifyGeneratedSprite(spritePath: string, vttPath: string) {
        try {
            const response = await fetch("/stashface/identify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image_path: spritePath, vtt_path: vttPath }),
            });
            return await response.json();
        } catch (error: any) {
            console.error("Identify generated failed:", error);
            throw error;
        }
    }

    static async identifyScreenshot(sceneId: string) {
        try {
            const response = await fetch("/stashface/identify_screenshot", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scene_id: sceneId }),
            });

            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                return await response.json();
            } else {
                const text = await response.text();
                return { success: false, error: text || `Server returned ${response.status} ${response.statusText}` };
            }
        } catch (error: any) {
            console.error("Identify screenshot failed:", error);
            return { success: false, error: error.message };
        }
    }
}

/**
 * MegaFace API Service - Second Opinion Performer Identification
 */
interface MegaFaceServiceStatus {
    status: "available" | "unavailable" | "error";
    message?: string;
}

interface MegaFaceIdentifyResponse {
    success: boolean;
    result?: string; // HTML output from MegaFace
    error?: string;
}

class MegaFaceService {
    static async checkStatus(): Promise<MegaFaceServiceStatus> {
        try {
            const response = await fetch("/megaface/status");
            return await response.json();
        } catch (error: any) {
            console.error("MegaFace status check failed:", error);
            return { status: "error", message: error.message };
        }
    }

    static async identifyFromScreenshot(imageBlob: Blob): Promise<MegaFaceIdentifyResponse> {
        try {
            const formData = new FormData();
            formData.append("image", imageBlob, "screenshot.jpg");

            const response = await fetch("/megaface/identify", {
                method: "POST",
                body: formData,
            });

            return await response.json();
        } catch (error: any) {
            console.error("MegaFace identify failed:", error);
            return { success: false, error: error.message };
        }
    }

    static async identifyFromUrl(imageUrl: string): Promise<MegaFaceIdentifyResponse> {
        try {
            // Fetch the image first
            const imageResponse = await fetch(imageUrl);
            if (!imageResponse.ok) {
                throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
            }
            const imageBlob = await imageResponse.blob();
            return await MegaFaceService.identifyFromScreenshot(imageBlob);
        } catch (error: any) {
            console.error("MegaFace identify from URL failed:", error);
            return { success: false, error: error.message };
        }
    }
}

interface FaceDetectionCardProps {
    face: FaceResult;
    index: number;
    onViewDetails: (face: FaceResult) => void;
}

const FaceDetectionCard: React.FC<FaceDetectionCardProps> = ({ face, index, onViewDetails }) => {
    const theme = useTheme();

    // Handle different response structures (gradio vs backend mapped)
    const bestMatch = face.performers && face.performers.length > 0 ? face.performers[0] : null;
    const matchName = face.performer_match || bestMatch?.name;
    const stashId = face.stashdb_id || bestMatch?.id; // Note: check if 'id' or 'stashdb_id' is in performer object

    return (
        <Card sx={{ mb: 2, border: `1px solid ${theme.palette.primary.main}` }}>
            <CardContent sx={{ p: 2 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
                    <Badge
                        badgeContent={index + 1}
                        color="primary"
                        sx={{ "& .MuiBadge-badge": { fontSize: "0.75rem" } }}
                    >
                        <FaceIcon color="primary" />
                    </Badge>
                    <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                        Face Detection #{index + 1}
                    </Typography>
                    {face.timestamp && (
                        <Chip
                            label={`${face.timestamp}`}
                            size="small"
                            color="primary"
                            variant="outlined"
                        />
                    )}
                </Box>

                <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                        <strong>Confidence:</strong> {(face.confidence * 100).toFixed(1)}%
                    </Typography>
                    {face.bbox && (
                        <Typography variant="body2" color="text.secondary">
                            <strong>Position:</strong> {face.bbox.x}, {face.bbox.y} (
                            {face.bbox.width}×{face.bbox.height})
                        </Typography>
                    )}
                </Box>

                {matchName && (
                    <Alert severity="success" sx={{ mb: 2 }} icon={<CheckCircleIcon />}>
                        <Box sx={{ display: "flex", alignItems: "center" }}>
                            {bestMatch?.image && (
                                <Avatar
                                    src={bestMatch.image}
                                    alt={matchName}
                                    sx={{ width: 80, height: 80, mr: 2 }}
                                />
                            )}
                            <Typography variant="body2">
                                <strong>Match Found:</strong> {matchName}
                                {stashId && (
                                    <Link
                                        href={`https://stashdb.org/performers/${stashId}`}
                                        target="_blank"
                                        sx={{ ml: 1 }}
                                    >
                                        View StashDB
                                    </Link>
                                )}
                            </Typography>
                        </Box>
                    </Alert>
                )}

                <Button
                    size="small"
                    startIcon={<VisibilityIcon />}
                    onClick={() => onViewDetails(face)}
                    sx={{ textTransform: "none" }}
                >
                    View Details
                </Button>
            </CardContent>
        </Card>
    );
};

interface StashFaceIdentificationProps {
    scene: GQL.SceneDataFragment;
    onPerformerIdentified?: (results: any) => void;
    sx?: object;
}

export const StashFaceIdentification: React.FC<StashFaceIdentificationProps> = ({
    scene,
    onPerformerIdentified,
    sx = {},
}) => {
    const theme = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [serviceStatus, setServiceStatus] = useState<StashFaceServiceStatus | null>(null);
    const [results, setResults] = useState<IdentificationResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedFace, setSelectedFace] = useState<FaceResult | null>(null);

    // Smart Frame Selection
    const [candidates, setCandidates] = useState<string[]>([]);
    const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
    const [showCandidateDialog, setShowCandidateDialog] = useState(false);
    const [generating, setGenerating] = useState(false);

    // MegaFace state
    const [megafaceStatus, setMegafaceStatus] = useState<MegaFaceServiceStatus | null>(null);
    const [megafaceLoading, setMegafaceLoading] = useState(false);
    const [megafaceResult, setMegafaceResult] = useState<string | null>(null);
    const [megafaceError, setMegafaceError] = useState<string | null>(null);
    const [resultsTab, setResultsTab] = useState(0);

    // Check if scene has sprite and VTT files
    const hasRequiredFiles = scene?.paths?.sprite && scene?.paths?.vtt;

    // Check service statuses on mount
    useEffect(() => {
        checkServiceStatus();
        checkMegafaceStatus();
    }, []);

    const checkServiceStatus = async () => {
        const status = await StashFaceService.checkStatus();
        setServiceStatus(status);
    };

    const checkMegafaceStatus = async () => {
        const status = await MegaFaceService.checkStatus();
        setMegafaceStatus(status);
    };

    const handleMegafaceIdentify = async () => {
        if (!scene?.paths?.screenshot) {
            setMegafaceError("No screenshot available for this scene");
            return;
        }

        setMegafaceLoading(true);
        setMegafaceError(null);
        setMegafaceResult(null);

        try {
            const result = await MegaFaceService.identifyFromUrl(scene.paths.screenshot);
            if (result.success && result.result) {
                setMegafaceResult(result.result);
                setResultsTab(1); // Switch to MegaFace tab
                setIsOpen(true);
            } else {
                setMegafaceError(result.error || "Failed to identify with MegaFace");
            }
        } catch (err: any) {
            setMegafaceError(err.message);
        } finally {
            setMegafaceLoading(false);
        }
    };

    const handleViewStashDB = (url: string) => {
        window.open(url, "_blank");
    };

    const handleViewFaceDetails = (face: FaceResult) => {
        setSelectedFace(face);
    };

    const handleGenerateCandidates = async () => {
        setGenerating(true);
        setError(null);
        try {
            const result = await StashFaceService.generateCandidates(scene.id, 20);
            if (result.filenames) {
                setCandidates(result.filenames);
                setSelectedCandidates([]); // Reset selection
                setShowCandidateDialog(true);
            } else {
                setError("No candidates returned");
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setGenerating(false);
        }
    };

    const toggleCandidateSelection = (filename: string) => {
        setSelectedCandidates(prev =>
            prev.includes(filename)
                ? prev.filter(f => f !== filename)
                : [...prev, filename]
        );
    };

    const handleIdentifySelected = async () => {
        if (selectedCandidates.length === 0) return;

        setShowCandidateDialog(false);
        setLoading(true);
        setError(null);
        setResults(null);

        try {
            // 1. Generate Sprite
            const spriteInfo = await StashFaceService.generateSprite(selectedCandidates);
            if (!spriteInfo.sprite_path || !spriteInfo.vtt_path) {
                throw new Error("Failed to generate sprite info");
            }

            // 2. Identify
            const result = await StashFaceService.identifyGeneratedSprite(
                spriteInfo.sprite_path,
                spriteInfo.vtt_path
            );

            if (result.success) {
                setResults(result.result);
                // Force open results
                setIsOpen(true);
            } else {
                setError(result.error || "Failed to identify performers");
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleIdentifyScreenshot = async () => {
        setLoading(true);
        setError(null);
        setResults(null);

        try {
            const result = await StashFaceService.identifyScreenshot(scene.id);
            if (result.success) {
                setResults(result.result);
                // Force open results
                setIsOpen(true);
            } else {
                setError(result.error || "Failed to identify performers from screenshot");
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };


    if (!hasRequiredFiles && !serviceStatus) {
        // Show minimal placeholder or nothing? 
        // If we allow smart generation, we should show the UI even if no sprite exists.
        // But we need scene to exist.
        // Let's rely on the button inside being the entry point if no files.
    }

    return (
        <>
            <Box sx={{ mt: 2, ...sx }}>
                <Card
                    sx={{
                        border: `1px solid ${theme.palette.primary.main}`,
                        borderRadius: 2,
                        background: `linear-gradient(135deg, ${theme.palette.primary.main}08, ${theme.palette.background.paper})`,
                    }}
                >
                    <CardContent sx={{ p: 2 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
                            <FaceIcon color="primary" />
                            <Typography
                                variant="h6"
                                sx={{ fontSize: "1.1rem", fontWeight: 600 }}
                            >
                                AI Performer Identification
                            </Typography>
                            <Chip
                                label="StashFace"
                                size="small"
                                color="primary"
                                variant="outlined"
                            />
                            <Chip
                                label="MegaFace"
                                size="small"
                                color="secondary"
                                variant="outlined"
                            />
                        </Box>

                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Identify performers using AI face recognition. Use StashFace for
                            primary detection and MegaFace as a second opinion.
                        </Typography>



                        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                            <Button
                                variant="contained"
                                onClick={handleGenerateCandidates}
                                startIcon={<SearchIcon />}
                                disabled={generating || loading || serviceStatus?.status !== "available"}
                                sx={{ textTransform: "none" }}
                            >
                                {generating ? "Generating..." : "Smart Frame Selection"}
                            </Button>

                            <Button
                                variant="outlined"
                                size="small"
                                onClick={handleIdentifyScreenshot}
                                disabled={loading || serviceStatus?.status !== "available"}
                                title="Use scene screenshot/cover for StashFace identification"
                            >
                                {loading ? "Scanning..." : "StashFace Screenshot"}
                            </Button>

                            <Button
                                variant="outlined"
                                color="secondary"
                                size="small"
                                onClick={handleMegafaceIdentify}
                                startIcon={<PsychologyIcon />}
                                disabled={megafaceLoading || megafaceStatus?.status !== "available" || !scene?.paths?.screenshot}
                                title="Get a second opinion using MegaFace"
                            >
                                {megafaceLoading ? "Analyzing..." : "MegaFace (2nd Opinion)"}
                            </Button>

                            {(results || megafaceResult) && (
                                <Button
                                    variant="outlined"
                                    startIcon={<VisibilityIcon />}
                                    onClick={() => setIsOpen(true)}
                                    sx={{ textTransform: "none" }}
                                >
                                    View Results
                                </Button>
                            )}

                            <Tooltip title={`StashFace: ${serviceStatus?.status || "checking..."}, MegaFace: ${megafaceStatus?.status || "checking..."}`}>
                                <IconButton size="small">
                                    {serviceStatus?.status === "available" && megafaceStatus?.status === "available" ? (
                                        <CheckCircleIcon color="success" />
                                    ) : (
                                        <InfoIcon color="warning" />
                                    )}
                                </IconButton>
                            </Tooltip>
                        </Box>

                        {error && (
                            <Alert severity="error" sx={{ mt: 2 }}>
                                {error}
                            </Alert>
                        )}

                        {megafaceError && (
                            <Alert severity="error" sx={{ mt: 2 }}>
                                MegaFace: {megafaceError}
                            </Alert>
                        )}

                        {serviceStatus?.status !== "available" && (
                            <Alert severity="warning" sx={{ mt: 2 }}>
                                StashFace service is not available: {serviceStatus?.message}
                            </Alert>
                        )}

                        {megafaceStatus?.status !== "available" && megafaceStatus && (
                            <Alert severity="info" sx={{ mt: 2 }}>
                                MegaFace service is not available: {megafaceStatus?.message}
                            </Alert>
                        )}
                    </CardContent>
                </Card>
            </Box>

            {/* Results Dialog */}
            <Dialog
                open={isOpen}
                onClose={() => setIsOpen(false)}
                maxWidth="lg"
                fullWidth
                PaperProps={{
                    sx: {
                        maxHeight: "90vh",
                        borderRadius: 2,
                    },
                }}
            >
                <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <FaceIcon color="primary" />
                    <Typography variant="h5" sx={{ flex: 1, fontWeight: 600 }}>
                        AI Performer Identification Results
                    </Typography>
                    <IconButton onClick={() => setIsOpen(false)}>
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>

                <DialogContent dividers sx={{ p: 0 }}>
                    {/* Tabs for StashFace and MegaFace results */}
                    <Tabs
                        value={resultsTab}
                        onChange={(_, newValue) => setResultsTab(newValue)}
                        sx={{ borderBottom: 1, borderColor: "divider", px: 2 }}
                    >
                        <Tab
                            label={`StashFace ${results?.faces?.length ? `(${results.faces.length})` : ""}`}
                            icon={<FaceIcon />}
                            iconPosition="start"
                        />
                        <Tab
                            label={`MegaFace ${megafaceResult ? "(1)" : ""}`}
                            icon={<PsychologyIcon />}
                            iconPosition="start"
                        />
                    </Tabs>

                    <Box sx={{ p: 3 }}>
                        {/* StashFace Tab */}
                        {resultsTab === 0 && (
                            <>
                                {results?.error ? (
                                    <Box>
                                        <Alert severity="warning" sx={{ mb: 3 }}>
                                            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                                                Identification Issue
                                            </Typography>
                                            <Typography variant="body2">
                                                {results.error}
                                            </Typography>
                                        </Alert>
                                    </Box>
                                ) : results ? (
                                    <Box>
                                        <Alert severity="success" sx={{ mb: 3 }}>
                                            <Typography variant="body2">
                                                <strong>Analysis Complete!</strong> Found{" "}
                                                {results.faces_found || results.faces?.length || 0} faces in
                                                the sprite image.
                                            </Typography>
                                        </Alert>

                                        {results.faces?.map((face, index) => (
                                            <FaceDetectionCard
                                                key={index}
                                                face={face}
                                                index={index}
                                                onViewDetails={handleViewFaceDetails}
                                            />
                                        ))}

                                        {results.processing_info && (
                                            <Card sx={{ mt: 2, backgroundColor: theme.palette.grey[50] }}>
                                                <CardContent sx={{ p: 2 }}>
                                                    <Typography variant="h6" sx={{ fontSize: "1rem", mb: 1 }}>
                                                        Processing Information
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Sprite Dimensions:{" "}
                                                        {results.processing_info.sprite_dimensions?.width}×
                                                        {results.processing_info.sprite_dimensions?.height}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        VTT Entries Processed:{" "}
                                                        {results.processing_info.vtt_entries_processed}
                                                    </Typography>
                                                </CardContent>
                                            </Card>
                                        )}
                                    </Box>
                                ) : (
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        textAlign="center"
                                    >
                                        No StashFace results yet. Use "Smart Frame Selection" or "StashFace Screenshot" to analyze.
                                    </Typography>
                                )}
                            </>
                        )}

                        {/* MegaFace Tab */}
                        {resultsTab === 1 && (
                            <>
                                {megafaceResult ? (
                                    <Box>
                                        <Alert severity="info" sx={{ mb: 3 }}>
                                            <Typography variant="body2">
                                                <strong>MegaFace Analysis Complete!</strong> Results from cc1234/megaface on Hugging Face.
                                            </Typography>
                                        </Alert>
                                        <Card>
                                            <CardContent>
                                                <Typography variant="h6" sx={{ mb: 2 }}>
                                                    MegaFace Performer Matches
                                                </Typography>
                                                {/* Render HTML from MegaFace safely */}
                                                <Box
                                                    sx={{
                                                        "& img": { maxWidth: "100%", height: "auto", borderRadius: 1 },
                                                        "& a": { color: theme.palette.primary.main },
                                                        "& table": { width: "100%", borderCollapse: "collapse" },
                                                        "& td, & th": { p: 1, border: `1px solid ${theme.palette.divider}` },
                                                    }}
                                                    dangerouslySetInnerHTML={{ __html: megafaceResult }}
                                                />
                                            </CardContent>
                                        </Card>
                                    </Box>
                                ) : (
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        textAlign="center"
                                    >
                                        No MegaFace results yet. Click "MegaFace (2nd Opinion)" to get an alternative identification.
                                    </Typography>
                                )}
                            </>
                        )}
                    </Box>
                </DialogContent>

                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={() => setIsOpen(false)}>Close</Button>
                </DialogActions>
            </Dialog>

            {/* Frame Selection Dialog */}
            <Dialog
                open={showCandidateDialog}
                onClose={() => setShowCandidateDialog(false)}
                maxWidth="lg"
                fullWidth
            >
                <DialogTitle>Select Frames for Identification</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        Select clear, front-facing shots of performers. Avoid blurry or distant shots.
                        Selected: {selectedCandidates.length}
                    </Typography>

                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 2 }}>
                        {candidates.map((filename, index) => (
                            <Card
                                key={filename}
                                sx={{
                                    cursor: 'pointer',
                                    border: selectedCandidates.includes(filename) ? `3px solid ${theme.palette.primary.main}` : '1px solid transparent',
                                    opacity: selectedCandidates.includes(filename) ? 1 : 0.7,
                                    '&:hover': { opacity: 1 },
                                    position: 'relative'
                                }}
                                onClick={() => toggleCandidateSelection(filename)}
                            >
                                <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                    <img
                                        src={`/stashface/candidates/${filename}`}
                                        alt={`Candidate ${index}`}
                                        style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }}
                                    />
                                    {selectedCandidates.includes(filename) && (
                                        <Box sx={{ position: 'absolute', top: 5, right: 5, bgcolor: 'background.paper', borderRadius: '50%' }}>
                                            <CheckCircleIcon color="primary" />
                                        </Box>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowCandidateDialog(false)}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleIdentifySelected}
                        disabled={selectedCandidates.length === 0}
                    >
                        Identify Selected ({selectedCandidates.length})
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Face Details Dialog */}
            <Dialog
                open={!!selectedFace}
                onClose={() => setSelectedFace(null)}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle>Face Detection Details</DialogTitle>
                <DialogContent dividers>
                    {selectedFace && (
                        <Box>
                            <Typography variant="body1" sx={{ mb: 2 }}>
                                <strong>Timestamp:</strong> {selectedFace.timestamp}
                            </Typography>
                            <Typography variant="body1" sx={{ mb: 2 }}>
                                <strong>Detection Confidence:</strong>{" "}
                                {(selectedFace.confidence * 100).toFixed(1)}%
                            </Typography>
                            {selectedFace.bbox && (
                                <Typography variant="body1" sx={{ mb: 2 }}>
                                    <strong>Bounding Box:</strong> Position ({selectedFace.bbox.x}
                                    , {selectedFace.bbox.y}), Size {selectedFace.bbox.width}×
                                    {selectedFace.bbox.height}
                                </Typography>
                            )}
                            {selectedFace.performer_match && (
                                <Alert severity="success">
                                    <Typography variant="body2">
                                        <strong>Performer Match:</strong>{" "}
                                        {selectedFace.performer_match}
                                    </Typography>
                                    {selectedFace.stashdb_id && (
                                        <Button
                                            size="small"
                                            startIcon={<OpenInNewIcon />}
                                            onClick={() =>
                                                handleViewStashDB(
                                                    `https://stashdb.org/performers/${selectedFace.stashdb_id}`
                                                )
                                            }
                                            sx={{ mt: 1, textTransform: "none" }}
                                        >
                                            View in StashDB
                                        </Button>
                                    )}
                                </Alert>
                            )}
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSelectedFace(null)}>Close</Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
