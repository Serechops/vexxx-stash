package api

import (
	"context"
	"strconv"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/pkg/models"
)

// ScrapePerformerScenesFromStashBox scrapes a performer and their scenes from a stash-box endpoint.
func (r *mutationResolver) ScrapePerformerScenesFromStashBox(ctx context.Context, stashBoxEndpoint string, performerStashID string) (*models.ScrapedPerformer, error) {
	// Resolve the stash box by endpoint
	b, err := resolveStashBox(nil, &stashBoxEndpoint)
	if err != nil {
		return nil, err
	}

	// Create a stash box client
	client := r.newStashBoxClient(*b)

	// Use FindPerformerByID which fetches performer with all scenes using pagination
	performer, err := client.FindPerformerByID(ctx, performerStashID)
	if err != nil {
		return nil, err
	}

	return performer, nil
}

func (r *mutationResolver) StartScrapePerformerScenesJob(ctx context.Context, stashBoxEndpoint string, performerStashID string) (*string, error) {
	// Resolve the stash box by endpoint to validate it
	_, err := resolveStashBox(nil, &stashBoxEndpoint)
	if err != nil {
		return nil, err
	}

	task := &manager.ScrapePerformerScenesTask{
		StashBoxEndpoint: stashBoxEndpoint,
		PerformerStashID: performerStashID,
	}

	jobID := manager.GetInstance().JobManager.Add(ctx, task.GetDescription(), task)
	jidStr := strconv.Itoa(jobID)
	return &jidStr, nil
}
