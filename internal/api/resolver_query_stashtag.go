package api

import (
	"context"

	"github.com/stashapp/stash/internal/manager"
)

func (r *queryResolver) StashTagJobResult(ctx context.Context, jobID string) (*manager.StashTagJobResult, error) {
	result := manager.GetStashTagJobResult(jobID)
	return result, nil
}
