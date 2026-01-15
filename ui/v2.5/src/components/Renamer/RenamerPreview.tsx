import React from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Typography,
    Box,
} from "@mui/material";
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
        <Box mt={4}>
            <Typography variant="h6" gutterBottom>Preview Changes</Typography>
            <TableContainer component={Paper} sx={{ mt: 2, border: "1px solid #dee2e6" }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Current Path</TableCell>
                            <TableCell></TableCell>
                            <TableCell>New Path</TableCell>
                            <TableCell>Status</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {results.map((result) => (
                            <TableRow key={result.id} hover>
                                <TableCell sx={{ wordBreak: 'break-all' }}>{result.old_path}</TableCell>
                                <TableCell style={{ width: "20px" }} align="center">
                                    <Icon icon={faArrowRight} color="gray" />
                                </TableCell>
                                <TableCell sx={{ wordBreak: 'break-all' }}>
                                    {result.error && result.error.includes("missing data") ? (
                                        <Typography variant="body2" color="error" sx={{ fontStyle: 'italic' }}>
                                            Scene skipped due to failing template validation
                                        </Typography>
                                    ) : result.error && result.error === "Destination matches current path" ? (
                                        <Typography variant="body2" color="textSecondary" sx={{ fontStyle: 'italic' }}>
                                            No changes needed
                                        </Typography>
                                    ) : (
                                        result.new_path
                                    )}
                                </TableCell>
                                <TableCell style={{ width: "50px" }} align="center">
                                    {result.error ? (
                                        <div title={result.error}>
                                            <Icon icon={faTimes} color="red" />
                                        </div>
                                    ) : (
                                        <Icon icon={faCheck} color="green" />
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};
