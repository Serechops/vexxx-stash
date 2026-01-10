package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/pkg/scheduler"
)

func (r *mutationResolver) ScheduledTaskCreate(ctx context.Context, input ScheduledTaskCreateInput) (*ScheduledTask, error) {
	sched := manager.GetInstance().Scheduler
	if sched == nil {
		return nil, nil
	}

	// Map TaskType enum to string
	taskType := scheduler.ScheduledTaskType(input.TaskType)

	var enabled bool
	if input.Enabled != nil {
		enabled = *input.Enabled
	} else {
		enabled = true
	}

	var options json.RawMessage
	if input.Options != nil {
		options = json.RawMessage(*input.Options)
	}

	cronSchedule := input.CronSchedule
	// Normalize 5-field cron to 6-field (prepend seconds)
	if len(strings.Fields(cronSchedule)) == 5 {
		cronSchedule = "0 " + cronSchedule
	}

	task := scheduler.ScheduledTask{
		ID:           uuid.New().String(),
		Name:         input.Name,
		CronSchedule: cronSchedule,
		TaskType:     taskType,
		Enabled:      enabled,
		Options:      options,
	}

	if err := sched.AddTask(task); err != nil {
		return nil, err
	}

	return mapScheduledTask(task), nil
}

func (r *mutationResolver) ScheduledTaskUpdate(ctx context.Context, input ScheduledTaskUpdateInput) (*ScheduledTask, error) {
	sched := manager.GetInstance().Scheduler
	if sched == nil {
		return nil, nil
	}

	existing := sched.GetTask(input.ID)
	if existing == nil {
		return nil, fmt.Errorf("task not found")
	}

	task := *existing

	if input.Name != nil {
		task.Name = *input.Name
	}
	if input.CronSchedule != nil {
		cronSchedule := *input.CronSchedule
		// Normalize 5-field cron to 6-field (prepend seconds)
		if len(strings.Fields(cronSchedule)) == 5 {
			cronSchedule = "0 " + cronSchedule
		}
		task.CronSchedule = cronSchedule
	}
	if input.TaskType != nil {
		task.TaskType = scheduler.ScheduledTaskType(*input.TaskType)
	}
	if input.Enabled != nil {
		task.Enabled = *input.Enabled
	}
	if input.Options != nil {
		task.Options = json.RawMessage(*input.Options)
	}

	if err := sched.UpdateTask(task); err != nil {
		return nil, err
	}

	return mapScheduledTask(task), nil
}

func (r *mutationResolver) ScheduledTaskDestroy(ctx context.Context, id string) (bool, error) {
	sched := manager.GetInstance().Scheduler
	if sched == nil {
		return false, nil
	}

	if err := sched.RemoveTask(id); err != nil {
		return false, err
	}
	return true, nil
}

func (r *mutationResolver) ScheduledTaskRun(ctx context.Context, id string) (int, error) {
	sched := manager.GetInstance().Scheduler
	if sched == nil {
		return 0, nil
	}

	return sched.RunTask(id)
}
