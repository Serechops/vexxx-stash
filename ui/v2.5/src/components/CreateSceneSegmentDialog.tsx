import React, { useState } from "react";
import { Modal, Button, Form, Col } from "react-bootstrap";
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
        // ... (main modal content same) ...
        <>
            <Modal show onHide={onClose}>
                {/* ... existing modal body ... */}
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
                                    <Form.Label>Start Point (MM:SS)</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={startPointStr}
                                        onChange={(e) => setStartPointStr(e.target.value)}
                                        placeholder="0"
                                    />
                                </Form.Group>
                            </Col>
                            <Col>
                                <Form.Group controlId="endPoint">
                                    <Form.Label>End Point (MM:SS)</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={endPointStr}
                                        onChange={(e) => setEndPointStr(e.target.value)}
                                        placeholder="MM:SS"
                                    />
                                </Form.Group>
                            </Col>
                        </Form.Row>

                        <div className="d-flex align-items-center mb-2">
                            <Form.Check
                                type="checkbox"
                                id="batch-scan-toggle"
                                label="Fuzzy Scan"
                                checked={isBatchScan}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIsBatchScan(e.target.checked)}
                                className="mr-3"
                            />
                        </div>

                        {isBatchScan && (
                            <Form.Row className="mb-2">
                                <Col>
                                    <Form.Group controlId="scanWindow">
                                        <Form.Label>Window (+/- sec)</Form.Label>
                                        <Form.Control
                                            type="number"
                                            value={scanWindowStr}
                                            onChange={(e) => setScanWindowStr(e.target.value)}
                                        />
                                    </Form.Group>
                                </Col>
                                <Col>
                                    <Form.Group controlId="scanIncrement">
                                        <Form.Label>Increment (sec)</Form.Label>
                                        <Form.Control
                                            type="number"
                                            value={scanIncrementStr}
                                            onChange={(e) => setScanIncrementStr(e.target.value)}
                                        />
                                    </Form.Group>
                                </Col>
                            </Form.Row>
                        )}

                        <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={handleCheckMatches}
                            disabled={checking}
                        >
                            {checking ? `Scanning ${progress}/${totalProgress}...` : "Check Matches"}
                        </Button>
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

            <Modal show={showMatches} onHide={() => setShowMatches(false)} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>Potential Matches</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {matches.length === 0 ? (
                        <p>No matches found.</p>
                    ) : (
                        <div className="list-group mb-3">
                            {matches.map((m, idx) => (
                                <div key={idx} className="list-group-item">
                                    <div className="d-flex justify-content-between">
                                        <div>
                                            <h5>{m.title}</h5>
                                            <p className="mb-1">{m.details?.substring(0, 100)}...</p>
                                            <small>{m.date} - {m.studio?.name}</small>
                                        </div>
                                        {m.image && <img src={m.image} alt="thumb" style={{ height: 60 }} />}
                                    </div>
                                    <Button variant="link" size="sm" onClick={() => setTitle(m.title || "")}>Use Title</Button>
                                </div>
                            ))}
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowMatches(false)}>Close</Button>
                </Modal.Footer>
            </Modal>
        </>
    );

};
