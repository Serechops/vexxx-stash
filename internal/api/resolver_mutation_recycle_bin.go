package api

import (
	"context"
	"strconv"
)

func (r *mutationResolver) RestoreRecycleBinEntry(ctx context.Context, id string) (bool, error) {
	idInt, err := strconv.Atoi(id)
	if err != nil {
		return false, err
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		return r.repository.RecycleBin.Restore(ctx, idInt)
	}); err != nil {
		return false, err
	}

	return true, nil
}

func (r *mutationResolver) PurgeRecycleBinEntry(ctx context.Context, id string) (bool, error) {
	idInt, err := strconv.Atoi(id)
	if err != nil {
		return false, err
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		return r.repository.RecycleBin.Purge(ctx, idInt)
	}); err != nil {
		return false, err
	}

	return true, nil
}

func (r *mutationResolver) PurgeRecycleBin(ctx context.Context) (bool, error) {
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		return r.repository.RecycleBin.PurgeAll(ctx)
	}); err != nil {
		return false, err
	}

	return true, nil
}
