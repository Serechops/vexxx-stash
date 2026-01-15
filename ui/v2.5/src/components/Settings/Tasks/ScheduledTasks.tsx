import React, { useState, useEffect } from "react";
import { useIntl } from "react-intl";
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Chip,
    ButtonGroup,
    TextField,
    MenuItem,
    Select,
    FormControl,
    InputLabel,
    FormControlLabel,
    Switch,
    Box,
    Typography,
    Divider,
    IconButton
} from "@mui/material";
import { Icon } from "src/components/Shared/Icon";
import {
    faPlus,
    faEdit,
    faTrash,
    faPlay,
    faClock,
    faCheck,
    faTimes,
} from "@fortawesome/free-solid-svg-icons";
import { CronInput } from "./CronInput";
import { ScanOptions } from "./ScanOptions";
import { GenerateOptions } from "./GenerateOptions";
import { CleanOptions } from "./DataManagementTasks";
import { AutoTagOptions } from "./LibraryTasks";
import * as GQL from "src/core/generated-graphql";
import { usePlugins } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";

// Types
interface TaskFormData {
    name: string;
    cronSchedule: string;
    taskType: GQL.ScheduledTaskType;
    enabled: boolean;
}

const TASK_TYPES = [
    { value: GQL.ScheduledTaskType.Scan, label: "Scan Library" },
    { value: GQL.ScheduledTaskType.Generate, label: "Generate Content" },
    { value: GQL.ScheduledTaskType.AutoTag, label: "Auto Tag" },
    { value: GQL.ScheduledTaskType.Clean, label: "Clean Library" },
    { value: GQL.ScheduledTaskType.Optimise, label: "Optimise Database" },
    { value: GQL.ScheduledTaskType.Plugin, label: "Plugin Task" },
];

