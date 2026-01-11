package api

import (
	"context"

	"github.com/stashapp/stash/pkg/models"
)

func (r *queryResolver) FindPotentialScenes(ctx context.Context, filter *models.PotentialSceneFilterInput) ([]*models.PotentialScene, error) {
	var ret []*models.PotentialScene
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		var err error
		if filter != nil {
			ret, err = r.repository.PotentialScene.Query(ctx, *filter)
			return err
		}

		ret, err = r.repository.PotentialScene.FindAll(ctx)
		return err
	}); err != nil {
		return nil, err
	}

	if ret == nil {
		return []*models.PotentialScene{}, nil
	}
	return ret, nil
}
