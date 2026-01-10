package api

import (
	"context"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/pkg/scheduler"
)

func (r *queryResolver) ScheduledTasks(ctx context.Context) ([]*ScheduledTask, error) {
	sched := manager.GetInstance().Scheduler
	if sched == nil {
		return nil, nil
	}

	tasks := sched.ListTasks()
	ret := make([]*ScheduledTask, len(tasks))
	for i, t := range tasks {
		ret[i] = mapScheduledTask(t)
	}
	return ret, nil
}

func (r *queryResolver) ScheduledTask(ctx context.Context, id string) (*ScheduledTask, error) {
	sched := manager.GetInstance().Scheduler
	if sched == nil {
		return nil, nil
	}

	task := sched.GetTask(id)
	if task == nil {
		return nil, nil
	}
	return mapScheduledTask(*task), nil
}

func mapScheduledTask(t scheduler.ScheduledTask) *ScheduledTask {
	// Cast TaskType string to enum
	var taskType ScheduledTaskType
	switch t.TaskType {
	case scheduler.ScheduledTaskTypeScan:
		taskType = ScheduledTaskTypeScan
	case scheduler.ScheduledTaskTypeGenerate:
		taskType = ScheduledTaskTypeGenerate
	case scheduler.ScheduledTaskTypeAutoTag:
		taskType = ScheduledTaskTypeAutoTag
	case scheduler.ScheduledTaskTypeClean:
		taskType = ScheduledTaskTypeClean
	case scheduler.ScheduledTaskTypeOptimise:
		taskType = ScheduledTaskTypeOptimise
	case scheduler.ScheduledTaskTypePlugin:
		taskType = ScheduledTaskTypePlugin
	default:
		taskType = ScheduledTaskTypeScan // Default/Fallback
	}

	opts := string(t.Options)

	return &ScheduledTask{
		ID:           t.ID,
		Name:         t.Name,
		CronSchedule: t.CronSchedule,
		TaskType:     taskType,
		Enabled:      t.Enabled,
		Options:      &opts,
		LastRun:      t.LastRun,
		NextRun:      t.NextRun,
	}
}
