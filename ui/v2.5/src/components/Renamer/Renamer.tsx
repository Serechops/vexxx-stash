import React, { useState, useEffect } from "react";
import {
    Button,
    Checkbox,
    FormControlLabel,
    TextField,
    Tab,
    Tabs,
    Box,
    Stack,
    Typography,
    Container,
    Paper,
    FormHelperText,
} from "@mui/material";
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

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

function CustomTabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;

    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`simple-tabpanel-${index}`}
            aria-labelledby={`simple-tab-${index}`}
            {...other}
        >
            {value === index && (
                <Box sx={{ p: 3 }}>
                    {children}
                </Box>
            )}
        </div>
    );
}

function a11yProps(index: number) {
    return {
        id: `simple-tab-${index}`,
        'aria-controls': `simple-tabpanel-${index}`,
    };
}

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

    // MUI Tabs state
    const [tabValue, setTabValue] = useState(0);
    const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
    };

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
            Toast.success(intl.formatMessage({ id: "Renamer Configuration Saved" }));
        } catch (e) {
            Toast.error(e);
        }
    };

    if (loading) return <LoadingIndicator />;
    if (error) return <div>Error: {error.message}</div>;

    return (
        <Container maxWidth="xl">
            <Helmet {...titleProps} title="Renamer" />
            <Typography variant="h4" gutterBottom>Renamer</Typography>

            <Box sx={{ width: '100%' }}>
                <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                    <Tabs value={tabValue} onChange={handleTabChange} aria-label="renamer tabs">
                        <Tab label="Configuration" {...a11yProps(0)} />
                        <Tab label="Tools" {...a11yProps(1)} />
                    </Tabs>
                </Box>
                <CustomTabPanel value={tabValue} index={0}>
                    <Paper sx={{ p: 2 }}>
                        <Typography variant="h5" gutterBottom>Global Settings</Typography>
                        <Stack spacing={3}>
                            <Box>
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={enabled}
                                            onChange={(e) => setEnabled(e.target.checked)}
                                        />
                                    }
                                    label="Enable Automatic Renaming on Scene Update"
                                />
                                <FormHelperText>
                                    When enabled, scenes will be automatically renamed according to the template whenever they are updated (e.g. scraped).
                                </FormHelperText>
                            </Box>

                            <Box>
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={moveFiles}
                                            onChange={(e) => setMoveFiles(e.target.checked)}
                                        />
                                    }
                                    label="Move Files"
                                />
                                <FormHelperText>
                                    If enabled, files will be moved to the destination directory specified in the template. If disabled, files will only be renamed in their current directory.
                                </FormHelperText>
                            </Box>

                            <Box>
                                <TextField
                                    label="Default Renaming Template"
                                    value={template}
                                    onChange={(e) => setTemplate(e.target.value)}
                                    placeholder="{studio}/{date} - {title}"
                                    fullWidth
                                    variant="outlined"
                                    helperText={
                                        <Box component="span">
                                            Click to add token:
                                            <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                                {["{title}", "{studio}", "{parent_studio}", "{performers}", "{date}", "{year}", "{rating}"].map((token) => (
                                                    <Button
                                                        key={token}
                                                        variant="outlined"
                                                        size="small"
                                                        onClick={() => setTemplate(template + token)}
                                                    >
                                                        {token}
                                                    </Button>
                                                ))}
                                            </Box>
                                        </Box>
                                    }
                                />
                            </Box>

                            <Box>
                                <TextField
                                    label="Performer Limit"
                                    type="number"
                                    value={performerLimit}
                                    onChange={(e) => setPerformerLimit(parseInt(e.target.value) || 0)}
                                    placeholder="0 for unlimited"
                                    fullWidth
                                    variant="outlined"
                                    helperText="Max number of performers to include in filename. Set to 0 for unlimited."
                                    inputProps={{ min: 0 }}
                                />
                            </Box>

                            <Box>
                                <Button onClick={handleSave} variant="contained" startIcon={<Icon icon={faSave} />}>
                                    <FormattedMessage id="actions.save" />
                                </Button>
                            </Box>
                        </Stack>
                    </Paper>
                </CustomTabPanel>
                <CustomTabPanel value={tabValue} index={1}>
                    <RenamerTools />
                </CustomTabPanel>
            </Box>
        </Container>
    );
};

export default Renamer;
