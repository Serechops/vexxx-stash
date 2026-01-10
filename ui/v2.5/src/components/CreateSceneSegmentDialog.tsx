import React, { useState } from "react";
import { Modal, Button, Form, Col } from "react-bootstrap";
import { useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { useToast } from "src/hooks/Toast";

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
    const [startPoint, setStartPoint] = useState<number | undefined>();
    const [endPoint, setEndPoint] = useState<number | undefined>(fileDuration);

    const [createScene] = GQL.useSceneCreateMutation();

    const handleSave = async () => {
        if (!title) {
            Toast.error("Title is required");
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
        <Modal show onHide={onClose}>
            <Modal.Header closeButton>
                <Modal.Title>Create Scene Segment</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <Form>
                    <Form.Group controlId="segmentTitle">
                        <Form.Label>Title</Form.Label>
                        <Form.Control
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Enter title"
                        />
                    </Form.Group>
                    <Form.Row>
                        <Col>
                            <Form.Group controlId="startPoint">
                                <Form.Label>Start Point (s)</Form.Label>
                                <Form.Control
                                    type="number"
                                    value={startPoint || ""}
                                    onChange={(e) =>
                                        setStartPoint(parseFloat(e.target.value) || undefined)
                                    }
                                />
                            </Form.Group>
                        </Col>
                        <Col>
                            <Form.Group controlId="endPoint">
                                <Form.Label>End Point (s)</Form.Label>
                                <Form.Control
                                    type="number"
                                    value={endPoint || ""}
                                    onChange={(e) =>
                                        setEndPoint(parseFloat(e.target.value) || undefined)
                                    }
                                />
                            </Form.Group>
                        </Col>
                    </Form.Row>
                </Form>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="secondary" onClick={onClose}>
                    Cancel
                </Button>
                <Button variant="primary" onClick={handleSave}>
                    Create
                </Button>
            </Modal.Footer>
        </Modal>
    );
};
