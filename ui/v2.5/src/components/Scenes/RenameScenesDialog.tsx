import React, { useState } from "react";
import { Form, Table, Button, Alert } from "react-bootstrap";
import { FormattedMessage, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { useRenameScenes } from "src/core/StashService";
import { ModalComponent } from "../Shared/Modal";
import { useToast } from "src/hooks/Toast";
import { faPencilAlt } from "@fortawesome/free-solid-svg-icons";

interface IRenameScenesProps {
    selected: GQL.SlimSceneDataFragment[];
    onClose: (applied: boolean) => void;
}

export const RenameScenesDialog: React.FC<IRenameScenesProps> = (props) => {
    const intl = useIntl();
    const Toast = useToast();
    const [template, setTemplate] = useState("{studio}/{date} - {title}.{ext}");
    const [setOrganized, setSetOrganized] = useState(false);
    const [previewResults, setPreviewResults] = useState<{ id: string; old_path: string; new_path: string; error?: string | null }[]>([]);
    const [error, setError] = useState<string>();

    const [renameScenes, { loading }] = useRenameScenes({
        ids: props.selected.map((s) => s.id),
        template: template,
        dry_run: true,
        set_organized: setOrganized,
    });

    const [executeRename, { loading: executing }] = useRenameScenes({
        ids: props.selected.map((s) => s.id),
        template: template,
        dry_run: false,
        set_organized: setOrganized,
    });

    async function onPreview() {
        setError(undefined);
        try {
            const result = await renameScenes({
                variables: {
                    input: {
                        ids: props.selected.map(s => s.id),
                        template: template,
                        dry_run: true,
                        set_organized: setOrganized,
                    }
                }
            });
            if (result.data?.renameScenes) {
                setPreviewResults(result.data.renameScenes);
            }
        } catch (e: any) {
            setError(e.message);
        }
    }

    async function onApply() {
        setError(undefined);
        try {
            const result = await executeRename({
                variables: {
                    input: {
                        ids: props.selected.map(s => s.id),
                        template: template,
                        dry_run: false,
                        set_organized: setOrganized,
                    }
                }
            });

            // Check for errors in results
            const errors = result.data?.renameScenes?.filter(r => r.error);
            if (errors && errors.length > 0) {
                setPreviewResults(result.data?.renameScenes ?? []);
                Toast.error(`Failed to rename ${errors.length} scenes.`);
            } else {
                Toast.success("Renamed scenes successfully");
                props.onClose(true);
            }
        } catch (e: any) {
            setError(e.message);
            Toast.error(e);
        }
    }

    function renderPreview() {
        if (!previewResults || previewResults.length === 0) return null;

        return (
            <div className="rename-preview mt-3" style={{ maxHeight: "300px", overflowY: "auto" }}>
                <Table striped bordered hover size="sm">
                    <thead>
                        <tr>
                            <th>Old Path</th>
                            <th>New Path</th>
                        </tr>
                    </thead>
                    <tbody>
                        {previewResults.map((Res) => (
                            <tr key={Res.id}>
                                <td className="text-break" style={{ width: "50%" }}>{Res.old_path}</td>
                                <td className="text-break" style={{ width: "50%" }}>
                                    {Res.error ? (
                                        <span className="text-danger">{Res.error}</span>
                                    ) : (
                                        <span className={Res.old_path === Res.new_path ? "text-muted" : "text-success"}>
                                            {Res.new_path}
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            </div>
        );
    }

    return (
        <ModalComponent
            show
            icon={faPencilAlt}
            header="Rename Scenes"
            accept={{
                onClick: onApply,
                text: intl.formatMessage({ id: "actions.apply" }),
            }}
            disabled={previewResults.length === 0 || loading || executing}
            cancel={{
                onClick: () => props.onClose(false),
                text: intl.formatMessage({ id: "actions.cancel" }),
                variant: "secondary",
            }}
            isRunning={executing}
            modalProps={{ size: "lg" }}
        >
            <Form>
                <Form.Group controlId="template">
                    <Form.Label>Renaming Template</Form.Label>
                    <div className="d-flex">
                        <Form.Control
                            type="text"
                            value={template}
                            onChange={(e) => setTemplate(e.target.value)}
                            placeholder="{studio}/{date} - {title}.{ext}"
                        />
                        <Button variant="info" className="ml-2" onClick={onPreview} disabled={loading}>
                            {loading ? "Previewing..." : "Preview"}
                        </Button>
                    </div>
                    <Form.Text className="text-muted">
                        Available tokens: <code>{`{title}, {date}, {year}, {studio}, {performers}, {rating}, {id}, {ext}`}</code>
                    </Form.Text>
                </Form.Group>

                <Form.Group controlId="organized">
                    <Form.Check
                        type="checkbox"
                        label={intl.formatMessage({ id: "component_tagger.config.mark_organized_label" })}
                        checked={setOrganized}
                        onChange={(e) => setSetOrganized(e.target.checked)}
                    />
                </Form.Group>

                {error && <Alert variant="danger">{error}</Alert>}

                {renderPreview()}
            </Form>
        </ModalComponent>
    );
};
