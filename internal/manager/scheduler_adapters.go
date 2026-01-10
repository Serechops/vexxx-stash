package manager

import (
	"context"
	"encoding/json"
	"time"

	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/scheduler"
)

// ManagerTaskExecutor adapts the Manager to the scheduler.TaskExecutor interface
type ManagerTaskExecutor struct {
	manager *Manager
}

func NewManagerTaskExecutor(m *Manager) *ManagerTaskExecutor {
	return &ManagerTaskExecutor{manager: m}
}

func (e *ManagerTaskExecutor) ExecuteScan(ctx context.Context, options json.RawMessage) (int, error) {
	var input ScanMetadataInput
	if len(options) > 0 {
		if err := json.Unmarshal(options, &input); err != nil {
			return 0, err
		}
	}
	return e.manager.Scan(ctx, input)
}

func (e *ManagerTaskExecutor) ExecuteGenerate(ctx context.Context, options json.RawMessage) (int, error) {
	var input GenerateMetadataInput
	if len(options) > 0 {
		if err := json.Unmarshal(options, &input); err != nil {
			return 0, err
		}
	}
	return e.manager.Generate(ctx, input)
}

func (e *ManagerTaskExecutor) ExecuteAutoTag(ctx context.Context, options json.RawMessage) (int, error) {
	var input AutoTagMetadataInput
	if len(options) > 0 {
		if err := json.Unmarshal(options, &input); err != nil {
			return 0, err
		}
	}
	return e.manager.AutoTag(ctx, input), nil
}

func (e *ManagerTaskExecutor) ExecuteClean(ctx context.Context, options json.RawMessage) (int, error) {
	var input CleanMetadataInput
	if len(options) > 0 {
		if err := json.Unmarshal(options, &input); err != nil {
			return 0, err
		}
	}
	return e.manager.Clean(ctx, input), nil
}

func (e *ManagerTaskExecutor) ExecuteOptimise(ctx context.Context) (int, error) {
	return e.manager.OptimiseDatabase(ctx), nil
}

type PluginTaskInput struct {
	PluginID    string                 `json:"pluginId"`
	TaskName    string                 `json:"taskName"`
	Description string                 `json:"description,omitempty"`
	Args        map[string]interface{} `json:"args"`
}

func (e *ManagerTaskExecutor) ExecutePlugin(ctx context.Context, options json.RawMessage) (int, error) {
	var input PluginTaskInput
	if err := json.Unmarshal(options, &input); err != nil {
		return 0, err
	}

	// Run plugin task through the plugin cache
	var taskName *string
	var description *string
	if input.TaskName != "" {
		taskName = &input.TaskName
	}
	if input.Description != "" {
		description = &input.Description
	}
	return e.manager.RunPluginTask(ctx, input.PluginID, taskName, description, input.Args), nil
}

// ConfigTaskStorage implements scheduler.TaskStorage using the config file
type ConfigTaskStorage struct {
	cfg *config.Config
}

func NewConfigTaskStorage(c *config.Config) *ConfigTaskStorage {
	return &ConfigTaskStorage{cfg: c}
}

func (s *ConfigTaskStorage) GetScheduledTasks() []scheduler.ScheduledTask {
	cfgTasks := s.cfg.GetScheduledTasks()
	tasks := make([]scheduler.ScheduledTask, len(cfgTasks))
	for i, ct := range cfgTasks {
		tasks[i] = scheduler.ScheduledTask{
			ID:           ct.ID,
			Name:         ct.Name,
			CronSchedule: ct.CronSchedule,
			TaskType:     scheduler.ScheduledTaskType(ct.TaskType),
			Enabled:      ct.Enabled,
			Options:      json.RawMessage(ct.Options),
		}
		if ct.LastRun != nil {
			if t, err := time.Parse(time.RFC3339, *ct.LastRun); err == nil {
				tasks[i].LastRun = &t
			}
		}
	}
	return tasks
}

func (s *ConfigTaskStorage) SaveScheduledTasks(tasks []scheduler.ScheduledTask) error {
	cfgTasks := make([]config.ScheduledTaskConfig, len(tasks))
	for i, t := range tasks {
		cfgTasks[i] = config.ScheduledTaskConfig{
			ID:           t.ID,
			Name:         t.Name,
			CronSchedule: t.CronSchedule,
			TaskType:     string(t.TaskType),
			Enabled:      t.Enabled,
			Options:      string(t.Options),
		}
		if t.LastRun != nil {
			lr := t.LastRun.Format(time.RFC3339)
			cfgTasks[i].LastRun = &lr
		}
	}
	s.cfg.SetScheduledTasks(cfgTasks)
	return s.cfg.Write()
}

func (s *ConfigTaskStorage) UpdateTaskLastRun(taskID string, lastRun time.Time) error {
	tasks := s.cfg.GetScheduledTasks()
	for i := range tasks {
		if tasks[i].ID == taskID {
			lr := lastRun.Format(time.RFC3339)
			tasks[i].LastRun = &lr
			break
		}
	}
	s.cfg.SetScheduledTasks(tasks)
	return s.cfg.Write()
}

// initScheduler initializes and starts the scheduler
func (m *Manager) initScheduler() {
	executor := NewManagerTaskExecutor(m)
	storage := NewConfigTaskStorage(m.Config)

	sched := scheduler.New(executor, storage)
	if err := sched.Start(); err != nil {
		logger.Errorf("Failed to start scheduler: %v", err)
		return
	}

	m.Scheduler = sched
	logger.Info("Scheduler started")
}
