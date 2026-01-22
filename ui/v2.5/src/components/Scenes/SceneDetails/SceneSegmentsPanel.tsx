import React, { useState, useMemo } from "react";
import {
    Button,
    Box,
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
}

export const SceneSegmentsPanel: React.FC<IProps> = ({ scene }) => {
    const intl = useIntl();
    const [showCreatePanel, setShowCreatePanel] = useState(false);

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
            <Box mb={3} p={2} sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Source File
                </Typography>
                <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                    {file.path}
                </Typography>
                <Typography variant="body2" color="text.secondary" mt={1}>
                    Duration: {TextUtils.secondsToTimestamp(file.duration ?? 0)} •
                    Resolution: {file.width}x{file.height} •
                    Codec: {file.video_codec}
                </Typography>
            </Box>

            {/* Create Segment Panel */}
            {showCreatePanel && (
                <Box mb={3}>
                    <CreateSceneSegmentPanel
                        fileId={file.id}
                        fileDuration={file.duration}
                        onSuccess={handleCreateSuccess}
                    />
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
                <TableContainer component={Paper}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>
                                    <FormattedMessage id="title" defaultMessage="Title" />
                                </TableCell>
                                <TableCell>
                                    <FormattedMessage id="time_range" defaultMessage="Time Range" />
                                </TableCell>
                                <TableCell>
                                    <FormattedMessage id="duration" defaultMessage="Duration" />
                                </TableCell>
                                <TableCell>
                                    <FormattedMessage id="studio" defaultMessage="Studio" />
                                </TableCell>
                                <TableCell>
                                    <FormattedMessage id="tags" defaultMessage="Tags" />
                                </TableCell>
                                <TableCell align="right">
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
                                        <Link
                                            to={`/scenes/${segment.id}`}
                                            style={{ textDecoration: 'none', color: 'inherit' }}
                                        >
                                            <Typography variant="body2" fontWeight="medium">
                                                {segment.title || `Segment ${segment.id}`}
                                            </Typography>
                                        </Link>
                                        {segment.id === scene.id && (
                                            <Chip
                                                label="Current"
                                                size="small"
                                                color="primary"
                                                sx={{ ml: 1 }}
                                            />
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2" fontFamily="monospace">
                                            {formatDuration(segment.start_point, segment.end_point)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2">
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
                                    <TableCell align="right">
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
        </Box>
    );
};
