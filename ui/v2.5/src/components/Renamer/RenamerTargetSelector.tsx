import React, { useEffect } from "react";
import {
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Checkbox,
    Box,
    Stack,
    Typography,
} from "@mui/material";
import { FormattedMessage } from "react-intl";
import { FolderSelect } from "src/components/Shared/FolderSelect/FolderSelect";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { useFindScenesQuery, useConfigurationQuery, CriterionModifier } from "src/core/generated-graphql";

interface RenamerTargetSelectorProps {
    selectedDirectory: string;
    onDirectoryChange: (dir: string) => void;
    selectedSceneIds: string[];
    onSelectedSceneIdsChange: (ids: string[]) => void;
}

export const RenamerTargetSelector: React.FC<RenamerTargetSelectorProps> = ({
    selectedDirectory,
    onDirectoryChange,
    selectedSceneIds,
    onSelectedSceneIdsChange,
}) => {
    const { data, loading, error } = useFindScenesQuery({
        skip: !selectedDirectory,
        variables: {
            scene_filter: {
                files_filter: {
                    dir: {
                        value: selectedDirectory,
                        modifier: CriterionModifier.Equals,
                    },
                },
            },
            filter: {
                per_page: -1, // Fetch all scenes in directory
                sort: "title",
                direction: "ASC" as any, // Generated type issue sometimes requires casting or import
            },
        },
    });

    // Auto-select all when directory changes and scenes are loaded?
    // User might prefer manual selection. Let's keep it manual but provide "Select All".

    const scenes = data?.findScenes?.scenes || [];

    const handleSelectAll = () => {
        onSelectedSceneIdsChange(scenes.map((s) => s.id));
    };

    const handleDeselectAll = () => {
        onSelectedSceneIdsChange([]);
    };

    const handleToggleScene = (id: string) => {
        if (selectedSceneIds.includes(id)) {
            onSelectedSceneIdsChange(selectedSceneIds.filter((sid) => sid !== id));
        } else {
            onSelectedSceneIdsChange([...selectedSceneIds, id]);
        }
    };

    if (error) return <Typography color="error">Error loading scenes: {error.message}</Typography>;

    const { data: configData } = useConfigurationQuery();
    const stashes = configData?.configuration?.general?.stashes || [];

    return (
        <Box mb={3}>
            <Typography variant="h6" gutterBottom>Target Directory</Typography>

            {stashes.length > 0 && (
                <Box mb={2}>
                    <Typography variant="caption" color="textSecondary" sx={{ mr: 2 }}>Libraries:</Typography>
                    {stashes.map((stash) => (
                        <Button
                            key={stash.path}
                            variant="outlined"
                            size="small"
                            sx={{ mr: 1, mb: 1 }}
                            onClick={() => onDirectoryChange(stash.path)}
                        >
                            {stash.path}
                        </Button>
                    ))}
                </Box>
            )}

            <FolderSelect
                currentDirectory={selectedDirectory}
                onChangeDirectory={onDirectoryChange}
            />

            {loading && <LoadingIndicator />}

            {selectedDirectory && !loading && scenes.length === 0 && (
                <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>
                    No scenes found in this directory.
                </Typography>
            )}

            {scenes.length > 0 && (
                <Box mt={3}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="subtitle1">Scenes ({scenes.length})</Typography>
                        <Box>
                            <Button variant="outlined" size="small" sx={{ mr: 2 }} onClick={handleSelectAll}>
                                Select All
                            </Button>
                            <Button variant="outlined" size="small" onClick={handleDeselectAll}>
                                Deselect All
                            </Button>
                        </Box>
                    </Stack>

                    <TableContainer component={Paper} sx={{ maxHeight: 300, border: "1px solid #dee2e6" }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell padding="checkbox"></TableCell>
                                    <TableCell>Title</TableCell>
                                    <TableCell>Directory</TableCell>
                                    <TableCell>Filename</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {scenes.map((scene) => {
                                    const isSelected = selectedSceneIds.includes(scene.id);
                                    const path = scene.files?.[0]?.path;
                                    const filename = path ? path.replace(/^.*[\\/]/, '') : "No file";
                                    // Extract directory by removing filename
                                    // Handle both / and \ separators
                                    const directory = path ? path.replace(/[\\/][^\\/]*$/, '') : "";

                                    return (
                                        <TableRow
                                            key={scene.id}
                                            hover
                                            onClick={() => handleToggleScene(scene.id)}
                                            role="checkbox"
                                            aria-checked={isSelected}
                                            selected={isSelected}
                                            sx={{ cursor: "pointer" }}
                                        >
                                            <TableCell padding="checkbox">
                                                <Checkbox
                                                    checked={isSelected}
                                                    onChange={() => { }} // Handled by row click
                                                    onClick={(e) => e.stopPropagation()}
                                                    size="small"
                                                />
                                            </TableCell>
                                            <TableCell>{scene.title || scene.id}</TableCell>
                                            <TableCell>
                                                <Typography variant="caption" color="textSecondary" sx={{ wordBreak: 'break-all' }}>
                                                    {directory}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Typography variant="caption" color="textSecondary" sx={{ wordBreak: 'break-all' }}>
                                                    {filename}
                                                </Typography>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                    <Typography variant="caption" color="textSecondary" sx={{ mt: 1, display: 'block' }}>
                        {selectedSceneIds.length} selected
                    </Typography>
                </Box>
            )}
        </Box>
    );
};
