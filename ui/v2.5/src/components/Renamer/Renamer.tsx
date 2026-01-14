import React, { useState, useEffect } from "react";
import { Button, Form, Tab, Tabs } from "react-bootstrap";
import { FormattedMessage, useIntl } from "react-intl";
import { useTitleProps } from "src/hooks/title";
import { Helmet } from "react-helmet";
import { useConfiguration } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { Icon } from "src/components/Shared/Icon";
import { faSave } from "@fortawesome/free-solid-svg-icons";
import { gql, useMutation } from "@apollo/client";
import { RenamerTools } from "./RenamerTools";

// Define Mutation
const CONFIGURE_RENAMER = gql`
    mutation ConfigureRenamer($input: ConfigRenamerInput!) {
        configureRenamer(input: $input) {
            enabled
            template
            performer_limit
            move_files
        }
    }
`;

const Renamer: React.FC = () => {
    const titleProps = useTitleProps({ id: "Renamer" });
    const { data: config, loading, error } = useConfiguration();
    const [configureRenamer] = useMutation(CONFIGURE_RENAMER);
    const Toast = useToast();
    const intl = useIntl();

    const [enabled, setEnabled] = useState(false);
    const [template, setTemplate] = useState("");
    const [performerLimit, setPerformerLimit] = useState(0);
    const [moveFiles, setMoveFiles] = useState(false);

    // Load initial state
    useEffect(() => {
        if (config?.configuration?.renamer) {
            setEnabled(config.configuration.renamer.enabled);
            setTemplate(config.configuration.renamer.template);
            setPerformerLimit(config.configuration.renamer.performer_limit || 0);
            setMoveFiles(config.configuration.renamer.move_files || false);
        }
    }, [config]);

    const handleSave = async () => {
        try {
            await configureRenamer({
                variables: {
                    input: {
                        enabled,
                        template,
                        performer_limit: performerLimit,
                        move_files: moveFiles
                    }
                }
            });
            Toast.success(intl.formatMessage({ id: "toast.started" }));
        } catch (e) {
            Toast.error(e);
        }
    };

    if (loading) return <LoadingIndicator />;
    if (error) return <div>Error: {error.message}</div>;

    return (
        <div className="container-fluid">
            <Helmet {...titleProps} title="Renamer" />
            <h1>Renamer</h1>

            <Tabs defaultActiveKey="config" id="renamer-tabs" className="mb-3">
                <Tab eventKey="config" title="Configuration">
                    <div className="p-3">
                        <h2>Global Settings</h2>
                        <Form>
                            <Form.Group controlId="renamerEnabled">
                                <Form.Check
                                    type="checkbox"
                                    label="Enable Automatic Renaming on Scene Update"
                                    checked={enabled}
                                    onChange={(e) => setEnabled(e.target.checked)}
                                />
                                <Form.Text className="text-muted">
                                    When enabled, scenes will be automatically renamed according to the template whenever they are updated (e.g. scraped).
                                </Form.Text>
                            </Form.Group>

                            <Form.Group controlId="moveFiles">
                                <Form.Check
                                    type="checkbox"
                                    label="Move Files"
                                    checked={moveFiles}
                                    onChange={(e) => setMoveFiles(e.target.checked)}
                                />
                                <Form.Text className="text-muted">
                                    If enabled, files will be moved to the destination directory specified in the template. If disabled, files will only be renamed in their current directory.
                                </Form.Text>
                            </Form.Group>

                            <Form.Group controlId="renamerTemplate">
                                <Form.Label>Default Renaming Template</Form.Label>
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
                                    {["{title}", "{studio}", "{parent_studio}", "{performers}", "{date}", "{year}", "{rating}"].map((token) => (
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

                            <Form.Group controlId="renamerPerformerLimit">
                                <Form.Label>Performer Limit</Form.Label>
                                <Form.Control
                                    type="number"
                                    value={performerLimit}
                                    onChange={(e) => setPerformerLimit(parseInt(e.target.value) || 0)}
                                    placeholder="0 for unlimited"
                                    min="0"
                                />
                                <Form.Text className="text-muted">
                                    Max number of performers to include in filename. Set to 0 for unlimited.
                                </Form.Text>
                            </Form.Group>

                            <Button onClick={handleSave} variant="primary">
                                <Icon icon={faSave} className="mr-2" />
                                <FormattedMessage id="actions.save" />
                            </Button>
                        </Form>
                    </div>
                </Tab>
                <Tab eventKey="tools" title="Tools">
                    <div className="p-3">
                        <RenamerTools />
                    </div>
                </Tab>
            </Tabs>
        </div>
    );
};

export default Renamer;
