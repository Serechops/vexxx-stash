package scheduler

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/robfig/cron/v3"
	"github.com/stashapp/stash/pkg/logger"
)

// ScheduledTaskType indicates which type of task to run
type ScheduledTaskType string

const (
	ScheduledTaskTypeScan     ScheduledTaskType = "SCAN"
	ScheduledTaskTypeGenerate ScheduledTaskType = "GENERATE"
	ScheduledTaskTypeAutoTag  ScheduledTaskType = "AUTO_TAG"
	ScheduledTaskTypeClean    ScheduledTaskType = "CLEAN"
	ScheduledTaskTypeOptimise ScheduledTaskType = "OPTIMISE"
	ScheduledTaskTypePlugin   ScheduledTaskType = "PLUGIN"
)

// ScheduledTask represents a task that runs on a schedule
type ScheduledTask struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	CronSchedule string            `json:"cronSchedule"`
	TaskType     ScheduledTaskType `json:"taskType"`
	Enabled      bool              `json:"enabled"`
	Options      json.RawMessage   `json:"options,omitempty"`
	LastRun      *time.Time        `json:"lastRun,omitempty"`
	NextRun      *time.Time        `json:"nextRun,omitempty"`
}

// ScheduledTaskCreateInput is the input for creating a scheduled task
type ScheduledTaskCreateInput struct {
	Name         string            `json:"name"`
	CronSchedule string            `json:"cron_schedule"`
	TaskType     ScheduledTaskType `json:"task_type"`
	Enabled      *bool             `json:"enabled"`
	Options      *string           `json:"options"`
}

// ScheduledTaskUpdateInput is the input for updating a scheduled task
type ScheduledTaskUpdateInput struct {
	ID           string             `json:"id"`
	Name         *string            `json:"name"`
	CronSchedule *string            `json:"cron_schedule"`
	TaskType     *ScheduledTaskType `json:"task_type"`
	Enabled      *bool              `json:"enabled"`
	Options      *string            `json:"options"`
}

// TaskExecutor is the interface for executing scheduled tasks
type TaskExecutor interface {
	ExecuteScan(ctx context.Context, options json.RawMessage) (int, error)
	ExecuteGenerate(ctx context.Context, options json.RawMessage) (int, error)
	ExecuteAutoTag(ctx context.Context, options json.RawMessage) (int, error)
	ExecuteClean(ctx context.Context, options json.RawMessage) (int, error)
	ExecuteOptimise(ctx context.Context) (int, error)
	ExecutePlugin(ctx context.Context, options json.RawMessage) (int, error)
}

// TaskStorage is the interface for persisting scheduled tasks
type TaskStorage interface {
	GetScheduledTasks() []ScheduledTask
	SaveScheduledTasks(tasks []ScheduledTask) error
	UpdateTaskLastRun(taskID string, lastRun time.Time) error
}

// Scheduler manages scheduled task execution
type Scheduler struct {
	cron     *cron.Cron
	executor TaskExecutor
	storage  TaskStorage
	entries  map[string]cron.EntryID
	tasks    map[string]*ScheduledTask
	mu       sync.RWMutex
	ctx      context.Context
	cancel   context.CancelFunc
}

// New creates a new Scheduler instance
func New(executor TaskExecutor, storage TaskStorage) *Scheduler {
	ctx, cancel := context.WithCancel(context.Background())

	return &Scheduler{
		cron:     cron.New(cron.WithSeconds()),
		executor: executor,
		storage:  storage,
		entries:  make(map[string]cron.EntryID),
		tasks:    make(map[string]*ScheduledTask),
		ctx:      ctx,
		cancel:   cancel,
	}
}

// Start initializes the scheduler and begins executing scheduled tasks
func (s *Scheduler) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Load tasks from storage
	tasks := s.storage.GetScheduledTasks()
	for i := range tasks {
		task := tasks[i]
		if task.Enabled {
			if err := s.addTaskInternal(&task); err != nil {
				logger.Warnf("Failed to add scheduled task %s: %v", task.Name, err)
				continue
			}
		}
		s.tasks[task.ID] = &task
	}

	s.cron.Start()
	logger.Infof("Scheduler started with %d tasks", len(s.tasks))
	return nil
}

// Stop gracefully stops the scheduler
func (s *Scheduler) Stop() {
	s.cancel()
	ctx := s.cron.Stop()
	<-ctx.Done()
	logger.Info("Scheduler stopped")
}

// AddTask adds a new scheduled task
func (s *Scheduler) AddTask(task ScheduledTask) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.tasks[task.ID] = &task

	if task.Enabled {
		if err := s.addTaskInternal(&task); err != nil {
			return err
		}
	}

	return s.saveTasks()
}

