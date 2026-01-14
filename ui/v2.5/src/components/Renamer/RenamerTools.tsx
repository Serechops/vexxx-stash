import React, { useState } from "react";
import { Button, Form } from "react-bootstrap";
import { faCheck, faPlay, faSave } from "@fortawesome/free-solid-svg-icons";
import { gql, useMutation } from "@apollo/client";
import { useRenameScenesMutation, RenameResult } from "src/core/generated-graphql";
import { RenamerTargetSelector } from "./RenamerTargetSelector";
import { RenamerPreview } from "./RenamerPreview";
import { Icon } from "src/components/Shared/Icon";
import { useToast } from "src/hooks/Toast";
import { useConfiguration } from "src/core/StashService";

const CONFIGURE_RENAMER = gql`
    mutation ConfigureRenamer($input: ConfigRenamerInput!) {
        configureRenamer(input: $input) {
            enabled
            template
            performer_limit
        }
    }
`;

export const RenamerTools: React.FC = () => {
    const { data: config } = useConfiguration();
    const [selectedDirectory, setSelectedDirectory] = useState("");
    const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
    // Initialize from localStorage or empty
    const [template, setTemplate] = useState(() => localStorage.getItem("renamer-sandbox-template") || "");
    const [moveFiles, setMoveFiles] = useState(() => localStorage.getItem("renamer-sandbox-move-files") === "true");
    const [previewResults, setPreviewResults] = useState<RenameResult[]>([]);
    const [renameScenes, { loading: renaming }] = useRenameScenesMutation();
    const [configureRenamer] = useMutation(CONFIGURE_RENAMER);
    const Toast = useToast();

    // Persist changes to localStorage
    React.useEffect(() => {
        localStorage.setItem("renamer-sandbox-template", template);
    }, [template]);

    React.useEffect(() => {
        localStorage.setItem("renamer-sandbox-move-files", String(moveFiles));
    }, [moveFiles]);

    const handleLoadDefault = () => {
        if (config?.configuration?.renamer) {
            setTemplate(config.configuration.renamer.template || "");
            setMoveFiles(config.configuration.renamer.move_files || false);
            Toast.success("Loaded default configuration");
        }
    };

    const handleDryRun = async () => {
        if (selectedSceneIds.length === 0) {
            Toast.error("No scenes selected");
            return;
        }

        try {
            const result = await renameScenes({
                variables: {
                    input: {
                        ids: selectedSceneIds,
                        template: template,
                        dry_run: true,
                        move_files: moveFiles
                    }
                }
            });
            if (result.data?.renameScenes) {
                setPreviewResults(result.data.renameScenes as RenameResult[]);
            }
        } catch (e) {
            Toast.error(e);
        }
    };

    const handleExecuteRename = async () => {
        if (selectedSceneIds.length === 0) return;

        if (!window.confirm(`Are you sure you want to rename ${selectedSceneIds.length} scenes? This cannot be undone.`)) {
            return;
        }

        try {
            const result = await renameScenes({
                variables: {
                    input: {
                        ids: selectedSceneIds,
                        template: template,
                        dry_run: false,
                        move_files: moveFiles
                    }
                }
            });

            const data = result.data?.renameScenes || [];
            const errors = data.filter((r) => r.error);
            if (errors.length > 0) {
                Toast.error(`Rename completed with ${errors.length} errors.`);
                setPreviewResults(data as RenameResult[]);
            } else {
                Toast.success("Rename completed successfully!");
                setPreviewResults([]);
                setSelectedSceneIds([]);
            }
        } catch (e) {
            Toast.error(e);
        }
    };

    const handleSaveAsDefault = async () => {
        try {
            await configureRenamer({
                variables: {
                    input: {
                        template,
                        move_files: moveFiles
                    }
                }
            });
            Toast.success("Template saved as default");
        } catch (e) {
            Toast.error(e);
        }
    };

    return (
        <div className="renamer-tools">
            <h3>Renamer Sandbox</h3>
            <p className="text-muted">
                Test your renaming templates here. Select a directory, choose scenes, build your template, and preview the results.
                You can also execute the rename operation directly from here.
            </p>

            <RenamerTargetSelector
                selectedDirectory={selectedDirectory}
                onDirectoryChange={(dir) => {
                    setSelectedDirectory(dir);
                    setSelectedSceneIds([]);
                    setPreviewResults([]);
                }}
                selectedSceneIds={selectedSceneIds}
                onSelectedSceneIdsChange={setSelectedSceneIds}
            />

            <hr />

            <div className="mb-3">
                <h4>Naming Template</h4>
                <Form.Group controlId="renamerTemplateTools">
                    <Form.Control
                        type="text"
                        value={template}
                        onChange={(e) => setTemplate(e.target.value)}
                        placeholder="{studio}/{date} - {title}"
                    />
                    <Form.Text className="text-muted">
                        Click to add token:
                    </Form.Text>
                    <div className="mt-1">
                        {["{title}", "{studio}", "{parent_studio}", "{performers}", "{date}", "{year}", "{rating}", "{id}"].map((token) => (
                            <Button
                                key={token}
                                variant="outline-secondary"
                                size="sm"
                                className="mr-1 mb-1"
                                onClick={() => setTemplate(template + token)}
                            >
                                {token}
                            </Button>
                        ))}
                    </div>
                </Form.Group>

                <Form.Group controlId="moveFilesTools">
                    <Form.Check
                        type="checkbox"
                        label="Move Files"
                        checked={moveFiles}
                        onChange={(e) => setMoveFiles(e.target.checked)}
                    />
                    <Form.Text className="text-muted">
                        If enabled, files will be moved to the destination directory specified in the template.
                    </Form.Text>
                </Form.Group>
            </div>

            <div className="d-flex mb-3">
                <Button onClick={handleDryRun} disabled={renaming || !selectedDirectory} className="mr-2">
                    <Icon icon={faPlay} className="mr-2" />
                    Dry Run
                </Button>
                <Button onClick={handleExecuteRename} disabled={renaming || !selectedDirectory} variant="danger" className="mr-2">
                    <Icon icon={faCheck} className="mr-2" />
                    Execute Rename
                </Button>
                <Button onClick={handleSaveAsDefault} variant="secondary" className="mr-2">
                    <Icon icon={faSave} className="mr-2" />
                    Save as Default
                </Button>
                <Button onClick={handleLoadDefault} variant="outline-secondary">
                    Load Default
                </Button>
            </div>

            {renaming && <div className="mt-3">Processing...</div>}

            {previewResults.length > 0 && (
                <div className="mt-4">
                    <h4>Results</h4>
                    <RenamerPreview results={previewResults} />
                </div>
            )}
        </div>
    );
};
