import React, { useEffect } from "react";
import { Form, Table, Button } from "react-bootstrap";
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

    if (error) return <div className="text-danger">Error loading scenes: {error.message}</div>;

    const { data: configData } = useConfigurationQuery();
    const stashes = configData?.configuration?.general?.stashes || [];

    return (
        <div className="mb-3">
            <h4>Target Directory</h4>

            {stashes.length > 0 && (
                <div className="mb-2">
                    <span className="mr-2 text-muted small">Libraries:</span>
                    {stashes.map((stash) => (
                        <Button
                            key={stash.path}
                            variant="outline-info"
                            size="sm"
                            className="mr-2 mb-1"
                            onClick={() => onDirectoryChange(stash.path)}
                        >
                            {stash.path}
                        </Button>
                    ))}
                </div>
            )}

            <FolderSelect
                currentDirectory={selectedDirectory}
                onChangeDirectory={onDirectoryChange}
            />

            {loading && <LoadingIndicator />}

            {selectedDirectory && !loading && scenes.length === 0 && (
                <div className="mt-2 text-muted">No scenes found in this directory.</div>
            )}

            {scenes.length > 0 && (
                <div className="mt-3">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                        <h5>Scenes ({scenes.length})</h5>
                        <div>
                            <Button variant="outline-primary" size="sm" className="mr-2" onClick={handleSelectAll}>
                                Select All
                            </Button>
                            <Button variant="outline-secondary" size="sm" onClick={handleDeselectAll}>
                                Deselect All
                            </Button>
                        </div>
                    </div>

                    <div style={{ maxHeight: "300px", overflowY: "auto", border: "1px solid #dee2e6" }}>
                        <Table striped hover size="sm" className="mb-0">
                            <thead>
                                <tr>
                                    <th style={{ width: "40px" }}></th>
                                    <th>Title</th>
                                    <th>Filename</th>
                                </tr>
                            </thead>
                            <tbody>
                                {scenes.map((scene) => {
                                    const isSelected = selectedSceneIds.includes(scene.id);
                                    const path = scene.files?.[0]?.path;
                                    const filename = path ? path.replace(/^.*[\\/]/, '') : "No file";
                                    return (
                                        <tr key={scene.id} onClick={() => handleToggleScene(scene.id)} style={{ cursor: "pointer" }}>
                                            <td className="text-center">
                                                <Form.Check
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => { }} // Handled by row click
                                                    onClick={(e) => e.stopPropagation()}
                                                    // Stop propagation to prevent double toggle if logic was separate
                                                    // Actually handleToggleScene is on tr, so let's just make sure 
                                                    // clicking checkbox calls it or let bubble.
                                                    // It's safer to just read checked state.
                                                    readOnly
                                                />
                                            </td>
                                            <td>{scene.title || scene.id}</td>
                                            <td className="text-muted small">{filename}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </Table>
                    </div>
                    <div className="text-muted small mt-1">
                        {selectedSceneIds.length} selected
                    </div>
                </div>
            )}
        </div>
    );
};
