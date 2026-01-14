import React from "react";
import { Table } from "react-bootstrap";
import { FormattedMessage } from "react-intl";
import { Icon } from "src/components/Shared/Icon";
import { faCheck, faTimes, faArrowRight } from "@fortawesome/free-solid-svg-icons";

import { RenameResult } from "src/core/generated-graphql";

interface RenamerPreviewProps {
    results: RenameResult[];
}

export const RenamerPreview: React.FC<RenamerPreviewProps> = ({ results }) => {
    if (!results || results.length === 0) {
        return null;
    }

    return (
        <div className="mt-4">
            <h4>Preview Changes</h4>
            <Table striped bordered hover size="sm" className="mt-2">
                <thead>
                    <tr>
                        <th>Current Path</th>
                        <th></th>
                        <th>New Path</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    {results.map((result) => (
                        <tr key={result.id}>
                            <td className="text-break">{result.old_path}</td>
                            <td style={{ width: "20px" }} className="text-center align-middle">
                                <Icon icon={faArrowRight} color="gray" />
                            </td>
                            <td className="text-break">
                                {result.error && result.error.includes("missing data") ? (
                                    <span className="text-danger font-italic">
                                        Scene skipped due to failing template validation
                                    </span>
                                ) : result.error && result.error === "Destination matches current path" ? (
                                    <span className="text-muted font-italic">
                                        No changes needed
                                    </span>
                                ) : (
                                    result.new_path
                                )}
                            </td>
                            <td style={{ width: "50px" }} className="text-center align-middle">
                                {result.error ? (
                                    <div title={result.error}>
                                        <Icon icon={faTimes} color="red" />
                                    </div>
                                ) : (
                                    <Icon icon={faCheck} color="green" />
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </Table>
        </div>
    );
};
