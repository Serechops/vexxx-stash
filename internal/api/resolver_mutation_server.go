package api

import (
	"context"

	"github.com/stashapp/stash/internal/manager"
)

func (r *mutationResolver) RestartServer(ctx context.Context) (bool, error) {
	if err := manager.GetInstance().RequestRestart(); err != nil {
		return false, err
	}
	return true, nil
}

func (r *mutationResolver) ShutdownServer(ctx context.Context) (bool, error) {
	if err := manager.GetInstance().RequestShutdown(); err != nil {
		return false, err
	}
	return true, nil
}