export const ScheduledTasks: React.FC = () => {
    const intl = useIntl();
    const plugins = usePlugins();
    const Toast = useToast();

    const [showModal, setShowModal] = useState(false);
    const [editingTask, setEditingTask] = useState<GQL.ScheduledTask | null>(null);

    const [formData, setFormData] = useState<TaskFormData>({
        name: "",
        cronSchedule: "0 0 3 * * *",
        taskType: GQL.ScheduledTaskType.Scan,
        enabled: true,
    });

    // Options state
    const [scanOptions, setScanOptions] = useState<GQL.ScanMetadataInput>({});
    const [generateOptions, setGenerateOptions] = useState<GQL.GenerateMetadataInput>({});
    const [cleanOptions, setCleanOptions] = useState<GQL.CleanMetadataInput>({ dryRun: false });
    const [autoTagOptions, setAutoTagOptions] = useState<GQL.AutoTagMetadataInput>({});

    // Plugin options state
    const [selectedPluginId, setSelectedPluginId] = useState<string>("");
    const [selectedPluginTask, setSelectedPluginTask] = useState<string>("");

    // GraphQL Hooks
    const { data, loading, error, refetch } = GQL.useScheduledTasksQuery();
    const [createTask] = GQL.useScheduledTaskCreateMutation();
    const [updateTask] = GQL.useScheduledTaskUpdateMutation();
    const [deleteTask] = GQL.useScheduledTaskDestroyMutation();
    const [runTask] = GQL.useScheduledTaskRunMutation();

    const tasks = data?.scheduledTasks || [];

    const getOptionsObject = () => {
        switch (formData.taskType) {
            case GQL.ScheduledTaskType.Scan: return scanOptions;
            case GQL.ScheduledTaskType.Generate: return generateOptions;
            case GQL.ScheduledTaskType.Clean: return cleanOptions;
            case GQL.ScheduledTaskType.AutoTag: return autoTagOptions;
            case GQL.ScheduledTaskType.Plugin:
                return {
                    pluginId: selectedPluginId,
                    taskName: selectedPluginTask,
                    args: {}
                };
            default: return {};
        }
    };

    // Create task
    const handleCreate = async () => {
        try {
            const input: GQL.ScheduledTaskCreateInput = {
                name: formData.name,
                cron_schedule: formData.cronSchedule,
                task_type: formData.taskType,
                enabled: formData.enabled,
                options: JSON.stringify(getOptionsObject()),
            };

            await createTask({ variables: { input } });
            setShowModal(false);
            refetch();
            resetForm();
            Toast.success("Scheduled task created");
        } catch (error) {
            console.error("Failed to create scheduled task:", error);
            Toast.error(error instanceof Error ? error.message : "Failed to create task");
        }
    };

    // Update task
    const handleUpdate = async () => {
        if (!editingTask) return;

        try {
            const input: GQL.ScheduledTaskUpdateInput = {
                id: editingTask.id,
                name: formData.name,
                cron_schedule: formData.cronSchedule,
                task_type: formData.taskType,
                enabled: formData.enabled,
                options: JSON.stringify(getOptionsObject()),
            };

            await updateTask({ variables: { input } });
            setShowModal(false);
            setEditingTask(null);
            refetch();
            resetForm();
            Toast.success("Scheduled task updated");
        } catch (error) {
            console.error("Failed to update scheduled task:", error);
            Toast.error(error instanceof Error ? error.message : "Failed to update task");
        }
    };

    // Delete task
    const handleDelete = async (taskId: string) => {
        if (!window.confirm("Are you sure you want to delete this scheduled task?")) {
            return;
        }

        try {
            await deleteTask({ variables: { id: taskId } });
            refetch();
            Toast.success("Scheduled task deleted");
        } catch (error) {
            console.error("Failed to delete scheduled task:", error);
            Toast.error("Failed to delete task");
        }
    };

    // Run task manually
    const handleRun = async (taskId: string) => {
        try {
            const result = await runTask({ variables: { id: taskId } });
            const jobId = result.data?.scheduledTaskRun;
            Toast.success(`Task started with job ID: ${jobId}`);
        } catch (error) {
            console.error("Failed to run scheduled task:", error);
            Toast.error("Failed to run task");
        }
    };

    // Toggle enabled
    const handleToggleEnabled = async (task: GQL.ScheduledTask) => {
        try {
            await updateTask({
                variables: {
                    input: {
                        id: task.id,
                        enabled: !task.enabled,
                    }
                }
            });
            refetch();
        } catch (error) {
            console.error("Failed to toggle task:", error);
            Toast.error("Failed to toggle task");
        }
    };

    const resetForm = () => {
        setFormData({
            name: "",
            cronSchedule: "0 0 3 * * *",
            taskType: GQL.ScheduledTaskType.Scan,
            enabled: true,
        });
        setScanOptions({});
        setGenerateOptions({});
        setCleanOptions({ dryRun: false });
        setAutoTagOptions({});
        setSelectedPluginId("");
        setSelectedPluginTask("");
    };

    const openEditModal = (task: GQL.ScheduledTask) => {
        setEditingTask(task);
        setFormData({
            name: task.name,
            cronSchedule: task.cron_schedule,
            taskType: task.task_type,
            enabled: task.enabled,
        });

        // Populate options based on type
        let opts: any = {};
        try {
            if (task.options) {
                opts = JSON.parse(task.options);
            }
        } catch (e) {
            console.error("Failed to parse task options", e);
        }

        switch (task.task_type) {
            case GQL.ScheduledTaskType.Scan: setScanOptions(opts); break;
            case GQL.ScheduledTaskType.Generate: setGenerateOptions(opts); break;
            case GQL.ScheduledTaskType.Clean: setCleanOptions({ dryRun: false, ...opts }); break;
            case GQL.ScheduledTaskType.AutoTag: setAutoTagOptions(opts); break;
            case GQL.ScheduledTaskType.Plugin:
                setSelectedPluginId(opts.pluginId || "");
                setSelectedPluginTask(opts.taskName || "");
                break;
        }

        setShowModal(true);
    };

    const openCreateModal = () => {
        setEditingTask(null);
        resetForm();
        setShowModal(true);
    };

    const formatDate = (dateStr?: string | null) => {
        if (!dateStr) return "Never";
        return new Date(dateStr).toLocaleString();
    };

    const getTaskTypeLabel = (type: GQL.ScheduledTaskType) => {
        return TASK_TYPES.find((t) => t.value === type)?.label || type;
    };

    const renderOptionsForm = () => {
        switch (formData.taskType) {
            case GQL.ScheduledTaskType.Scan:
                return <ScanOptions options={scanOptions} setOptions={setScanOptions} keyPrefix="scheduled-task-" />;
            case GQL.ScheduledTaskType.Generate:
                return <GenerateOptions options={generateOptions} setOptions={setGenerateOptions} keyPrefix="scheduled-task-" />;
            case GQL.ScheduledTaskType.Clean:
                return <CleanOptions options={cleanOptions} setOptions={setCleanOptions} keyPrefix="scheduled-task-" />;
            case GQL.ScheduledTaskType.AutoTag:
                return <AutoTagOptions options={autoTagOptions} setOptions={setAutoTagOptions} keyPrefix="scheduled-task-" />;
            case GQL.ScheduledTaskType.Optimise:
                return <div>No options available for Optimise Database task.</div>;
            case GQL.ScheduledTaskType.Plugin:
                const availablePlugins = plugins.data?.plugins || [];
                const taskPlugins = availablePlugins.filter(p => p.enabled && p.tasks && p.tasks.length > 0);
                const selectedPlugin = taskPlugins.find(p => p.id === selectedPluginId);

                return (
                    <div className="plugin-task-options">
                        <FormControl fullWidth variant="outlined" sx={{ mb: 3 }}>
                            <InputLabel id="plugin-label">Plugin</InputLabel>
                            <Select
                                labelId="plugin-label"
                                value={selectedPluginId}
                                onChange={(e) => {
                                    setSelectedPluginId(e.target.value as string);
                                    setSelectedPluginTask("");
                                }}
                                label="Plugin"
                            >
                                <MenuItem value=""><em>Select a plugin...</em></MenuItem>
                                {taskPlugins.map(p => (
                                    <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl fullWidth variant="outlined" sx={{ mb: 3 }}>
                            <InputLabel id="task-label">Task</InputLabel>
                            <Select
                                labelId="task-label"
                                value={selectedPluginTask}
                                onChange={(e) => setSelectedPluginTask(e.target.value as string)}
                                label="Task"
                                disabled={!selectedPlugin}
                            >
                                <MenuItem value=""><em>Select a task...</em></MenuItem>
                                {selectedPlugin?.tasks?.map(t => (
                                    <MenuItem key={t.name} value={t.name}>{t.name}</MenuItem>
                                ))}
                            </Select>
                            {selectedPlugin && selectedPluginTask && (
                                <Typography variant="caption" color="textSecondary" sx={{ mt: 1 }}>
                                    {selectedPlugin.tasks?.find(t => t.name === selectedPluginTask)?.description}
                                </Typography>
                            )}
                        </FormControl>
                    </div>
                )
            default:
                return <div>Select a task type to configure options.</div>;
        }
    };

    if (loading) {
        return <div>Loading scheduled tasks...</div>;
    }

    if (error) {
        return <div>Error loading tasks: {error.message}</div>;
    }

    return (
        <div className="scheduled-tasks">
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4">
                    <Icon icon={faClock} className="mr-2" />
                    Scheduled Tasks
                </Typography>
                <Button variant="contained" onClick={openCreateModal} startIcon={<Icon icon={faPlus} />}>
                    Add Schedule
                </Button>
            </Box>

            {tasks.length === 0 ? (
                <Typography color="textSecondary" align="center" py={4}>
                    No scheduled tasks configured. Click "Add Schedule" to create one.
                </Typography>
            ) : (
                <TableContainer component={Paper}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Name</TableCell>
                                <TableCell>Type</TableCell>
                                <TableCell>Schedule</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell>Last Run</TableCell>
                                <TableCell>Next Run</TableCell>
                                <TableCell>Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {tasks.map((task) => (
                                <TableRow key={task.id}>
                                    <TableCell>
                                        <strong>{task.name}</strong>
                                    </TableCell>
                                    <TableCell>
                                        <Chip label={getTaskTypeLabel(task.task_type)} color="default" variant="outlined" size="small" />
                                    </TableCell>
                                    <TableCell>
                                        <code>{task.cron_schedule}</code>
                                    </TableCell>
                                    <TableCell>
                                        <Button
                                            variant={task.enabled ? "contained" : "outlined"}
                                            color={task.enabled ? "success" : "inherit"}
                                            size="small"
                                            onClick={() => handleToggleEnabled(task)}
                                            title={task.enabled ? "Click to disable" : "Click to enable"}
                                            startIcon={<Icon icon={task.enabled ? faCheck : faTimes} />}
                                        >
                                            {task.enabled ? "Enabled" : "Disabled"}
                                        </Button>
                                    </TableCell>
                                    <TableCell className="text-muted">{formatDate(task.last_run)}</TableCell>
                                    <TableCell className="text-muted">{formatDate(task.next_run)}</TableCell>
                                    <TableCell>
                                        <ButtonGroup size="small">
                                            <IconButton
                                                color="primary"
                                                onClick={() => handleRun(task.id)}
                                                title="Run now"
                                            >
                                                <Icon icon={faPlay} />
                                            </IconButton>
                                            <IconButton
                                                onClick={() => openEditModal(task)}
                                                title="Edit"
                                            >
                                                <Icon icon={faEdit} />
                                            </IconButton>
                                            <IconButton
                                                color="error"
                                                onClick={() => handleDelete(task.id)}
                                                title="Delete"
                                            >
                                                <Icon icon={faTrash} />
                                            </IconButton>
                                        </ButtonGroup>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Create/Edit Modal */}
            <Dialog open={showModal} onClose={() => setShowModal(false)} maxWidth="md" fullWidth>
                <DialogTitle>
                    {editingTask ? "Edit Scheduled Task" : "Create Scheduled Task"}
                </DialogTitle>
                <DialogContent>
                    <Box component="form" noValidate autoComplete="off" sx={{ mt: 2 }}>
                        <TextField
                            fullWidth
                            label="Task Name"
                            placeholder="e.g., Nightly Scan"
                            value={formData.name}
                            onChange={(e) =>
                                setFormData({ ...formData, name: e.target.value })
                            }
                            margin="normal"
                            variant="outlined"
                        />

                        <FormControl fullWidth margin="normal" variant="outlined">
                            <InputLabel id="task-type-label">Task Type</InputLabel>
                            <Select
                                labelId="task-type-label"
                                value={formData.taskType}
                                onChange={(e) =>
                                    setFormData({ ...formData, taskType: e.target.value as GQL.ScheduledTaskType })
                                }
                                label="Task Type"
                            >
                                {TASK_TYPES.map((type) => (
                                    <MenuItem key={type.value} value={type.value}>
                                        {type.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <Box mt={2} mb={2}>
                            <Typography variant="subtitle2" gutterBottom>Schedule</Typography>
                            <CronInput
                                value={formData.cronSchedule}
                                onChange={(v) => setFormData({ ...formData, cronSchedule: v })}
                            />
                        </Box>

                        <FormControlLabel
                            control={
                                <Switch
                                    checked={formData.enabled}
                                    onChange={(e) =>
                                        setFormData({ ...formData, enabled: e.target.checked })
                                    }
                                    color="primary"
                                />
                            }
                            label="Enabled"
                        />

                        <Divider sx={{ my: 3 }} />
                        <Typography variant="h6" gutterBottom>Task Options</Typography>
                        <div className="task-options-container">
                            {renderOptionsForm()}
                        </div>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowModal(false)} color="inherit">
                        Cancel
                    </Button>
                    <Button
                        onClick={editingTask ? handleUpdate : handleCreate}
                        color="primary"
                        variant="contained"
                        disabled={!formData.name || !formData.cronSchedule}
                    >
                        {editingTask ? "Update" : "Create"}
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
};
