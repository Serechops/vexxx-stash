import React, { useState, useMemo } from "react";
import {
    Button,
    Box,
    Divider,
    Typography,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Chip,
    IconButton,
    Tooltip,
    CircularProgress,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
} from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { CreateSceneSegmentPanel } from "./CreateSceneSegmentPanel";
import { Link } from "react-router-dom";
import AddIcon from "@mui/icons-material/Add";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import TextUtils from "src/utils/text";

interface IProps {
    scene: GQL.SceneDataFragment;
    getPlayerTimestamp?: () => number;
}

export const SceneSegmentsPanel: React.FC<IProps> = ({ scene, getPlayerTimestamp }) => {
    const intl = useIntl();
    const [showCreatePanel, setShowCreatePanel] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const [destroyScene] = GQL.useSceneDestroyMutation();

    const file = scene.files?.[0];

    // Query for sibling scenes (scenes sharing the same file)
    // We filter by the file path to find all scenes using this video file
    const { data: siblingData, loading: siblingsLoading, refetch } = GQL.useFindScenesQuery({
        variables: {
            filter: {
                per_page: 100,
                sort: "created_at",
                direction: GQL.SortDirectionEnum.Asc,
            },
            scene_filter: {
                files_filter: {
                    path: {
                        value: file?.path ?? "",
                        modifier: GQL.CriterionModifier.Equals,
                    },
                },
            },
        },
        skip: !file?.path,
    });

    // Filter out the current scene and identify segments (scenes with start/end points)
    const segments = useMemo(() => {
        if (!siblingData?.findScenes?.scenes) return [];

        return siblingData.findScenes.scenes
            .filter((s) => {
                // Include scenes that have start_point or end_point set (segments)
                // OR include all sibling scenes except the "parent" (one without segment points)
                // A segment is defined by having start_point or end_point
                const hasSegmentPoints =
                    (s.start_point !== null && s.start_point !== undefined && s.start_point > 0) ||
                    (s.end_point !== null && s.end_point !== undefined && s.end_point > 0 && s.end_point < (file?.duration ?? Infinity));

                return hasSegmentPoints;
            })
            .sort((a, b) => {
                // Sort by start_point
                const aStart = a.start_point ?? 0;
                const bStart = b.start_point ?? 0;
                return aStart - bStart;
            });
    }, [siblingData, file?.duration]);

    // The parent/source scene (no segment points, or the current scene)
    const parentScene = useMemo(() => {
        if (!siblingData?.findScenes?.scenes) return scene;

        const nonSegment = siblingData.findScenes.scenes.find((s) => {
            const hasSegmentPoints =
                (s.start_point !== null && s.start_point !== undefined && s.start_point > 0) ||
                (s.end_point !== null && s.end_point !== undefined && s.end_point > 0 && s.end_point < (file?.duration ?? Infinity));
            return !hasSegmentPoints;
        });

        return nonSegment ?? scene;
    }, [siblingData, scene, file?.duration]);

    if (!file) {
        return (
            <Box p={2}>
                <Typography color="text.secondary">
                    No video file associated with this scene.
                </Typography>
            </Box>
        );
    }

    const formatDuration = (start?: number | null, end?: number | null): string => {
        const s = start ?? 0;
        const e = end ?? file.duration ?? 0;
        return `${TextUtils.secondsToTimestamp(s)} - ${TextUtils.secondsToTimestamp(e)}`;
    };

    const getSegmentDuration = (start?: number | null, end?: number | null): number => {
        const s = start ?? 0;
        const e = end ?? file.duration ?? 0;
        return e - s;
    };

    const handleCreateSuccess = (id: string) => {
        setShowCreatePanel(false);
        refetch();
    };

    const labelSx = {
        color: "text.secondary",
        width: "1%",
        whiteSpace: "nowrap",
        border: 0,
        py: 0.5,
        pl: 0,
        pr: 2,
    } as const;

    const valueSx = { border: 0, py: 0.5 } as const;

    return (
        <Box className="scene-segments-panel" p={2}>
            {/* Header */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h5">
                    <FormattedMessage id="segments" defaultMessage="Segments" />
                </Typography>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => setShowCreatePanel(!showCreatePanel)}
                    size="small"
                >
                    <FormattedMessage id="actions.create_segment" defaultMessage="Create Segment" />
                </Button>
            </Box>

            {/* Source File Info */}
            <Box mb={3}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
                    <FormattedMessage id="source_file" defaultMessage="Source File" />
                </Typography>
                <Divider sx={{ mb: 1 }} />
                <Table size="small">
                    <TableBody>
                        <TableRow>
                            <TableCell sx={labelSx}>
                                <FormattedMessage id="path" defaultMessage="Path" />
                            </TableCell>
                            <TableCell sx={{ ...valueSx, wordBreak: "break-all" }}>
                                {file.path}
                            </TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell sx={labelSx}>
                                <FormattedMessage id="duration" defaultMessage="Duration" />
                            </TableCell>
                            <TableCell sx={valueSx}>
                                {TextUtils.secondsToTimestamp(file.duration ?? 0)}
                            </TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell sx={labelSx}>
                                <FormattedMessage id="resolution" defaultMessage="Resolution" />
                            </TableCell>
                            <TableCell sx={valueSx}>
                                {file.width}x{file.height}
                            </TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell sx={labelSx}>
                                <FormattedMessage id="video_codec" defaultMessage="Codec" />
                            </TableCell>
                            <TableCell sx={valueSx}>
                                {file.video_codec}
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </Box>

            {/* Create Segment Panel */}
            {showCreatePanel && (
                <Box mb={3}>
                    <CreateSceneSegmentPanel
                        fileId={file.id}
                        fileDuration={file.duration}
                        getPlayerTimestamp={getPlayerTimestamp}
                        onSuccess={handleCreateSuccess}
                    />
                </Box>
            )}

            {/* Visual Timeline */}
            {segments.length > 0 && file.duration != null && file.duration > 0 && (
                <Box mb={3}>
                    <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
                        <FormattedMessage id="segment_timeline" defaultMessage="Segment Timeline" />
                    </Typography>
                    <Divider sx={{ mb: 1 }} />
                    <Box
                        sx={{
                            position: "relative",
                            height: 28,
                            bgcolor: "action.hover",
                            borderRadius: 1,
                            overflow: "hidden",
                        }}
                    >
                        {segments.map((seg) => {
                            const total = file.duration!;
                            const start = seg.start_point ?? 0;
                            const end = seg.end_point ?? total;
                            const leftPct = (start / total) * 100;
                            const widthPct = ((end - start) / total) * 100;
                            const isCurrent = seg.id === scene.id;
                            return (
                                <Tooltip
                                    key={seg.id}
                                    title={`${seg.title || seg.id}: ${TextUtils.secondsToTimestamp(start)} – ${TextUtils.secondsToTimestamp(end)}`}
                                >
                                    <Box
                                        component={Link}
                                        to={`/scenes/${seg.id}`}
                                        sx={{
                                            position: "absolute",
                                            top: 2,
                                            bottom: 2,
                                            left: `${leftPct}%`,
                                            width: `${widthPct}%`,
                                            minWidth: 3,
                                            bgcolor: isCurrent ? "primary.main" : "primary.dark",
                                            borderRadius: 0.5,
                                            opacity: isCurrent ? 1 : 0.65,
                                            border: isCurrent ? "1px solid" : "none",
                                            borderColor: "primary.light",
                                            "&:hover": { opacity: 1 },
                                            textDecoration: "none",
                                        }}
                                    />
                                </Tooltip>
                            );
                        })}
                    </Box>
                    <Box display="flex" justifyContent="space-between" mt={0.5}>
                        <Typography variant="caption" color="text.secondary">0:00</Typography>
                        <Typography variant="caption" color="text.secondary">
                            {TextUtils.secondsToTimestamp(file.duration)}
                        </Typography>
                    </Box>
                </Box>
            )}

            {/* Segments List */}
            {siblingsLoading ? (
                <Box display="flex" justifyContent="center" p={4}>
                    <CircularProgress />
                </Box>
            ) : segments.length === 0 ? (
                <Box p={4} textAlign="center" sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
                    <Typography color="text.secondary">
                        <FormattedMessage
                            id="no_segments"
                            defaultMessage="No segments created yet. Click 'Create Segment' to define a portion of this video as a separate scene."
                        />
                    </Typography>
                </Box>
            ) : (
                <TableContainer component={Paper} sx={{ overflowX: "auto" }}>
                    <Table size="small" sx={{ minWidth: 560 }}>
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ width: "35%" }}>
                                    <FormattedMessage id="title" defaultMessage="Title" />
                                </TableCell>
                                <TableCell sx={{ whiteSpace: "nowrap", width: "18%" }}>
                                    <FormattedMessage id="time_range" defaultMessage="Time Range" />
                                </TableCell>
                                <TableCell sx={{ whiteSpace: "nowrap", width: "10%" }}>
                                    <FormattedMessage id="duration" defaultMessage="Duration" />
                                </TableCell>
                                <TableCell sx={{ width: "15%" }}>
                                    <FormattedMessage id="studio" defaultMessage="Studio" />
                                </TableCell>
                                <TableCell>
                                    <FormattedMessage id="tags" defaultMessage="Tags" />
                                </TableCell>
                                <TableCell sx={{ whiteSpace: "nowrap", width: "1%" }} align="right">
                                    <FormattedMessage id="actions" defaultMessage="Actions" />
                                </TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {segments.map((segment) => (
                                <TableRow
                                    key={segment.id}
                                    hover
                                    sx={{
                                        bgcolor: segment.id === scene.id ? 'action.selected' : undefined,
                                    }}
                                >
                                    <TableCell>
                                        <Box display="flex" alignItems="center" gap={1}>
                                            <Link
                                                to={`/scenes/${segment.id}`}
                                                style={{ textDecoration: 'none', color: 'inherit', minWidth: 0 }}
                                            >
                                                <Typography variant="body2" fontWeight="medium" noWrap>
                                                    {segment.title || `Segment ${segment.id}`}
                                                </Typography>
                                            </Link>
                                            {segment.id === scene.id && (
                                                <Chip
                                                    label="Current"
                                                    size="small"
                                                    color="primary"
                                                    sx={{ flexShrink: 0 }}
                                                />
                                            )}
                                        </Box>
                                    </TableCell>
                                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                                        <Typography variant="body2" fontFamily="monospace">
                                            {formatDuration(segment.start_point, segment.end_point)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                                        <Typography variant="body2" fontFamily="monospace">
                                            {TextUtils.secondsToTimestamp(
                                                getSegmentDuration(segment.start_point, segment.end_point)
                                            )}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        {segment.studio ? (
                                            <Link to={`/studios/${segment.studio.id}`}>
                                                <Typography variant="body2">
                                                    {segment.studio.name}
                                                </Typography>
                                            </Link>
                                        ) : (
                                            <Typography variant="body2" color="text.secondary">
                                                —
                                            </Typography>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Box display="flex" gap={0.5} flexWrap="wrap">
                                            {segment.tags?.slice(0, 3).map((tag) => (
                                                <Chip
                                                    key={tag.id}
                                                    label={tag.name}
                                                    size="small"
                                                    variant="outlined"
                                                    component={Link}
                                                    to={`/tags/${tag.id}`}
                                                    clickable
                                                />
                                            ))}
                                            {(segment.tags?.length ?? 0) > 3 && (
                                                <Chip
                                                    label={`+${(segment.tags?.length ?? 0) - 3}`}
                                                    size="small"
                                                    variant="outlined"
                                                />
                                            )}
                                        </Box>
                                    </TableCell>
                                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                                        <Tooltip title="Play Segment">
                                            <IconButton
                                                component={Link}
                                                to={`/scenes/${segment.id}`}
                                                size="small"
                                            >
                                                <PlayArrowIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Edit">
                                            <IconButton
                                                component={Link}
                                                to={`/scenes/${segment.id}/edit`}
                                                size="small"
                                            >
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete Segment">
                                            <IconButton
                                                onClick={() => setPendingDelete(segment.id)}
                                                size="small"
                                                color="error"
                                            >
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Summary */}
            {segments.length > 0 && (
                <Box mt={2} display="flex" gap={2}>
                    <Typography variant="body2" color="text.secondary">
                        {segments.length} segment{segments.length !== 1 ? 's' : ''} created from this file
                    </Typography>
                </Box>
            )}

            {/* Delete confirmation dialog */}
            <Dialog open={!!pendingDelete} onClose={() => setPendingDelete(null)}>
                <DialogTitle>
                    <FormattedMessage id="dialogs.delete_segment_title" defaultMessage="Delete Segment?" />
                </DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        <FormattedMessage
                            id="dialogs.delete_segment_desc"
                            defaultMessage="This will delete the segment scene record. The underlying video file will not be affected."
                        />
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPendingDelete(null)}>
                        <FormattedMessage id="actions.cancel" defaultMessage="Cancel" />
                    </Button>
                    <Button
                        color="error"
                        onClick={async () => {
                            if (!pendingDelete) return;
                            await destroyScene({
                                variables: { id: pendingDelete, delete_file: false },
                            });
                            setPendingDelete(null);
                            refetch();
                        }}
                    >
                        <FormattedMessage id="actions.delete" defaultMessage="Delete" />
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
