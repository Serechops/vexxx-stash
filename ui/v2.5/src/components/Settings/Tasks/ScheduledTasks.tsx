import React, { useState, useEffect } from "react";
import { useIntl } from "react-intl";
import {
    Button,
    Form,
    Modal,
    Table,
    Badge,
    ButtonGroup,
} from "react-bootstrap";
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
                        <Form.Group className="mb-3">
                            <Form.Label>Plugin</Form.Label>
                            <Form.Control
                                as="select"
                                value={selectedPluginId}
                                onChange={(e) => {
                                    setSelectedPluginId(e.target.value);
                                    setSelectedPluginTask("");
                                }}
                            >
                                <option value="">Select a plugin...</option>
                                {taskPlugins.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </Form.Control>
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Task</Form.Label>
                            <Form.Control
                                as="select"
                                value={selectedPluginTask}
                                onChange={(e) => setSelectedPluginTask(e.target.value)}
                                disabled={!selectedPlugin}
                            >
                                <option value="">Select a task...</option>
                                {selectedPlugin?.tasks?.map(t => (
                                    <option key={t.name} value={t.name}>{t.name}</option>
                                ))}
                            </Form.Control>
                            {selectedPlugin && selectedPluginTask && (
                                <Form.Text className="text-muted">
                                    {selectedPlugin.tasks?.find(t => t.name === selectedPluginTask)?.description}
                                </Form.Text>
                            )}
                        </Form.Group>
                    </div>
                )
            default:
                return <div>Select a task type to configure options.</div>;
        }
    };

    // Filter types if needed
    const AVAILABLE_TYPES = TASK_TYPES;

    if (loading) {
        return <div>Loading scheduled tasks...</div>;
    }

    if (error) {
        return <div>Error loading tasks: {error.message}</div>;
    }

    return (
        <div className="scheduled-tasks">
            <div className="d-flex justify-content-between align-items-center mb-3">
                <h1>
                    <Icon icon={faClock} className="mr-2" />
                    Scheduled Tasks
                </h1>
                <Button variant="primary" onClick={openCreateModal}>
                    <Icon icon={faPlus} className="mr-1" />
                    Add Schedule
                </Button>
            </div>

            {tasks.length === 0 ? (
                <div className="text-muted text-center py-4">
                    No scheduled tasks configured. Click "Add Schedule" to create one.
                </div>
            ) : (
                <Table striped hover responsive className="scheduled-tasks-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Schedule</th>
                            <th>Status</th>
                            <th>Last Run</th>
                            <th>Next Run</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tasks.map((task) => (
                            <tr key={task.id}>
                                <td>
                                    <strong>{task.name}</strong>
                                </td>
                                <td>
                                    <Badge variant="info">{getTaskTypeLabel(task.task_type)}</Badge>
                                </td>
                                <td>
                                    <code>{task.cron_schedule}</code>
                                </td>
                                <td>
                                    <Button
                                        variant={task.enabled ? "success" : "secondary"}
                                        size="sm"
                                        onClick={() => handleToggleEnabled(task)}
                                        title={task.enabled ? "Click to disable" : "Click to enable"}
                                    >
                                        <Icon icon={task.enabled ? faCheck : faTimes} />
                                        {task.enabled ? " Enabled" : " Disabled"}
                                    </Button>
                                </td>
                                <td className="text-muted">{formatDate(task.last_run)}</td>
                                <td className="text-muted">{formatDate(task.next_run)}</td>
                                <td>
                                    <ButtonGroup size="sm">
                                        <Button
                                            variant="outline-primary"
                                            onClick={() => handleRun(task.id)}
                                            title="Run now"
                                        >
                                            <Icon icon={faPlay} />
                                        </Button>
                                        <Button
                                            variant="outline-secondary"
                                            onClick={() => openEditModal(task)}
                                            title="Edit"
                                        >
                                            <Icon icon={faEdit} />
                                        </Button>
                                        <Button
                                            variant="outline-danger"
                                            onClick={() => handleDelete(task.id)}
                                            title="Delete"
                                        >
                                            <Icon icon={faTrash} />
                                        </Button>
                                    </ButtonGroup>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}

            {/* Create/Edit Modal */}
            <Modal show={showModal} onHide={() => setShowModal(false)} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>
                        {editingTask ? "Edit Scheduled Task" : "Create Scheduled Task"}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ maxHeight: '80vh', overflowY: 'auto' }}>
                    <Form>
                        <Form.Group className="mb-3">
                            <Form.Label>Task Name</Form.Label>
                            <Form.Control
                                type="text"
                                placeholder="e.g., Nightly Scan"
                                value={formData.name}
                                onChange={(e) =>
                                    setFormData({ ...formData, name: e.target.value })
                                }
                            />
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Task Type</Form.Label>
                            <Form.Control
                                as="select"
                                value={formData.taskType}
                                onChange={(e) =>
                                    setFormData({ ...formData, taskType: e.target.value as GQL.ScheduledTaskType })
                                }
                            >
                                {AVAILABLE_TYPES.map((type) => (
                                    <option key={type.value} value={type.value}>
                                        {type.label}
                                    </option>
                                ))}
                            </Form.Control>
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Schedule</Form.Label>
                            <CronInput
                                value={formData.cronSchedule}
                                onChange={(v) => setFormData({ ...formData, cronSchedule: v })}
                            />
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Check
                                type="switch"
                                id="enabled-switch"
                                label="Enabled"
                                checked={formData.enabled}
                                onChange={(e) =>
                                    setFormData({ ...formData, enabled: e.target.checked })
                                }
                            />
                        </Form.Group>

                        <hr />
                        <h5>Task Options</h5>
                        <div className="task-options-container">
                            {renderOptionsForm()}
                        </div>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowModal(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        onClick={editingTask ? handleUpdate : handleCreate}
                        disabled={!formData.name || !formData.cronSchedule}
                    >
                        {editingTask ? "Update" : "Create"}
                    </Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
};
