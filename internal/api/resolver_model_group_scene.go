package api

import (
	"context"

	"github.com/stashapp/stash/internal/api/loaders"
	"github.com/stashapp/stash/pkg/models"
)

type groupSceneResolver struct{ *Resolver }

func (r *groupSceneResolver) Scene(ctx context.Context, obj *models.GroupScene) (*models.Scene, error) {
	return loaders.From(ctx).SceneByID.Load(obj.SceneID)
}
