import React, { useState } from "react";
import {
    Button,
    Alert,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Box,
    Typography,
    TextField,
    FormControlLabel,
    Checkbox,
    FormHelperText
} from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { useRenameScenes } from "src/core/StashService";
import { ModalComponent } from "../Shared/Modal";
import { useToast } from "src/hooks/Toast";
import EditIcon from "@mui/icons-material/Edit";

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
            <TableContainer component={Paper} className="rename-preview mt-3" sx={{ maxHeight: 300 }}>
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            <TableCell>Old Path</TableCell>
                            <TableCell>New Path</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {previewResults.map((Res) => (
                            <TableRow key={Res.id}>
                                <TableCell className="text-break" sx={{ width: "50%" }}>{Res.old_path}</TableCell>
                                <TableCell className="text-break" sx={{ width: "50%" }}>
                                    {Res.error ? (
                                        <span style={{ color: '#db3737' }}>{Res.error}</span>
                                    ) : (
                                        <span style={{ color: Res.old_path === Res.new_path ? '#a1a1aa' : '#0f9960' }}>
                                            {Res.new_path}
                                        </span>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        );
    }

    return (
        <ModalComponent
            show
            icon={<EditIcon />}
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
            <Box component="form">
                <Box mb={2}>
                    <Typography component="label" htmlFor="template" variant="body2">Renaming Template</Typography>
                    <Box display="flex">
                        <TextField
                            id="template"
                            fullWidth
                            size="small"
                            variant="outlined"
                            value={template}
                            onChange={(e) => setTemplate(e.target.value)}
                            placeholder="{studio}/{date} - {title}.{ext}"
                        />
                        <Button variant="contained" color="info" className="ml-2" onClick={onPreview} disabled={loading}>
                            {loading ? "Previewing..." : "Preview"}
                        </Button>
                    </Box>
                    <FormHelperText>
                        Available tokens: <code>{`{title}, {date}, {year}, {studio}, {performers}, {rating}, {id}, {ext}`}</code>
                    </FormHelperText>
                </Box>

                <Box mb={2}>
                    <FormControlLabel
                        control={
                            <Checkbox
                                id="organized"
                                checked={setOrganized}
                                onChange={(e) => setSetOrganized(e.target.checked)}
                            />
                        }
                        label={intl.formatMessage({ id: "component_tagger.config.mark_organized_label" })}
                    />
                </Box>

                {error && <Alert severity="error">{error}</Alert>}

                {renderPreview()}
            </Box>
        </ModalComponent>
    );
};
