package api

import (
	"context"
	"strconv"

	"github.com/stashapp/stash/internal/manager"
)

func (r *mutationResolver) StashTagBatchAnalyze(ctx context.Context, input manager.StashTagBatchInput) (string, error) {
	jobID, err := manager.GetInstance().StashTagBatchAnalyze(ctx, input)
	if err != nil {
		return "", err
	}
	return strconv.Itoa(jobID), nil
}

func (r *mutationResolver) StashTagClearJobResult(ctx context.Context, jobID string) (bool, error) {
	manager.ClearStashTagJobResult(jobID)
	return true, nil
}
