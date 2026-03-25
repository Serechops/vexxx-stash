package api

import (
	"context"

	"github.com/stashapp/stash/pkg/models"
)

func (r *queryResolver) RecycleBin(ctx context.Context, limit *int, offset *int) (ret []*models.RecycleBinEntry, err error) {
	lim := 0
	if limit != nil {
		lim = *limit
	}
	off := 0
	if offset != nil {
		off = *offset
	}

	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		ret, err = r.repository.RecycleBin.FindAll(ctx, lim, off)
		return err
	}); err != nil {
		return nil, err
	}

	return ret, nil
}

func (r *queryResolver) RecycleBinCount(ctx context.Context) (ret int, err error) {
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		ret, err = r.repository.RecycleBin.Count(ctx)
		return err
	}); err != nil {
		return 0, err
	}
	return ret, nil
}

func (r *queryResolver) RecycleBinHistory(ctx context.Context, limit *int, offset *int) (ret []*models.RecycleBinHistoryEntry, err error) {
	lim := 0
	if limit != nil {
		lim = *limit
	}
	off := 0
	if offset != nil {
		off = *offset
	}

	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		ret, err = r.repository.RecycleBin.FindHistory(ctx, lim, off)
		return err
	}); err != nil {
		return nil, err
	}

	return ret, nil
}

func (r *queryResolver) RecycleBinHistoryCount(ctx context.Context) (ret int, err error) {
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		ret, err = r.repository.RecycleBin.CountHistory(ctx)
		return err
	}); err != nil {
		return 0, err
	}
	return ret, nil
}
