package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/scheduler"
)

type scheduledTaskRoutes struct{}

func (rs scheduledTaskRoutes) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/", rs.ListTasks)
	r.Post("/", rs.CreateTask)
	r.Get("/{taskId}", rs.GetTask)
	r.Put("/{taskId}", rs.UpdateTask)
	r.Delete("/{taskId}", rs.DeleteTask)
	r.Post("/{taskId}/run", rs.RunTask)

	return r
}

// ListTasks returns all scheduled tasks
func (rs scheduledTaskRoutes) ListTasks(w http.ResponseWriter, r *http.Request) {
	sched := manager.GetInstance().Scheduler
	if sched == nil {
		http.Error(w, "scheduler not initialized", http.StatusServiceUnavailable)
		return
	}

	tasks := sched.ListTasks()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(tasks); err != nil {
		logger.Errorf("Error encoding scheduled tasks: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// GetTask returns a specific scheduled task
func (rs scheduledTaskRoutes) GetTask(w http.ResponseWriter, r *http.Request) {
	sched := manager.GetInstance().Scheduler
	if sched == nil {
		http.Error(w, "scheduler not initialized", http.StatusServiceUnavailable)
		return
	}

	taskID := chi.URLParam(r, "taskId")
	task := sched.GetTask(taskID)
	if task == nil {
		http.Error(w, "task not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(task); err != nil {
		logger.Errorf("Error encoding scheduled task: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// CreateTaskInput is the request body for creating a scheduled task
type CreateTaskInput struct {
	Name         string                      `json:"name"`
	CronSchedule string                      `json:"cronSchedule"`
	TaskType     scheduler.ScheduledTaskType `json:"taskType"`
	Enabled      *bool                       `json:"enabled"`
	Options      json.RawMessage             `json:"options,omitempty"`
}

// CreateTask creates a new scheduled task
func (rs scheduledTaskRoutes) CreateTask(w http.ResponseWriter, r *http.Request) {
	sched := manager.GetInstance().Scheduler
	if sched == nil {
		http.Error(w, "scheduler not initialized", http.StatusServiceUnavailable)
		return
	}

	var input CreateTaskInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if input.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if input.CronSchedule == "" {
		http.Error(w, "cronSchedule is required", http.StatusBadRequest)
		return
	}
	if input.TaskType == "" {
		http.Error(w, "taskType is required", http.StatusBadRequest)
		return
	}

	task := scheduler.ScheduledTask{
		ID:           uuid.New().String(),
		Name:         input.Name,
		CronSchedule: input.CronSchedule,
		TaskType:     input.TaskType,
		Enabled:      true,
		Options:      input.Options,
	}

	if input.Enabled != nil {
		task.Enabled = *input.Enabled
	}

	if err := sched.AddTask(task); err != nil {
		http.Error(w, "failed to add task: "+err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(task); err != nil {
		logger.Errorf("Error encoding scheduled task: %v", err)
	}
}

// UpdateTaskInput is the request body for updating a scheduled task
type UpdateTaskInput struct {
	Name         *string                      `json:"name"`
	CronSchedule *string                      `json:"cronSchedule"`
	TaskType     *scheduler.ScheduledTaskType `json:"taskType"`
	Enabled      *bool                        `json:"enabled"`
	Options      json.RawMessage              `json:"options,omitempty"`
}

// UpdateTask updates an existing scheduled task
func (rs scheduledTaskRoutes) UpdateTask(w http.ResponseWriter, r *http.Request) {
	sched := manager.GetInstance().Scheduler
	if sched == nil {
		http.Error(w, "scheduler not initialized", http.StatusServiceUnavailable)
		return
	}

	taskID := chi.URLParam(r, "taskId")
	existing := sched.GetTask(taskID)
	if existing == nil {
		http.Error(w, "task not found", http.StatusNotFound)
		return
	}

	var input UpdateTaskInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	task := *existing

	if input.Name != nil {
		task.Name = *input.Name
	}
	if input.CronSchedule != nil {
		task.CronSchedule = *input.CronSchedule
	}
	if input.TaskType != nil {
		task.TaskType = *input.TaskType
	}
	if input.Enabled != nil {
		task.Enabled = *input.Enabled
	}
	if input.Options != nil {
		task.Options = input.Options
	}

	if err := sched.UpdateTask(task); err != nil {
		http.Error(w, "failed to update task: "+err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(task); err != nil {
		logger.Errorf("Error encoding scheduled task: %v", err)
	}
}

// DeleteTask deletes a scheduled task
func (rs scheduledTaskRoutes) DeleteTask(w http.ResponseWriter, r *http.Request) {
	sched := manager.GetInstance().Scheduler
	if sched == nil {
		http.Error(w, "scheduler not initialized", http.StatusServiceUnavailable)
		return
	}

	taskID := chi.URLParam(r, "taskId")
	if err := sched.RemoveTask(taskID); err != nil {
		http.Error(w, "failed to remove task: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// RunTaskResponse is the response for running a scheduled task
type RunTaskResponse struct {
	JobID int `json:"jobId"`
}

// RunTask manually triggers a scheduled task
func (rs scheduledTaskRoutes) RunTask(w http.ResponseWriter, r *http.Request) {
	sched := manager.GetInstance().Scheduler
	if sched == nil {
		http.Error(w, "scheduler not initialized", http.StatusServiceUnavailable)
		return
	}

	taskID := chi.URLParam(r, "taskId")
	task := sched.GetTask(taskID)
	if task == nil {
		http.Error(w, "task not found", http.StatusNotFound)
		return
	}

	jobID, err := sched.RunTask(taskID)
	if err != nil {
		http.Error(w, "failed to run task: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(RunTaskResponse{JobID: jobID}); err != nil {
		logger.Errorf("Error encoding run task response: %v", err)
	}
}
