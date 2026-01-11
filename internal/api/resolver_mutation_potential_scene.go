package api

import (
	"context"
	"strconv"
	"time"

	"github.com/stashapp/stash/pkg/models"
)

func (r *mutationResolver) PotentialSceneCreate(ctx context.Context, input models.PotentialSceneCreateInput) (*models.PotentialScene, error) {
	var ret *models.PotentialScene
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		createdAt := time.Now()
		if input.CreatedAt != nil {
			createdAt = *input.CreatedAt
		}

		newScene := models.PotentialScene{
			StashID:   input.StashID,
			Data:      input.Data,
			CreatedAt: createdAt,
		}

		var err error
		ret, err = r.repository.PotentialScene.Create(ctx, newScene)
		return err
	}); err != nil {
		return nil, err
	}
	return ret, nil
}

func (r *mutationResolver) PotentialSceneDestroy(ctx context.Context, id string) (bool, error) {
	if err := r.withTxn(ctx, func(ctx context.Context) error {
		idInt, err := strconv.Atoi(id)
		if err != nil {
			return err
		}

		return r.repository.PotentialScene.Destroy(ctx, idInt)
	}); err != nil {
		return false, err
	}

	return true, nil
}
