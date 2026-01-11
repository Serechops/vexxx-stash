package api

import (
	"context"

	"github.com/stashapp/stash/pkg/models"
)

type potentialSceneResolver struct{ *Resolver }

func (r *potentialSceneResolver) ExistingScene(ctx context.Context, obj *models.PotentialScene) (*models.Scene, error) {
	if obj == nil || obj.StashID == "" {
		return nil, nil
	}

	// Find scene by stash_id
	var ret *models.Scene
	err := r.withReadTxn(ctx, func(ctx context.Context) error {
		sceneRepo := r.repository.Scene

		// Build filter to find scenes with this stash_id
		filter := &models.SceneFilterType{
			StashID: &models.StringCriterionInput{
				Value:    obj.StashID,
				Modifier: models.CriterionModifierEquals,
			},
		}

		perPage := 1
		findFilter := &models.FindFilterType{
			PerPage: &perPage,
		}

		// Query scenes with the filter
		result, err := sceneRepo.Query(ctx, models.SceneQueryOptions{
			QueryOptions: models.QueryOptions{
				FindFilter: findFilter,
			},
			SceneFilter: filter,
		})
		if err != nil {
			return err
		}

		if result != nil && len(result.IDs) > 0 {
			// Fetch the actual scene
			scene, err := sceneRepo.Find(ctx, result.IDs[0])
			if err != nil {
				return err
			}
			ret = scene
		}
		return nil
	})

	if err != nil {
		return nil, err
	}

	return ret, nil
}
