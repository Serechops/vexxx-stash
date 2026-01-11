package api

import (
	"context"

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