// UpdateTask updates an existing scheduled task
func (s *Scheduler) UpdateTask(task ScheduledTask) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Remove existing cron entry if present
	if entryID, ok := s.entries[task.ID]; ok {
		s.cron.Remove(entryID)
		delete(s.entries, task.ID)
	}

	s.tasks[task.ID] = &task

	if task.Enabled {
		if err := s.addTaskInternal(&task); err != nil {
			return err
		}
	}

	return s.saveTasks()
}

// RemoveTask removes a scheduled task
func (s *Scheduler) RemoveTask(taskID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if entryID, ok := s.entries[taskID]; ok {
		s.cron.Remove(entryID)
		delete(s.entries, taskID)
	}
	delete(s.tasks, taskID)

	return s.saveTasks()
}

// GetTask returns a scheduled task by ID
func (s *Scheduler) GetTask(taskID string) *ScheduledTask {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if task, ok := s.tasks[taskID]; ok {
		// Update next run time from cron entry
		if entryID, ok := s.entries[taskID]; ok {
			entry := s.cron.Entry(entryID)
			nextRun := entry.Next
			task.NextRun = &nextRun
		}
		return task
	}
	return nil
}

// ListTasks returns all scheduled tasks
func (s *Scheduler) ListTasks() []ScheduledTask {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tasks := make([]ScheduledTask, 0, len(s.tasks))
	for _, task := range s.tasks {
		// Update next run time from cron entry
		if entryID, ok := s.entries[task.ID]; ok {
			entry := s.cron.Entry(entryID)
			nextRun := entry.Next
			task.NextRun = &nextRun
		}
		tasks = append(tasks, *task)
	}
	return tasks
}

// RunTask manually triggers a scheduled task
func (s *Scheduler) RunTask(taskID string) (int, error) {
	s.mu.RLock()
	task, ok := s.tasks[taskID]
	s.mu.RUnlock()

	if !ok {
		return 0, nil
	}

	return s.executeTask(task)
}

// addTaskInternal adds a task to the cron scheduler (must hold lock)
func (s *Scheduler) addTaskInternal(task *ScheduledTask) error {
	taskCopy := *task
	entryID, err := s.cron.AddFunc(task.CronSchedule, func() {
		s.executeTask(&taskCopy)
	})
	if err != nil {
		return err
	}

	s.entries[task.ID] = entryID

	// Set next run time
	entry := s.cron.Entry(entryID)
	nextRun := entry.Next
	task.NextRun = &nextRun

	return nil
}

// executeTask runs a task and updates its last run time
func (s *Scheduler) executeTask(task *ScheduledTask) (int, error) {
	logger.Infof("Executing scheduled task: %s (%s)", task.Name, task.TaskType)

	var jobID int
	var err error

	switch task.TaskType {
	case ScheduledTaskTypeScan:
		jobID, err = s.executor.ExecuteScan(s.ctx, task.Options)
	case ScheduledTaskTypeGenerate:
		jobID, err = s.executor.ExecuteGenerate(s.ctx, task.Options)
	case ScheduledTaskTypeAutoTag:
		jobID, err = s.executor.ExecuteAutoTag(s.ctx, task.Options)
	case ScheduledTaskTypeClean:
		jobID, err = s.executor.ExecuteClean(s.ctx, task.Options)
	case ScheduledTaskTypeOptimise:
		jobID, err = s.executor.ExecuteOptimise(s.ctx)
	case ScheduledTaskTypePlugin:
		jobID, err = s.executor.ExecutePlugin(s.ctx, task.Options)
	default:
		logger.Warnf("Unknown task type: %s", task.TaskType)
		return 0, nil
	}

	if err != nil {
		logger.Errorf("Failed to execute scheduled task %s: %v", task.Name, err)
		return 0, err
	}

	// Update last run time
	now := time.Now()
	s.mu.Lock()
	if t, ok := s.tasks[task.ID]; ok {
		t.LastRun = &now
	}
	s.mu.Unlock()

	if err := s.storage.UpdateTaskLastRun(task.ID, now); err != nil {
		logger.Warnf("Failed to update last run time for task %s: %v", task.Name, err)
	}

	logger.Infof("Scheduled task %s started with job ID %d", task.Name, jobID)
	return jobID, nil
}

// saveTasks persists all tasks to storage (must hold lock)
func (s *Scheduler) saveTasks() error {
	tasks := make([]ScheduledTask, 0, len(s.tasks))
	for _, task := range s.tasks {
		tasks = append(tasks, *task)
	}
	return s.storage.SaveScheduledTasks(tasks)
}
